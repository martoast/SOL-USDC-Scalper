// tests/diagnostics/expectancy.test.ts

import { describe, it, expect } from 'vitest';
import {
  calculateExpectancy,
  filterByRegime,
  filterMfeFirst,
  filterByHour,
  formatExpectancyReport,
} from '../../server/diagnostics/expectancy';
import type { TradeDiagnostics } from '../../server/diagnostics/types';

// Helper to create mock trade diagnostics
function createMockDiagnostics(
  overrides: Partial<TradeDiagnostics> & { tradeId: string }
): TradeDiagnostics {
  return {
    tradeId: overrides.tradeId,
    direction: overrides.direction ?? 'LONG',
    signalScore: overrides.signalScore ?? 30,
    signalConfidence: overrides.signalConfidence ?? 70,
    excursion: overrides.excursion ?? {
      mfe1m: 0.5,
      mfe3m: 0.8,
      mfe5m: 1.0,
      mfe10m: 1.2,
      mfeMax: 1.5,
      mfeMaxTime: 30000,
      maeMax: -0.3,
      maeMaxTime: 10000,
      timeToFirstFavorable: 5000,
      firstFavorablePercent: 0.1,
      mfeBeforeMae: true,
      firstSignificantMove: 'favorable',
      pricePath: [],
    },
    execution: overrides.execution ?? {
      theoreticalEntryPrice: 200,
      actualEntryPrice: 200.05,
      entrySlippageBps: 2.5,
      entrySlippageUsd: 0.005,
      theoreticalExitPrice: 203,
      actualExitPrice: 202.95,
      exitSlippageBps: 2.5,
      exitSlippageUsd: 0.005,
      totalSlippageBps: 5,
      totalSlippageUsd: 0.01,
      totalFeesUsd: 0.05,
      idealPnlPercent: 1.5,
      actualPnlPercent: 1.4,
      executionDragPercent: 0.1,
    },
    regime: overrides.regime ?? {
      marketState: 'trending',
      trendDirection: 'bullish',
      volatilityPercent: 0.5,
      volatilityPercentile: 50,
      hourOfDay: 16,
      dayOfWeek: 1,
      tradabilityValues: { atrPercent: 0.5, adx: 25, bbWidth: 1.5 },
      regimeShiftedAfterEntry: false,
      regimeAtExit: 'trending_bullish',
    },
    entryTime: overrides.entryTime ?? Date.now() - 60000,
    exitTime: overrides.exitTime ?? Date.now(),
    holdDuration: overrides.holdDuration ?? 60000,
    outcome: overrides.outcome ?? 'win',
    exitReason: overrides.exitReason ?? 'TAKE_PROFIT',
    finalPnlPercent: overrides.finalPnlPercent ?? 1.4,
    stopLossPercent: overrides.stopLossPercent ?? 1,
    takeProfitPercent: overrides.takeProfitPercent ?? 2,
    rMultiple: overrides.rMultiple ?? 1.4,
    mfeReachedTwoR: overrides.mfeReachedTwoR ?? false,
  };
}

