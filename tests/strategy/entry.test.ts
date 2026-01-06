// tests/strategy/entry.test.ts

import { describe, it, expect } from 'vitest';
import { generateEntrySignal, hasEntrySignal } from '../../server/strategy/entry';
import { DEFAULT_STRATEGY_CONFIG } from '../../server/strategy/types';
import type { IndicatorSnapshot } from '../../server/indicators/types';
import type { MarketRegimeAnalysis } from '../../server/strategy/types';

// Helper to create mock snapshot
function createMockSnapshot(overrides: Partial<IndicatorSnapshot> = {}): IndicatorSnapshot {
  return {
    timeframe: '1m',
    timestamp: Date.now(),
    price: 200,
    ema: {
      ema9: 200,
      ema21: 199,
      ema50: 198,
      ema200: 195,
      trend: 'bullish',
      shortTermMomentum: 0.5,
      mediumTermMomentum: 0.3,
    },
    rsi: {
      value: 55,
      zone: 'neutral',
      isOverbought: false,
      isOversold: false,
      divergence: 'none',
    },
    macd: {
      macd: 0.5,
      signal: 0.3,
      histogram: 0.2,
      trend: 'bullish',
      crossover: 'none',
      isAboveSignal: true,
      isBelowSignal: false,
      histogramDirection: 'expanding',
    },
    bollingerBands: {
      upper: 205,
      middle: 200,
      lower: 195,
      width: 5,
      percentB: 0.5,
      zone: 'middle',
      squeeze: false,
    },
    atr: {
      value: 2,
      valuePercent: 1,
      volatilityLevel: 'normal',
      avgVolatility: 1.8,
    },
    adx: {
      adx: 30,
      plusDI: 25,
      minusDI: 15,
      trendStrength: 'moderate',
      trendDirection: 'bullish',
    },
    vwap: {
      vwap: 199,
      deviation: 0.5,
      position: 'above',
    },
    volumePressure: {
      buyVolume: 60,
      sellVolume: 40,
      ratio: 1.5,
      dominance: 'buyers',
      netPressure: 20,
    },
    signals: {
      compositeScore: 25,
      direction: 'bullish',
      strength: 'moderate',
      confidence: 65,
      components: {
        rsi: 10,
        macd: 15,
        ema: 20,
        bollinger: 5,
        volume: 10,
      },
    },
    candleCount: 100,
    ...overrides,
  };
}

function createBullishRegime(): MarketRegimeAnalysis {
  return {
    regime: 'trending_bullish',
    confidence: 70,
    adxValue: 35,
    volatilityLevel: 'normal',
    trendStrength: 'strong',
    recommendation: 'Look for LONG entries',
  };
}

function createBearishRegime(): MarketRegimeAnalysis {
  return {
    regime: 'trending_bearish',
    confidence: 70,
    adxValue: 35,
    volatilityLevel: 'normal',
    trendStrength: 'strong',
    recommendation: 'Look for SHORT entries',
  };
}

function createVolatileRegime(): MarketRegimeAnalysis {
  return {
    regime: 'volatile',
    confidence: 85,
    adxValue: 35,
    volatilityLevel: 'extreme',
    trendStrength: 'strong',
    recommendation: 'Wait for volatility to decrease',
  };
}

