// tests/indicators/signals.test.ts

/**
 * Signal Generation Tests
 *
 * Tests the signal scoring system and composite signal generation.
 */

import { describe, it, expect } from 'vitest';
import {
  generateRSISignal,
  generateMACDSignal,
  generateEMASignal,
  generateBollingerSignal,
  generateVolumeSignal,
  generateSignals,
  getTradeDirection,
  meetsConfidenceThreshold,
  explainSignals,
} from '../../server/indicators/signals';
import type {
  RSIResult,
  MACDResult,
  EMACollection,
  BollingerBandsResult,
  CoreIndicators,
} from '../../server/indicators/types';
import type { VolumeIndicators } from '../../server/indicators/volume';

// ============================================================================
// RSI SIGNAL TESTS
// ============================================================================

describe('RSI Signal Generation', () => {
  it('should generate strong buy signal for extreme oversold', () => {
    const rsi: RSIResult = {
      value: 15,
      period: 14,
      timestamp: Date.now(),
      isOverbought: false,
      isOversold: true,
      zone: 'oversold',
    };

    const signal = generateRSISignal(rsi);
    expect(signal).toBe(1.0);
  });

  it('should generate buy signal for oversold', () => {
    const rsi: RSIResult = {
      value: 25,
      period: 14,
      timestamp: Date.now(),
      isOverbought: false,
      isOversold: true,
      zone: 'oversold',
    };

    const signal = generateRSISignal(rsi);
    expect(signal).toBe(0.7);
  });

  it('should generate sell signal for overbought', () => {
    const rsi: RSIResult = {
      value: 75,
      period: 14,
      timestamp: Date.now(),
      isOverbought: true,
      isOversold: false,
      zone: 'overbought',
    };

    const signal = generateRSISignal(rsi);
    expect(signal).toBe(-0.7);
  });

  it('should generate strong sell signal for extreme overbought', () => {
    const rsi: RSIResult = {
      value: 85,
      period: 14,
      timestamp: Date.now(),
      isOverbought: true,
      isOversold: false,
      zone: 'overbought',
    };

    const signal = generateRSISignal(rsi);
    expect(signal).toBe(-1.0);
  });

  it('should generate neutral signal for mid-range RSI', () => {
    const rsi: RSIResult = {
      value: 50,
      period: 14,
      timestamp: Date.now(),
      isOverbought: false,
      isOversold: false,
      zone: 'neutral',
    };

    const signal = generateRSISignal(rsi);
    expect(signal).toBe(0);
  });

  it('should return 0 for null RSI', () => {
    const signal = generateRSISignal(null);
    expect(signal).toBe(0);
  });
});

// ============================================================================
// MACD SIGNAL TESTS
// ============================================================================

describe('MACD Signal Generation', () => {
  it('should generate strong buy signal on bullish crossover', () => {
    const macd: MACDResult = {
      macd: 0.5,
      signal: 0.3,
      histogram: 0.2,
      timestamp: Date.now(),
      isAboveSignal: true,
      isBelowSignal: false,
      crossover: 'bullish',
    };

    const signal = generateMACDSignal(macd);
    expect(signal).toBe(0.8);
  });

  it('should generate strong sell signal on bearish crossover', () => {
    const macd: MACDResult = {
      macd: -0.5,
      signal: -0.3,
      histogram: -0.2,
      timestamp: Date.now(),
      isAboveSignal: false,
      isBelowSignal: true,
      crossover: 'bearish',
    };

    const signal = generateMACDSignal(macd);
    expect(signal).toBe(-0.8);
  });

  it('should generate mild signal when above signal line (no crossover)', () => {
    const macd: MACDResult = {
      macd: 0.5,
      signal: 0.3,
      histogram: 0.2,
      timestamp: Date.now(),
      isAboveSignal: true,
      isBelowSignal: false,
      crossover: 'none',
    };

    const signal = generateMACDSignal(macd);
    expect(signal).toBeGreaterThan(0);
    expect(signal).toBeLessThan(0.8);
  });

  it('should generate mild sell signal when below signal line', () => {
    const macd: MACDResult = {
      macd: -0.5,
      signal: -0.3,
      histogram: -0.2,
      timestamp: Date.now(),
      isAboveSignal: false,
      isBelowSignal: true,
      crossover: 'none',
    };

    const signal = generateMACDSignal(macd);
    expect(signal).toBeLessThan(0);
    expect(signal).toBeGreaterThan(-0.8);
  });

  it('should return 0 for null MACD', () => {
    const signal = generateMACDSignal(null);
    expect(signal).toBe(0);
  });
});