describe('Expectancy Calculator', () => {
  describe('calculateExpectancy', () => {
    it('should return empty metrics for no trades', () => {
      const metrics = calculateExpectancy([]);

      expect(metrics.totalTrades).toBe(0);
      expect(metrics.expectancy).toBe(0);
    });

    it('should calculate basic stats correctly', () => {
      const trades = [
        createMockDiagnostics({ tradeId: '1', outcome: 'win', finalPnlPercent: 2 }),
        createMockDiagnostics({ tradeId: '2', outcome: 'win', finalPnlPercent: 1.5 }),
        createMockDiagnostics({ tradeId: '3', outcome: 'loss', finalPnlPercent: -1 }),
        createMockDiagnostics({ tradeId: '4', outcome: 'loss', finalPnlPercent: -0.8 }),
      ];

      const metrics = calculateExpectancy(trades);

      expect(metrics.totalTrades).toBe(4);
      expect(metrics.winCount).toBe(2);
      expect(metrics.lossCount).toBe(2);
      expect(metrics.winRate).toBe(0.5);
    });

    it('should calculate expectancy correctly', () => {
      const trades = [
        createMockDiagnostics({ tradeId: '1', outcome: 'win', finalPnlPercent: 2 }),
        createMockDiagnostics({ tradeId: '2', outcome: 'win', finalPnlPercent: 2 }),
        createMockDiagnostics({ tradeId: '3', outcome: 'loss', finalPnlPercent: -1 }),
        createMockDiagnostics({ tradeId: '4', outcome: 'loss', finalPnlPercent: -1 }),
      ];

      const metrics = calculateExpectancy(trades);

      // Win rate: 50%, avg win: 2%, avg loss: -1%
      // Expectancy = (0.5 * 2) + (0.5 * -1) = 1 - 0.5 = 0.5%
      expect(metrics.expectancy).toBe(0.5);
    });

    it('should calculate MFE/MAE stats', () => {
      const trades = [
        createMockDiagnostics({
          tradeId: '1',
          excursion: {
            mfe1m: 0.5,
            mfe3m: 0.8,
            mfe5m: 1.0,
            mfe10m: 1.2,
            mfeMax: 2,
            mfeMaxTime: 30000,
            maeMax: -0.5,
            maeMaxTime: 10000,
            timeToFirstFavorable: 5000,
            firstFavorablePercent: 0.1,
            mfeBeforeMae: true,
            firstSignificantMove: 'favorable',
            pricePath: [],
          },
        }),
        createMockDiagnostics({
          tradeId: '2',
          excursion: {
            mfe1m: 0.3,
            mfe3m: 0.5,
            mfe5m: 0.8,
            mfe10m: 1.0,
            mfeMax: 1,
            mfeMaxTime: 40000,
            maeMax: -1,
            maeMaxTime: 20000,
            timeToFirstFavorable: 8000,
            firstFavorablePercent: 0.05,
            mfeBeforeMae: false,
            firstSignificantMove: 'adverse',
            pricePath: [],
          },
        }),
      ];

      const metrics = calculateExpectancy(trades);

      expect(metrics.avgMfe).toBe(1.5); // (2 + 1) / 2
      expect(metrics.avgMae).toBe(0.75); // (0.5 + 1) / 2 (absolute values)
      expect(metrics.mfeToMaeRatio).toBe(2); // 1.5 / 0.75
    });

    it('should calculate R-multiple stats', () => {
      const trades = [
        createMockDiagnostics({
          tradeId: '1',
          rMultiple: 2,
          mfeReachedTwoR: true,
          stopLossPercent: 1,
        }),
        createMockDiagnostics({
          tradeId: '2',
          rMultiple: 1,
          mfeReachedTwoR: false,
          stopLossPercent: 1,
        }),
        createMockDiagnostics({
          tradeId: '3',
          rMultiple: -1,
          mfeReachedTwoR: false,
          stopLossPercent: 1,
        }),
      ];

      const metrics = calculateExpectancy(trades);

      expect(metrics.avgRMultiple).toBeCloseTo(0.67, 1); // (2 + 1 - 1) / 3
      expect(metrics.percentTradesMfeReachedTwoR).toBeCloseTo(33.33, 0); // 1/3
    });

    it('should calculate slippage percentiles', () => {
      const trades = [
        createMockDiagnostics({
          tradeId: '1',
          execution: {
            theoreticalEntryPrice: 200,
            actualEntryPrice: 200,
            entrySlippageBps: 0,
            entrySlippageUsd: 0,
            theoreticalExitPrice: 200,
            actualExitPrice: 200,
            exitSlippageBps: 0,
            exitSlippageUsd: 0,
            totalSlippageBps: 5,
            totalSlippageUsd: 0.01,
            totalFeesUsd: 0.05,
            idealPnlPercent: 1,
            actualPnlPercent: 0.9,
            executionDragPercent: 0.1,
          },
        }),
        createMockDiagnostics({
          tradeId: '2',
          execution: {
            theoreticalEntryPrice: 200,
            actualEntryPrice: 200,
            entrySlippageBps: 0,
            entrySlippageUsd: 0,
            theoreticalExitPrice: 200,
            actualExitPrice: 200,
            exitSlippageBps: 0,
            exitSlippageUsd: 0,
            totalSlippageBps: 10,
            totalSlippageUsd: 0.02,
            totalFeesUsd: 0.05,
            idealPnlPercent: 1,
            actualPnlPercent: 0.85,
            executionDragPercent: 0.15,
          },
        }),
        createMockDiagnostics({
          tradeId: '3',
          execution: {
            theoreticalEntryPrice: 200,
            actualEntryPrice: 200,
            entrySlippageBps: 0,
            entrySlippageUsd: 0,
            theoreticalExitPrice: 200,
            actualExitPrice: 200,
            exitSlippageBps: 0,
            exitSlippageUsd: 0,
            totalSlippageBps: 50,
            totalSlippageUsd: 0.1,
            totalFeesUsd: 0.05,
            idealPnlPercent: 1,
            actualPnlPercent: 0.5,
            executionDragPercent: 0.5,
          },
        }),
      ];

      const metrics = calculateExpectancy(trades);

      expect(metrics.avgSlippageBps).toBeCloseTo(21.67, 0); // (5+10+50)/3
      expect(metrics.medianSlippageBps).toBe(10);
      expect(metrics.worstSlippageBps).toBe(50);
    });

    it('should group by score bucket', () => {
      const trades = [
        createMockDiagnostics({ tradeId: '1', signalScore: 25, outcome: 'win' }),
        createMockDiagnostics({ tradeId: '2', signalScore: 28, outcome: 'win' }),
        createMockDiagnostics({ tradeId: '3', signalScore: 35, outcome: 'loss' }),
        createMockDiagnostics({ tradeId: '4', signalScore: 45, outcome: 'win' }),
      ];

      const metrics = calculateExpectancy(trades);

      expect(metrics.byScoreBucket.length).toBeGreaterThan(0);
      const bucket2030 = metrics.byScoreBucket.find((b) => b.bucket === '20-30');
      expect(bucket2030?.trades).toBe(2);
      expect(bucket2030?.winRate).toBe(1); // Both wins
    });
  });

  describe('filterByRegime', () => {
    it('should filter trades by regime', () => {
      const trades = [
        createMockDiagnostics({
          tradeId: '1',
          regime: {
            marketState: 'trending',
            trendDirection: 'bullish',
            volatilityPercent: 0.5,
            volatilityPercentile: 50,
            hourOfDay: 16,
            dayOfWeek: 1,
            tradabilityValues: { atrPercent: 0.5, adx: 25, bbWidth: 1.5 },
            regimeShiftedAfterEntry: false,
            regimeAtExit: 'trending_bullish',
          },
        }),
        createMockDiagnostics({
          tradeId: '2',
          regime: {
            marketState: 'ranging',
            trendDirection: 'neutral',
            volatilityPercent: 0.3,
            volatilityPercentile: 30,
            hourOfDay: 10,
            dayOfWeek: 2,
            tradabilityValues: { atrPercent: 0.3, adx: 15, bbWidth: 0.8 },
            regimeShiftedAfterEntry: false,
            regimeAtExit: 'ranging',
          },
        }),
        createMockDiagnostics({
          tradeId: '3',
          regime: {
            marketState: 'trending',
            trendDirection: 'bearish',
            volatilityPercent: 0.6,
            volatilityPercentile: 60,
            hourOfDay: 14,
            dayOfWeek: 3,
            tradabilityValues: { atrPercent: 0.6, adx: 30, bbWidth: 1.8 },
            regimeShiftedAfterEntry: false,
            regimeAtExit: 'trending_bearish',
          },
        }),
      ];

      const trending = filterByRegime(trades, 'trending');
      expect(trending.length).toBe(2);

      const ranging = filterByRegime(trades, 'ranging');
      expect(ranging.length).toBe(1);
    });
  });

  describe('filterMfeFirst', () => {
    it('should filter trades where MFE came before MAE', () => {
      const trades = [
        createMockDiagnostics({
          tradeId: '1',
          excursion: {
            mfe1m: null,
            mfe3m: null,
            mfe5m: null,
            mfe10m: null,
            mfeMax: 1,
            mfeMaxTime: 30000,
            maeMax: -0.5,
            maeMaxTime: 10000,
            timeToFirstFavorable: 5000,
            firstFavorablePercent: 0.1,
            mfeBeforeMae: true,
            firstSignificantMove: 'favorable',
            pricePath: [],
          },
        }),
        createMockDiagnostics({
          tradeId: '2',
          excursion: {
            mfe1m: null,
            mfe3m: null,
            mfe5m: null,
            mfe10m: null,
            mfeMax: 0.5,
            mfeMaxTime: 40000,
            maeMax: -1,
            maeMaxTime: 10000,
            timeToFirstFavorable: 20000,
            firstFavorablePercent: 0.1,
            mfeBeforeMae: false,
            firstSignificantMove: 'adverse',
            pricePath: [],
          },
        }),
      ];

      const mfeFirst = filterMfeFirst(trades);
      expect(mfeFirst.length).toBe(1);
      expect(mfeFirst[0].tradeId).toBe('1');
    });
  });

  describe('filterByHour', () => {
    it('should filter trades by hour of day', () => {
      const trades = [
        createMockDiagnostics({
          tradeId: '1',
          regime: {
            marketState: 'trending',
            trendDirection: 'bullish',
            volatilityPercent: 0.5,
            volatilityPercentile: 50,
            hourOfDay: 16, // In range 14-21
            dayOfWeek: 1,
            tradabilityValues: { atrPercent: 0.5, adx: 25, bbWidth: 1.5 },
            regimeShiftedAfterEntry: false,
            regimeAtExit: 'trending_bullish',
          },
        }),
        createMockDiagnostics({
          tradeId: '2',
          regime: {
            marketState: 'trending',
            trendDirection: 'bullish',
            volatilityPercent: 0.5,
            volatilityPercentile: 50,
            hourOfDay: 8, // Out of range 14-21
            dayOfWeek: 1,
            tradabilityValues: { atrPercent: 0.5, adx: 25, bbWidth: 1.5 },
            regimeShiftedAfterEntry: false,
            regimeAtExit: 'trending_bullish',
          },
        }),
      ];

      const marketHours = filterByHour(trades, 14, 21);
      expect(marketHours.length).toBe(1);
      expect(marketHours[0].tradeId).toBe('1');
    });
  });

  describe('formatExpectancyReport', () => {
    it('should format a readable report', () => {
      const trades = [
        createMockDiagnostics({ tradeId: '1', outcome: 'win', finalPnlPercent: 1.5 }),
        createMockDiagnostics({ tradeId: '2', outcome: 'loss', finalPnlPercent: -0.8 }),
      ];

      const metrics = calculateExpectancy(trades);
      const report = formatExpectancyReport(metrics);

      expect(report).toContain('EXPECTANCY REPORT');
      expect(report).toContain('Total Trades: 2');
      expect(report).toContain('Win/Loss: 1/1');
      expect(report).toContain('MFE');
      expect(report).toContain('MAE');
    });
  });

  describe('edge cases', () => {
    it('should handle trades with null R-multiples', () => {
      // Create trades where rMultiple is explicitly null
      const trade: TradeDiagnostics = {
        tradeId: '1',
        direction: 'LONG',
        signalScore: 30,
        signalConfidence: 70,
        excursion: {
          mfe1m: null,
          mfe3m: null,
          mfe5m: null,
          mfe10m: null,
          mfeMax: 0,
          mfeMaxTime: null,
          maeMax: 0,
          maeMaxTime: null,
          timeToFirstFavorable: null,
          firstFavorablePercent: null,
          mfeBeforeMae: null,
          firstSignificantMove: null,
          pricePath: [],
        },
        execution: {
          theoreticalEntryPrice: 200,
          actualEntryPrice: 200,
          entrySlippageBps: 0,
          entrySlippageUsd: 0,
          theoreticalExitPrice: 200,
          actualExitPrice: 200,
          exitSlippageBps: 0,
          exitSlippageUsd: 0,
          totalSlippageBps: 0,
          totalSlippageUsd: 0,
          totalFeesUsd: 0.05,
          idealPnlPercent: 0,
          actualPnlPercent: 0,
          executionDragPercent: 0,
        },
        regime: {
          marketState: 'unknown',
          trendDirection: 'neutral',
          volatilityPercent: 0,
          volatilityPercentile: 50,
          hourOfDay: 12,
          dayOfWeek: 1,
          tradabilityValues: { atrPercent: null, adx: null, bbWidth: null },
          regimeShiftedAfterEntry: null,
          regimeAtExit: null,
        },
        entryTime: Date.now() - 60000,
        exitTime: Date.now(),
        holdDuration: 60000,
        outcome: 'breakeven',
        exitReason: 'MANUAL',
        finalPnlPercent: 0,
        stopLossPercent: 1,
        takeProfitPercent: 2,
        rMultiple: null, // Explicitly null
        mfeReachedTwoR: false,
      };

      const metrics = calculateExpectancy([trade]);
      expect(metrics.totalTrades).toBe(1);
      expect(metrics.avgRMultiple).toBe(0); // No valid R-multiples
    });

    it('should handle all losses', () => {
      const trades = [
        createMockDiagnostics({ tradeId: '1', outcome: 'loss', finalPnlPercent: -1 }),
        createMockDiagnostics({ tradeId: '2', outcome: 'loss', finalPnlPercent: -0.8 }),
      ];

      const metrics = calculateExpectancy(trades);
      expect(metrics.winRate).toBe(0);
      expect(metrics.expectancy).toBeLessThan(0);
    });

    it('should handle all wins', () => {
      const trades = [
        createMockDiagnostics({ tradeId: '1', outcome: 'win', finalPnlPercent: 1.5 }),
        createMockDiagnostics({ tradeId: '2', outcome: 'win', finalPnlPercent: 2 }),
      ];

      const metrics = calculateExpectancy(trades);
      expect(metrics.winRate).toBe(1);
      expect(metrics.expectancy).toBeGreaterThan(0);
    });
  });
});