describe('Entry Signal Generator', () => {
  describe('generateEntrySignal', () => {
    it('should generate LONG signal with bullish indicators', () => {
      const snapshot = createMockSnapshot({
        signals: {
          compositeScore: 35,
          direction: 'bullish',
          strength: 'strong',
          confidence: 75,
          components: {
            rsi: 15,
            macd: 20,
            ema: 25,
            bollinger: 10,
            volume: 15,
          },
        },
        rsi: {
          value: 35,
          zone: 'oversold',
          isOverbought: false,
          isOversold: true,
          divergence: 'none',
        },
        macd: {
          macd: 0.5,
          signal: 0.3,
          histogram: 0.2,
          trend: 'bullish',
          crossover: 'bullish',
          isAboveSignal: true,
          isBelowSignal: false,
          histogramDirection: 'expanding',
        },
      });

      const regime = createBullishRegime();
      const entry = generateEntrySignal(snapshot, regime, 200, DEFAULT_STRATEGY_CONFIG);

      expect(entry.direction).toBe('LONG');
      expect(entry.shouldEnter).toBe(true);
      expect(entry.confidence).toBeGreaterThan(50);
      expect(entry.reasons.length).toBeGreaterThan(0);
    });

    it('should generate SHORT signal with bearish indicators', () => {
      const snapshot = createMockSnapshot({
        signals: {
          compositeScore: -35,
          direction: 'bearish',
          strength: 'strong',
          confidence: 75,
          components: {
            rsi: -15,
            macd: -20,
            ema: -25,
            bollinger: -10,
            volume: -15,
          },
        },
        ema: {
          ema9: 195,
          ema21: 198,
          ema50: 200,
          ema200: 205,
          trend: 'bearish',
          shortTermMomentum: -0.8,
          mediumTermMomentum: -0.5,
        },
        rsi: {
          value: 75,
          zone: 'overbought',
          isOverbought: true,
          isOversold: false,
          divergence: 'none',
        },
        macd: {
          macd: -0.5,
          signal: -0.3,
          histogram: -0.2,
          trend: 'bearish',
          crossover: 'bearish',
          isAboveSignal: false,
          isBelowSignal: true,
          histogramDirection: 'expanding',
        },
      });

      const regime = createBearishRegime();
      const entry = generateEntrySignal(snapshot, regime, 200, DEFAULT_STRATEGY_CONFIG);

      expect(entry.direction).toBe('SHORT');
      expect(entry.shouldEnter).toBe(true);
    });

    it('should not enter in volatile regime when filter enabled', () => {
      const snapshot = createMockSnapshot({
        signals: {
          compositeScore: 35,
          direction: 'bullish',
          strength: 'strong',
          confidence: 75,
          components: {
            rsi: 15,
            macd: 20,
            ema: 25,
            bollinger: 10,
            volume: 15,
          },
        },
      });

      const regime = createVolatileRegime();
      const config = { ...DEFAULT_STRATEGY_CONFIG, enableRegimeFilter: true };
      const entry = generateEntrySignal(snapshot, regime, 200, config);

      expect(entry.shouldEnter).toBe(false);
      expect(entry.warnings).toContain('Regime filter blocked entry');
    });

    it('should not enter with low confidence', () => {
      const snapshot = createMockSnapshot({
        signals: {
          compositeScore: 25,
          direction: 'bullish',
          strength: 'weak',
          confidence: 30,
          components: {
            rsi: 5,
            macd: 10,
            ema: 5,
            bollinger: 3,
            volume: 2,
          },
        },
      });

      const regime = createBullishRegime();
      const entry = generateEntrySignal(snapshot, regime, 200, DEFAULT_STRATEGY_CONFIG);

      expect(entry.direction).toBe('NONE');
    });

    it('should calculate ATR-based stop loss and take profit', () => {
      const snapshot = createMockSnapshot({
        atr: {
          value: 3,
          valuePercent: 1.5,
          volatilityLevel: 'normal',
          avgVolatility: 2.5,
        },
        signals: {
          compositeScore: 35,
          direction: 'bullish',
          strength: 'strong',
          confidence: 75,
          components: {
            rsi: 15,
            macd: 20,
            ema: 25,
            bollinger: 10,
            volume: 15,
          },
        },
      });

      const regime = createBullishRegime();
      const entry = generateEntrySignal(snapshot, regime, 200, DEFAULT_STRATEGY_CONFIG);

      // For LONG: SL should be below entry, TP should be above
      expect(entry.suggestedStopLoss).toBeLessThan(200);
      expect(entry.suggestedTakeProfit).toBeGreaterThan(200);
      expect(entry.stopLossPercent).toBeGreaterThan(0);
      expect(entry.takeProfitPercent).toBeGreaterThan(0);
    });

    it('should add warnings when going against EMA trend', () => {
      const snapshot = createMockSnapshot({
        signals: {
          compositeScore: 30,
          direction: 'bullish',
          strength: 'moderate',
          confidence: 60,
          components: {
            rsi: 10,
            macd: 15,
            ema: 5,
            bollinger: 5,
            volume: 5,
          },
        },
        ema: {
          ema9: 195,
          ema21: 198,
          ema50: 200,
          ema200: 205,
          trend: 'bearish',
          shortTermMomentum: -0.5,
          mediumTermMomentum: -0.3,
        },
      });

      const regime = createBullishRegime();
      const entry = generateEntrySignal(snapshot, regime, 200, DEFAULT_STRATEGY_CONFIG);

      expect(entry.warnings.some((w) => w.includes('EMA trend'))).toBe(true);
    });

    it('should boost confidence with MACD crossover', () => {
      const snapshotWithCrossover = createMockSnapshot({
        signals: {
          compositeScore: 35,
          direction: 'bullish',
          strength: 'strong',
          confidence: 70,
          components: {
            rsi: 15,
            macd: 20,
            ema: 25,
            bollinger: 10,
            volume: 15,
          },
        },
        macd: {
          macd: 0.5,
          signal: 0.3,
          histogram: 0.2,
          trend: 'bullish',
          crossover: 'bullish',
          isAboveSignal: true,
          isBelowSignal: false,
          histogramDirection: 'expanding',
        },
      });

      const regime = createBullishRegime();
      const entry = generateEntrySignal(snapshotWithCrossover, regime, 200, DEFAULT_STRATEGY_CONFIG);

      expect(entry.reasons.some((r) => r.includes('MACD bullish crossover'))).toBe(true);
    });

    it('should include indicator values in response', () => {
      const snapshot = createMockSnapshot();
      const regime = createBullishRegime();
      const entry = generateEntrySignal(snapshot, regime, 200, DEFAULT_STRATEGY_CONFIG);

      expect(entry.indicators.rsi).toBe(55);
      expect(entry.indicators.emaTrend).toBe('bullish');
      expect(entry.indicators.adx).toBe(30);
    });
  });

  describe('hasEntrySignal', () => {
    it('should return true for valid entry signal', () => {
      const entry = {
        shouldEnter: true,
        direction: 'LONG' as const,
        confidence: 70,
        score: 35,
        suggestedStopLoss: 195,
        suggestedTakeProfit: 210,
        stopLossPercent: 2.5,
        takeProfitPercent: 5,
        suggestedSizeMultiplier: 1,
        reasons: ['Test'],
        warnings: [],
        indicators: {
          rsi: 55,
          macdHistogram: 0.2,
          emaTrend: 'bullish',
          adx: 30,
          atrPercent: 1,
        },
        timestamp: Date.now(),
      };

      expect(hasEntrySignal(entry)).toBe(true);
    });

    it('should return false when shouldEnter is false', () => {
      const entry = {
        shouldEnter: false,
        direction: 'LONG' as const,
        confidence: 70,
        score: 35,
        suggestedStopLoss: 195,
        suggestedTakeProfit: 210,
        stopLossPercent: 2.5,
        takeProfitPercent: 5,
        suggestedSizeMultiplier: 1,
        reasons: [],
        warnings: ['Too many warnings'],
        indicators: {
          rsi: 55,
          macdHistogram: 0.2,
          emaTrend: 'bullish',
          adx: 30,
          atrPercent: 1,
        },
        timestamp: Date.now(),
      };

      expect(hasEntrySignal(entry)).toBe(false);
    });

    it('should return false when direction is NONE', () => {
      const entry = {
        shouldEnter: true,
        direction: 'NONE' as const,
        confidence: 30,
        score: 10,
        suggestedStopLoss: 200,
        suggestedTakeProfit: 200,
        stopLossPercent: 0,
        takeProfitPercent: 0,
        suggestedSizeMultiplier: 0,
        reasons: [],
        warnings: [],
        indicators: {
          rsi: 55,
          macdHistogram: 0.2,
          emaTrend: 'neutral',
          adx: 15,
          atrPercent: 1,
        },
        timestamp: Date.now(),
      };

      expect(hasEntrySignal(entry)).toBe(false);
    });
  });
});