// ============================================================================
// EMA SIGNAL TESTS
// ============================================================================

describe('EMA Signal Generation', () => {
  it('should generate strong buy signal for strong bullish trend', () => {
    const ema: EMACollection = {
      ema9: { value: 110, period: 9, timestamp: Date.now() },
      ema21: { value: 105, period: 21, timestamp: Date.now() },
      ema50: { value: 100, period: 50, timestamp: Date.now() },
      ema200: { value: 95, period: 200, timestamp: Date.now() },
      ema9Above21: true,
      ema21Above50: true,
      ema50Above200: true,
      trend: 'strong_bullish',
    };

    const signal = generateEMASignal(ema);
    expect(signal).toBe(0.8);
  });

  it('should generate strong sell signal for strong bearish trend', () => {
    const ema: EMACollection = {
      ema9: { value: 90, period: 9, timestamp: Date.now() },
      ema21: { value: 95, period: 21, timestamp: Date.now() },
      ema50: { value: 100, period: 50, timestamp: Date.now() },
      ema200: { value: 105, period: 200, timestamp: Date.now() },
      ema9Above21: false,
      ema21Above50: false,
      ema50Above200: false,
      trend: 'strong_bearish',
    };

    const signal = generateEMASignal(ema);
    expect(signal).toBe(-0.8);
  });

  it('should generate neutral signal for mixed EMAs', () => {
    const ema: EMACollection = {
      ema9: { value: 102, period: 9, timestamp: Date.now() },
      ema21: { value: 100, period: 21, timestamp: Date.now() },
      ema50: { value: 101, period: 50, timestamp: Date.now() },
      ema200: { value: 99, period: 200, timestamp: Date.now() },
      ema9Above21: true,
      ema21Above50: false,
      ema50Above200: true,
      trend: 'neutral',
    };

    const signal = generateEMASignal(ema);
    expect(signal).toBe(0);
  });

  it('should adjust signal when price is far from EMA', () => {
    const ema: EMACollection = {
      ema9: { value: 100, period: 9, timestamp: Date.now() },
      ema21: { value: 98, period: 21, timestamp: Date.now() },
      ema50: null,
      ema200: null,
      ema9Above21: true,
      ema21Above50: false,
      ema50Above200: false,
      trend: 'bullish',
    };

    // Price far above EMA21 should reduce bullish signal
    const signalFarAbove = generateEMASignal(ema, 110);
    const signalAtEMA = generateEMASignal(ema, 98);

    expect(signalFarAbove).toBeLessThan(signalAtEMA);
  });
});

// ============================================================================
// BOLLINGER BAND SIGNAL TESTS
// ============================================================================

describe('Bollinger Band Signal Generation', () => {
  it('should generate buy signal at lower band', () => {
    const bb: BollingerBandsResult = {
      upper: 110,
      middle: 100,
      lower: 90,
      bandwidth: 20,
      percentB: 0.1, // Near lower band
      timestamp: Date.now(),
      isAboveUpper: false,
      isBelowLower: false,
      zone: 'middle',
    };

    const signal = generateBollingerSignal(bb);
    expect(signal).toBeGreaterThan(0);
  });

  it('should generate strong buy signal below lower band', () => {
    const bb: BollingerBandsResult = {
      upper: 110,
      middle: 100,
      lower: 90,
      bandwidth: 20,
      percentB: -0.1, // Below lower band
      timestamp: Date.now(),
      isAboveUpper: false,
      isBelowLower: true,
      zone: 'below_lower',
    };

    const signal = generateBollingerSignal(bb);
    expect(signal).toBe(0.7);
  });

  it('should generate sell signal at upper band', () => {
    const bb: BollingerBandsResult = {
      upper: 110,
      middle: 100,
      lower: 90,
      bandwidth: 20,
      percentB: 0.9, // Near upper band
      timestamp: Date.now(),
      isAboveUpper: false,
      isBelowLower: false,
      zone: 'middle',
    };

    const signal = generateBollingerSignal(bb);
    expect(signal).toBeLessThan(0);
  });

  it('should generate strong sell signal above upper band', () => {
    const bb: BollingerBandsResult = {
      upper: 110,
      middle: 100,
      lower: 90,
      bandwidth: 20,
      percentB: 1.1, // Above upper band
      timestamp: Date.now(),
      isAboveUpper: true,
      isBelowLower: false,
      zone: 'above_upper',
    };

    const signal = generateBollingerSignal(bb);
    expect(signal).toBe(-0.7);
  });

  it('should generate neutral signal in middle zone', () => {
    const bb: BollingerBandsResult = {
      upper: 110,
      middle: 100,
      lower: 90,
      bandwidth: 20,
      percentB: 0.5, // Middle
      timestamp: Date.now(),
      isAboveUpper: false,
      isBelowLower: false,
      zone: 'middle',
    };

    const signal = generateBollingerSignal(bb);
    expect(signal).toBe(0);
  });

  it('should return 0 for null Bollinger Bands', () => {
    const signal = generateBollingerSignal(null);
    expect(signal).toBe(0);
  });
});

