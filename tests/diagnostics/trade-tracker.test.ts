// tests/diagnostics/trade-tracker.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('../../server/indicators', () => ({
  getIndicatorSnapshot: vi.fn(() => ({
    atr: { valuePercent: 0.5 },
  })),
}));

vi.mock('../../server/strategy/tradability', () => ({
  checkTradability: vi.fn(() => ({
    isTradable: true,
    checks: {
      volatility: { value: 0.5 },
      trendStrength: { value: 25 },
      rangeCompression: { value: 1.5 },
    },
  })),
}));

vi.mock('../../server/strategy/regime', () => ({
  detectMarketRegime: vi.fn(() => ({
    regime: 'trending_bullish',
  })),
}));

import {
  startTrackingTrade,
  updateTracker,
  stopTrackingTrade,
  getActiveTracker,
  getAllActiveTrackers,
  clearAllDiagnostics,
} from '../../server/diagnostics/trade-tracker';

describe('Trade Tracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAllDiagnostics();
  });

  describe('startTrackingTrade', () => {
    it('should create a new tracker for a trade', () => {
      const tracker = startTrackingTrade({
        tradeId: 'test-1',
        direction: 'LONG',
        entryPrice: 200,
        signalScore: 35,
        signalConfidence: 70,
        stopLossPercent: 1,
        takeProfitPercent: 2,
      });

      expect(tracker.tradeId).toBe('test-1');
      expect(tracker.direction).toBe('LONG');
      expect(tracker.entryPrice).toBe(200);
      expect(tracker.signalScore).toBe(35);
      expect(tracker.currentMfe).toBe(0);
      expect(tracker.currentMae).toBe(0);
    });

    it('should store tracker in active trackers', () => {
      startTrackingTrade({
        tradeId: 'test-2',
        direction: 'SHORT',
        entryPrice: 200,
        signalScore: -30,
        signalConfidence: 65,
        stopLossPercent: 1,
        takeProfitPercent: 2,
      });

      const tracker = getActiveTracker('test-2');
      expect(tracker).not.toBeNull();
      expect(tracker?.direction).toBe('SHORT');
    });

    it('should capture regime at entry', () => {
      const tracker = startTrackingTrade({
        tradeId: 'test-3',
        direction: 'LONG',
        entryPrice: 200,
        signalScore: 35,
        signalConfidence: 70,
        stopLossPercent: 1,
        takeProfitPercent: 2,
      });

      expect(tracker.regimeAtEntry).toBeDefined();
      expect(tracker.regimeAtEntry.marketState).toBe('trending');
    });
  });

  describe('updateTracker', () => {
    it('should update MFE when price moves favorably (LONG)', () => {
      startTrackingTrade({
        tradeId: 'mfe-test',
        direction: 'LONG',
        entryPrice: 200,
        signalScore: 35,
        signalConfidence: 70,
        stopLossPercent: 1,
        takeProfitPercent: 2,
      });

      // Price moves up 1%
      updateTracker('mfe-test', 202);

      const tracker = getActiveTracker('mfe-test');
      expect(tracker?.currentMfe).toBe(1); // 1% favorable
      expect(tracker?.currentMae).toBe(0); // No adverse movement
    });

    it('should update MAE when price moves adversely (LONG)', () => {
      startTrackingTrade({
        tradeId: 'mae-test',
        direction: 'LONG',
        entryPrice: 200,
        signalScore: 35,
        signalConfidence: 70,
        stopLossPercent: 1,
        takeProfitPercent: 2,
      });

      // Price moves down 0.5%
      updateTracker('mae-test', 199);

      const tracker = getActiveTracker('mae-test');
      expect(tracker?.currentMfe).toBe(0);
      expect(tracker?.currentMae).toBe(-0.5); // 0.5% adverse
    });

    it('should track MFE correctly for SHORT', () => {
      startTrackingTrade({
        tradeId: 'short-mfe',
        direction: 'SHORT',
        entryPrice: 200,
        signalScore: -30,
        signalConfidence: 65,
        stopLossPercent: 1,
        takeProfitPercent: 2,
      });

      // Price moves down (favorable for SHORT)
      updateTracker('short-mfe', 198);

      const tracker = getActiveTracker('short-mfe');
      expect(tracker?.currentMfe).toBe(1); // 1% favorable for SHORT
    });

    it('should track first favorable tick', () => {
      startTrackingTrade({
        tradeId: 'first-fav',
        direction: 'LONG',
        entryPrice: 200,
        signalScore: 35,
        signalConfidence: 70,
        stopLossPercent: 1,
        takeProfitPercent: 2,
      });

      // First update: adverse
      updateTracker('first-fav', 199);
      let tracker = getActiveTracker('first-fav');
      expect(tracker?.timeToFirstFavorable).toBeNull();

      // Second update: favorable
      updateTracker('first-fav', 200.5);
      tracker = getActiveTracker('first-fav');
      expect(tracker?.timeToFirstFavorable).not.toBeNull();
      expect(tracker?.firstFavorablePercent).toBeCloseTo(0.25, 1);
    });

    it('should track first significant move', () => {
      startTrackingTrade({
        tradeId: 'sig-move',
        direction: 'LONG',
        entryPrice: 200,
        signalScore: 35,
        signalConfidence: 70,
        stopLossPercent: 1,
        takeProfitPercent: 2,
      });

      // Small move (not significant)
      updateTracker('sig-move', 200.1);
      let tracker = getActiveTracker('sig-move');
      expect(tracker?.firstSignificantMove).toBeNull();

      // Significant favorable move (>0.1%)
      updateTracker('sig-move', 200.3);
      tracker = getActiveTracker('sig-move');
      expect(tracker?.firstSignificantMove).toBe('favorable');
    });

    it('should detect significant adverse move first', () => {
      startTrackingTrade({
        tradeId: 'sig-adverse',
        direction: 'LONG',
        entryPrice: 200,
        signalScore: 35,
        signalConfidence: 70,
        stopLossPercent: 1,
        takeProfitPercent: 2,
      });

      // Significant adverse move first
      updateTracker('sig-adverse', 199.7);

      const tracker = getActiveTracker('sig-adverse');
      expect(tracker?.firstSignificantMove).toBe('adverse');
    });
  });

  describe('stopTrackingTrade', () => {
    it('should finalize diagnostics when trade closes', () => {
      startTrackingTrade({
        tradeId: 'close-test',
        direction: 'LONG',
        entryPrice: 200,
        signalScore: 35,
        signalConfidence: 70,
        stopLossPercent: 1,
        takeProfitPercent: 2,
      });

      // Simulate some price movement
      updateTracker('close-test', 202); // +1%
      updateTracker('close-test', 199); // -0.5%
      updateTracker('close-test', 203); // +1.5%

      const diagnostics = stopTrackingTrade('close-test', {
        exitPrice: 203,
        exitReason: 'TAKE_PROFIT',
        theoreticalExitPrice: 203,
        actualExitPrice: 202.9,
        exitSlippageBps: 5,
        exitSlippageUsd: 0.01,
        totalFeesUsd: 0.05,
        finalPnlPercent: 1.4,
      });

      expect(diagnostics).not.toBeNull();
      expect(diagnostics?.tradeId).toBe('close-test');
      expect(diagnostics?.excursion.mfeMax).toBe(1.5);
      expect(diagnostics?.excursion.maeMax).toBe(-0.5);
      expect(diagnostics?.outcome).toBe('win');
      expect(diagnostics?.exitReason).toBe('TAKE_PROFIT');
    });

    it('should remove tracker from active trackers', () => {
      startTrackingTrade({
        tradeId: 'remove-test',
        direction: 'LONG',
        entryPrice: 200,
        signalScore: 35,
        signalConfidence: 70,
        stopLossPercent: 1,
        takeProfitPercent: 2,
      });

      expect(getActiveTracker('remove-test')).not.toBeNull();

      stopTrackingTrade('remove-test', {
        exitPrice: 201,
        exitReason: 'TAKE_PROFIT',
        theoreticalExitPrice: 201,
        actualExitPrice: 201,
        exitSlippageBps: 0,
        exitSlippageUsd: 0,
        totalFeesUsd: 0.05,
        finalPnlPercent: 0.5,
      });

      expect(getActiveTracker('remove-test')).toBeNull();
    });

    it('should calculate R-multiple correctly', () => {
      startTrackingTrade({
        tradeId: 'r-multiple',
        direction: 'LONG',
        entryPrice: 200,
        signalScore: 35,
        signalConfidence: 70,
        stopLossPercent: 1, // 1% stop
        takeProfitPercent: 2,
      });

      const diagnostics = stopTrackingTrade('r-multiple', {
        exitPrice: 204,
        exitReason: 'TAKE_PROFIT',
        theoreticalExitPrice: 204,
        actualExitPrice: 204,
        exitSlippageBps: 0,
        exitSlippageUsd: 0,
        totalFeesUsd: 0.05,
        finalPnlPercent: 2, // 2% gain = 2R
      });

      expect(diagnostics?.rMultiple).toBe(2);
    });

    it('should detect if MFE reached 2R', () => {
      startTrackingTrade({
        tradeId: '2r-test',
        direction: 'LONG',
        entryPrice: 200,
        signalScore: 35,
        signalConfidence: 70,
        stopLossPercent: 1, // 1% stop
        takeProfitPercent: 2,
      });

      // Price goes up 2.5% (>2R)
      updateTracker('2r-test', 205);

      const diagnostics = stopTrackingTrade('2r-test', {
        exitPrice: 203,
        exitReason: 'TRAILING_STOP',
        theoreticalExitPrice: 203,
        actualExitPrice: 203,
        exitSlippageBps: 0,
        exitSlippageUsd: 0,
        totalFeesUsd: 0.05,
        finalPnlPercent: 1.5,
      });

      expect(diagnostics?.mfeReachedTwoR).toBe(true);
      expect(diagnostics?.excursion.mfeMax).toBe(2.5);
    });

    it('should mark trade as loss when finalPnlPercent is negative', () => {
      startTrackingTrade({
        tradeId: 'loss-test',
        direction: 'LONG',
        entryPrice: 200,
        signalScore: 35,
        signalConfidence: 70,
        stopLossPercent: 1,
        takeProfitPercent: 2,
      });

      const diagnostics = stopTrackingTrade('loss-test', {
        exitPrice: 198,
        exitReason: 'STOP_LOSS',
        theoreticalExitPrice: 198,
        actualExitPrice: 198,
        exitSlippageBps: 0,
        exitSlippageUsd: 0,
        totalFeesUsd: 0.05,
        finalPnlPercent: -1,
      });

      expect(diagnostics?.outcome).toBe('loss');
    });
  });

  describe('MFE-before-MAE ordering', () => {
    it('should detect MFE before MAE', () => {
      startTrackingTrade({
        tradeId: 'mfe-first',
        direction: 'LONG',
        entryPrice: 200,
        signalScore: 35,
        signalConfidence: 70,
        stopLossPercent: 1,
        takeProfitPercent: 2,
      });

      // Favorable move first (>0.1% to be significant)
      updateTracker('mfe-first', 200.3); // +0.15% (significant favorable)
      updateTracker('mfe-first', 199.5); // -0.25% (significant adverse)

      const diagnostics = stopTrackingTrade('mfe-first', {
        exitPrice: 200,
        exitReason: 'MANUAL',
        theoreticalExitPrice: 200,
        actualExitPrice: 200,
        exitSlippageBps: 0,
        exitSlippageUsd: 0,
        totalFeesUsd: 0.05,
        finalPnlPercent: 0,
      });

      expect(diagnostics?.excursion.mfeBeforeMae).toBe(true);
    });

    it('should detect MAE before MFE', () => {
      startTrackingTrade({
        tradeId: 'mae-first',
        direction: 'LONG',
        entryPrice: 200,
        signalScore: 35,
        signalConfidence: 70,
        stopLossPercent: 1,
        takeProfitPercent: 2,
      });

      // Adverse move first (>0.1% to be significant)
      updateTracker('mae-first', 199.7); // -0.15% (significant adverse)
      updateTracker('mae-first', 200.5); // +0.25% (significant favorable)

      const diagnostics = stopTrackingTrade('mae-first', {
        exitPrice: 200,
        exitReason: 'MANUAL',
        theoreticalExitPrice: 200,
        actualExitPrice: 200,
        exitSlippageBps: 0,
        exitSlippageUsd: 0,
        totalFeesUsd: 0.05,
        finalPnlPercent: 0,
      });

      expect(diagnostics?.excursion.mfeBeforeMae).toBe(false);
    });
  });

  describe('getAllActiveTrackers', () => {
    it('should return all active trackers', () => {
      startTrackingTrade({
        tradeId: 'active-1',
        direction: 'LONG',
        entryPrice: 200,
        signalScore: 35,
        signalConfidence: 70,
        stopLossPercent: 1,
        takeProfitPercent: 2,
      });

      startTrackingTrade({
        tradeId: 'active-2',
        direction: 'SHORT',
        entryPrice: 200,
        signalScore: -30,
        signalConfidence: 65,
        stopLossPercent: 1,
        takeProfitPercent: 2,
      });

      const trackers = getAllActiveTrackers();
      expect(trackers.length).toBe(2);
    });
  });
});
