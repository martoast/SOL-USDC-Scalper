// tests/strategy/regime.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { detectMarketRegime, isRegimeFavorable, getRegimeAdjustedParams, resetRegimeState } from '../../server/strategy/regime';
import type { IndicatorSnapshot } from '../../server/indicators/types';

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

describe('Market Regime Detection', () => {
  // Reset hysteresis state before each test to prevent interference
  beforeEach(() => {
    resetRegimeState();
  });

  describe('detectMarketRegime', () => {
    it('should detect trending bullish regime', () => {
      const snapshot = createMockSnapshot({
        adx: {
          adx: 35,
          plusDI: 30,
          minusDI: 15,
          trendStrength: 'strong',
          trendDirection: 'bullish',
        },
        ema: {
          ema9: 200,
          ema21: 198,
          ema50: 195,
          ema200: 190,
          trend: 'bullish',
          shortTermMomentum: 0.8,
          mediumTermMomentum: 0.5,
        },
      });

      const regime = detectMarketRegime(snapshot);

      expect(regime.regime).toBe('trending_bullish');
      expect(regime.confidence).toBeGreaterThan(50);
    });

    it('should detect trending bearish regime', () => {
      const snapshot = createMockSnapshot({
        adx: {
          adx: 35,
          plusDI: 15,
          minusDI: 30,
          trendStrength: 'strong',
          trendDirection: 'bearish',
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
      });

      const regime = detectMarketRegime(snapshot);

      expect(regime.regime).toBe('trending_bearish');
      expect(regime.confidence).toBeGreaterThan(50);
    });

    it('should detect ranging regime when ADX is low', () => {
      const snapshot = createMockSnapshot({
        adx: {
          adx: 18,
          plusDI: 20,
          minusDI: 18,
          trendStrength: 'weak',
          trendDirection: 'neutral',
        },
        ema: {
          ema9: 200,
          ema21: 200,
          ema50: 200,
          ema200: 200,
          trend: 'neutral',
          shortTermMomentum: 0,
          mediumTermMomentum: 0,
        },
      });

      const regime = detectMarketRegime(snapshot);

      expect(regime.regime).toBe('ranging');
    });

    it('should detect volatile regime when ATR volatility is high', () => {
      const snapshot = createMockSnapshot({
        atr: {
          value: 10,
          valuePercent: 5,
          volatilityLevel: 'high',
          avgVolatility: 3,
        },
      });

      const regime = detectMarketRegime(snapshot);

      expect(regime.regime).toBe('volatile');
    });

    it('should detect extreme volatile regime', () => {
      const snapshot = createMockSnapshot({
        atr: {
          value: 20,
          valuePercent: 10,
          volatilityLevel: 'extreme',
          avgVolatility: 5,
        },
      });

      const regime = detectMarketRegime(snapshot);

      expect(regime.regime).toBe('volatile');
      expect(regime.confidence).toBeGreaterThan(80);
    });
  });

  describe('isRegimeFavorable', () => {
    it('should return true for trending bullish with good confidence', () => {
      const regime = {
        regime: 'trending_bullish' as const,
        confidence: 70,
        adxValue: 35,
        volatilityLevel: 'normal',
        trendStrength: 'strong',
        recommendation: 'Buy',
      };

      expect(isRegimeFavorable(regime)).toBe(true);
    });

    it('should return true for trending bearish with good confidence', () => {
      const regime = {
        regime: 'trending_bearish' as const,
        confidence: 70,
        adxValue: 35,
        volatilityLevel: 'normal',
        trendStrength: 'strong',
        recommendation: 'Sell',
      };

      expect(isRegimeFavorable(regime)).toBe(true);
    });

    it('should return false for volatile regime', () => {
      const regime = {
        regime: 'volatile' as const,
        confidence: 85,
        adxValue: 35,
        volatilityLevel: 'extreme',
        trendStrength: 'strong',
        recommendation: 'Wait',
      };

      expect(isRegimeFavorable(regime)).toBe(false);
    });

    it('should return false for unknown regime', () => {
      const regime = {
        regime: 'unknown' as const,
        confidence: 0,
        adxValue: null,
        volatilityLevel: 'unknown',
        trendStrength: 'unknown',
        recommendation: 'Wait',
      };

      expect(isRegimeFavorable(regime)).toBe(false);
    });

    it('should return false for ranging when not allowed', () => {
      const regime = {
        regime: 'ranging' as const,
        confidence: 70,
        adxValue: 18,
        volatilityLevel: 'normal',
        trendStrength: 'weak',
        recommendation: 'Mean reversion',
      };

      expect(isRegimeFavorable(regime, false)).toBe(false);
    });

    it('should return true for ranging when allowed with good confidence', () => {
      const regime = {
        regime: 'ranging' as const,
        confidence: 70,
        adxValue: 18,
        volatilityLevel: 'normal',
        trendStrength: 'weak',
        recommendation: 'Mean reversion',
      };

      expect(isRegimeFavorable(regime, true)).toBe(true);
    });
  });

  describe('getRegimeAdjustedParams', () => {
    it('should return wider stops for volatile regime', () => {
      const regime = {
        regime: 'volatile' as const,
        confidence: 85,
        adxValue: 35,
        volatilityLevel: 'extreme',
        trendStrength: 'strong',
        recommendation: 'Wait',
      };

      const params = getRegimeAdjustedParams(regime);

      expect(params.stopLossMultiplier).toBe(2.0);
      expect(params.takeProfitMultiplier).toBe(3.0);
      expect(params.positionSizeMultiplier).toBe(0.5);
    });

    it('should return standard params for trending regime', () => {
      const regime = {
        regime: 'trending_bullish' as const,
        confidence: 65, // Below 70, so gets standard size
        adxValue: 35,
        volatilityLevel: 'normal',
        trendStrength: 'strong',
        recommendation: 'Buy',
      };

      const params = getRegimeAdjustedParams(regime);

      expect(params.stopLossMultiplier).toBe(1.5);
      expect(params.takeProfitMultiplier).toBe(2.5);
      expect(params.positionSizeMultiplier).toBe(1.0);
    });

    it('should return larger position size for high confidence trending', () => {
      const regime = {
        regime: 'trending_bullish' as const,
        confidence: 80,
        adxValue: 40,
        volatilityLevel: 'normal',
        trendStrength: 'strong',
        recommendation: 'Buy',
      };

      const params = getRegimeAdjustedParams(regime);

      expect(params.positionSizeMultiplier).toBe(1.2);
    });

    it('should return tighter stops for ranging regime', () => {
      const regime = {
        regime: 'ranging' as const,
        confidence: 70,
        adxValue: 18,
        volatilityLevel: 'normal',
        trendStrength: 'weak',
        recommendation: 'Mean reversion',
      };

      const params = getRegimeAdjustedParams(regime);

      expect(params.stopLossMultiplier).toBe(1.0);
      expect(params.takeProfitMultiplier).toBe(1.5);
      expect(params.positionSizeMultiplier).toBe(0.8);
    });
  });
});