// ============================================================================
// VOLUME SIGNAL TESTS
// ============================================================================

describe('Volume Signal Generation', () => {
  it('should generate bullish signal for price above VWAP with buyer dominance', () => {
    const volume: VolumeIndicators = {
      vwap: {
        value: 100,
        timestamp: Date.now(),
        priceVsVwap: 1.05,
        isAboveVwap: true,
      },
      pressure: {
        buyVolume: 700,
        sellVolume: 300,
        buyRatio: 0.7,
        netPressure: 400,
        timestamp: Date.now(),
        dominance: 'buyers',
      },
      spike: null,
      momentum: 0.5,
      obvTrend: { trend: 'rising', divergence: 'none' },
    };

    const signal = generateVolumeSignal(volume);
    expect(signal).toBeGreaterThan(0.5);
  });

  it('should generate bearish signal for price below VWAP with seller dominance', () => {
    const volume: VolumeIndicators = {
      vwap: {
        value: 100,
        timestamp: Date.now(),
        priceVsVwap: 0.95,
        isAboveVwap: false,
      },
      pressure: {
        buyVolume: 300,
        sellVolume: 700,
        buyRatio: 0.3,
        netPressure: -400,
        timestamp: Date.now(),
        dominance: 'sellers',
      },
      spike: null,
      momentum: -0.5,
      obvTrend: { trend: 'falling', divergence: 'none' },
    };

    const signal = generateVolumeSignal(volume);
    expect(signal).toBeLessThan(-0.5);
  });

  it('should add bullish bias for bullish OBV divergence', () => {
    const volume: VolumeIndicators = {
      vwap: null,
      pressure: null,
      spike: null,
      momentum: 0,
      obvTrend: { trend: 'rising', divergence: 'bullish' },
    };

    const signal = generateVolumeSignal(volume);
    expect(signal).toBeGreaterThan(0);
  });

  it('should add bearish bias for bearish OBV divergence', () => {
    const volume: VolumeIndicators = {
      vwap: null,
      pressure: null,
      spike: null,
      momentum: 0,
      obvTrend: { trend: 'falling', divergence: 'bearish' },
    };

    const signal = generateVolumeSignal(volume);
    expect(signal).toBeLessThan(0);
  });
});

// ============================================================================
// COMPOSITE SIGNAL TESTS
// ============================================================================

describe('Composite Signal Generation', () => {
  const createBullishIndicators = (): { core: CoreIndicators; volume: VolumeIndicators } => ({
    core: {
      ema: {
        ema9: { value: 110, period: 9, timestamp: Date.now() },
        ema21: { value: 105, period: 21, timestamp: Date.now() },
        ema50: { value: 100, period: 50, timestamp: Date.now() },
        ema200: { value: 95, period: 200, timestamp: Date.now() },
        ema9Above21: true,
        ema21Above50: true,
        ema50Above200: true,
        trend: 'strong_bullish',
      },
      rsi: {
        value: 35,
        period: 14,
        timestamp: Date.now(),
        isOverbought: false,
        isOversold: false,
        zone: 'neutral',
      },
      macd: {
        macd: 0.5,
        signal: 0.3,
        histogram: 0.2,
        timestamp: Date.now(),
        isAboveSignal: true,
        isBelowSignal: false,
        crossover: 'bullish',
      },
      bollingerBands: {
        upper: 115,
        middle: 105,
        lower: 95,
        bandwidth: 19,
        percentB: 0.3,
        timestamp: Date.now(),
        isAboveUpper: false,
        isBelowLower: false,
        zone: 'middle',
      },
      atr: {
        value: 2,
        valuePercent: 2,
        period: 14,
        timestamp: Date.now(),
        volatilityLevel: 'normal',
      },
    },
    volume: {
      vwap: {
        value: 100,
        timestamp: Date.now(),
        priceVsVwap: 1.05,
        isAboveVwap: true,
      },
      pressure: {
        buyVolume: 600,
        sellVolume: 400,
        buyRatio: 0.6,
        netPressure: 200,
        timestamp: Date.now(),
        dominance: 'buyers',
      },
      spike: null,
      momentum: 0.3,
      obvTrend: { trend: 'rising', divergence: 'none' },
    },
  });

  const createBearishIndicators = (): { core: CoreIndicators; volume: VolumeIndicators } => ({
    core: {
      ema: {
        ema9: { value: 90, period: 9, timestamp: Date.now() },
        ema21: { value: 95, period: 21, timestamp: Date.now() },
        ema50: { value: 100, period: 50, timestamp: Date.now() },
        ema200: { value: 105, period: 200, timestamp: Date.now() },
        ema9Above21: false,
        ema21Above50: false,
        ema50Above200: false,
        trend: 'strong_bearish',
      },
      rsi: {
        value: 75,
        period: 14,
        timestamp: Date.now(),
        isOverbought: true,
        isOversold: false,
        zone: 'overbought',
      },
      macd: {
        macd: -0.5,
        signal: -0.3,
        histogram: -0.2,
        timestamp: Date.now(),
        isAboveSignal: false,
        isBelowSignal: true,
        crossover: 'bearish',
      },
      bollingerBands: {
        upper: 105,
        middle: 95,
        lower: 85,
        bandwidth: 21,
        percentB: 0.9,
        timestamp: Date.now(),
        isAboveUpper: false,
        isBelowLower: false,
        zone: 'middle',
      },
      atr: {
        value: 2,
        valuePercent: 2,
        period: 14,
        timestamp: Date.now(),
        volatilityLevel: 'normal',
      },
    },
    volume: {
      vwap: {
        value: 100,
        timestamp: Date.now(),
        priceVsVwap: 0.95,
        isAboveVwap: false,
      },
      pressure: {
        buyVolume: 400,
        sellVolume: 600,
        buyRatio: 0.4,
        netPressure: -200,
        timestamp: Date.now(),
        dominance: 'sellers',
      },
      spike: null,
      momentum: -0.3,
      obvTrend: { trend: 'falling', divergence: 'none' },
    },
  });

  it('should generate strong buy recommendation for bullish setup', () => {
    const { core, volume } = createBullishIndicators();
    const signals = generateSignals(core, volume, 105);

    expect(signals.compositeScore).toBeGreaterThan(30);
    expect(['strong_buy', 'buy']).toContain(signals.recommendation);
  });

  it('should generate strong sell recommendation for bearish setup', () => {
    const { core, volume } = createBearishIndicators();
    const signals = generateSignals(core, volume, 95);

    expect(signals.compositeScore).toBeLessThan(-30);
    expect(['strong_sell', 'sell']).toContain(signals.recommendation);
  });

  it('should have higher confidence when indicators agree', () => {
    const { core: bullishCore, volume: bullishVolume } = createBullishIndicators();
    const bullishSignals = generateSignals(bullishCore, bullishVolume, 105);

    // Create mixed indicators
    const mixedCore: CoreIndicators = {
      ...bullishCore,
      rsi: {
        value: 75, // Overbought (bearish)
        period: 14,
        timestamp: Date.now(),
        isOverbought: true,
        isOversold: false,
        zone: 'overbought',
      },
    };
    const mixedSignals = generateSignals(mixedCore, bullishVolume, 105);

    // Bullish setup should have higher confidence
    expect(bullishSignals.confidence).toBeGreaterThan(mixedSignals.confidence);
  });

  it('should return neutral for conflicting signals', () => {
    const core: CoreIndicators = {
      ema: {
        ema9: { value: 100, period: 9, timestamp: Date.now() },
        ema21: { value: 100, period: 21, timestamp: Date.now() },
        ema50: null,
        ema200: null,
        ema9Above21: false,
        ema21Above50: false,
        ema50Above200: false,
        trend: 'neutral',
      },
      rsi: {
        value: 50,
        period: 14,
        timestamp: Date.now(),
        isOverbought: false,
        isOversold: false,
        zone: 'neutral',
      },
      macd: null,
      bollingerBands: null,
      atr: null,
    };

    const volume: VolumeIndicators = {
      vwap: null,
      pressure: null,
      spike: null,
      momentum: 0,
      obvTrend: { trend: 'flat', divergence: 'none' },
    };

    const signals = generateSignals(core, volume, 100);

    expect(signals.recommendation).toBe('neutral');
    expect(Math.abs(signals.compositeScore)).toBeLessThan(15);
  });
});

// ============================================================================
// HELPER FUNCTION TESTS
// ============================================================================

describe('Signal Helper Functions', () => {
  describe('getTradeDirection', () => {
    it('should return LONG for buy recommendations', () => {
      expect(
        getTradeDirection({
          rsiSignal: 0.5,
          macdSignal: 0.5,
          emaSignal: 0.5,
          bollingerSignal: 0.5,
          volumeSignal: 0.5,
          compositeScore: 50,
          recommendation: 'strong_buy',
          confidence: 80,
        })
      ).toBe('LONG');

      expect(
        getTradeDirection({
          rsiSignal: 0.3,
          macdSignal: 0.3,
          emaSignal: 0.3,
          bollingerSignal: 0.3,
          volumeSignal: 0.3,
          compositeScore: 25,
          recommendation: 'buy',
          confidence: 60,
        })
      ).toBe('LONG');
    });

    it('should return SHORT for sell recommendations', () => {
      expect(
        getTradeDirection({
          rsiSignal: -0.5,
          macdSignal: -0.5,
          emaSignal: -0.5,
          bollingerSignal: -0.5,
          volumeSignal: -0.5,
          compositeScore: -50,
          recommendation: 'strong_sell',
          confidence: 80,
        })
      ).toBe('SHORT');
    });

    it('should return NONE for neutral recommendations', () => {
      expect(
        getTradeDirection({
          rsiSignal: 0,
          macdSignal: 0,
          emaSignal: 0,
          bollingerSignal: 0,
          volumeSignal: 0,
          compositeScore: 0,
          recommendation: 'neutral',
          confidence: 20,
        })
      ).toBe('NONE');
    });
  });

  describe('meetsConfidenceThreshold', () => {
    it('should return true when confidence meets threshold', () => {
      const signals = {
        rsiSignal: 0.5,
        macdSignal: 0.5,
        emaSignal: 0.5,
        bollingerSignal: 0.5,
        volumeSignal: 0.5,
        compositeScore: 50,
        recommendation: 'buy' as const,
        confidence: 75,
      };

      expect(meetsConfidenceThreshold(signals, 50)).toBe(true);
      expect(meetsConfidenceThreshold(signals, 75)).toBe(true);
      expect(meetsConfidenceThreshold(signals, 80)).toBe(false);
    });
  });

  describe('explainSignals', () => {
    it('should provide explanations for signals', () => {
      const signals = {
        rsiSignal: 0.7,
        macdSignal: 0.8,
        emaSignal: 0.5,
        bollingerSignal: 0.4,
        volumeSignal: 0.3,
        compositeScore: 55,
        recommendation: 'strong_buy' as const,
        confidence: 85,
      };

      const explanations = explainSignals(signals);

      expect(explanations.length).toBeGreaterThan(0);
      expect(explanations.some((e) => e.includes('RSI'))).toBe(true);
      expect(explanations.some((e) => e.includes('MACD'))).toBe(true);
      expect(explanations.some((e) => e.includes('Composite'))).toBe(true);
      expect(explanations.some((e) => e.includes('Confidence'))).toBe(true);
    });
  });
});
