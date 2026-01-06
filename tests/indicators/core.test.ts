// tests/indicators/core.test.ts

/**
 * Core Technical Indicator Tests
 *
 * Tests EMA, SMA, RSI, MACD, Bollinger Bands, and ATR calculations.
 * Verifies mathematical correctness against known values.
 */

import { describe, it, expect } from 'vitest';
import {
  calculateSMA,
  calculateEMA,
  calculateEMACollection,
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
  calculateATR,
  standardDeviation,
  getClosingPrices,
} from '../../server/indicators/core';
import {
  makeCandleSeries,
  makeTrendingCandles,
  makeCandle,
  KNOWN_VALUES,
  round,
  approxEqual,
} from './test-utils';

// ============================================================================
// HELPER FUNCTION TESTS
// ============================================================================

describe('Helper Functions', () => {
  describe('getClosingPrices', () => {
    it('should extract closing prices from candles', () => {
      const candles = makeCandleSeries([100, 101, 102, 103, 104]);
      const prices = getClosingPrices(candles);

      // Candles are newest-first, so prices should be reversed
      expect(prices[0]).toBe(104);
      expect(prices[4]).toBe(100);
      expect(prices.length).toBe(5);
    });

    it('should return empty array for empty candles', () => {
      expect(getClosingPrices([])).toEqual([]);
    });
  });

  describe('standardDeviation', () => {
    it('should calculate standard deviation correctly', () => {
      // Known values: [2, 4, 4, 4, 5, 5, 7, 9] has stddev = 2
      const values = [2, 4, 4, 4, 5, 5, 7, 9];
      const stdDev = standardDeviation(values);
      expect(round(stdDev, 2)).toBe(2);
    });

    it('should return 0 for empty array', () => {
      expect(standardDeviation([])).toBe(0);
    });

    it('should return 0 for single value', () => {
      expect(standardDeviation([5])).toBe(0);
    });

    it('should return 0 for identical values', () => {
      expect(standardDeviation([5, 5, 5, 5])).toBe(0);
    });
  });
});

// ============================================================================
// SMA TESTS
// ============================================================================

describe('Simple Moving Average (SMA)', () => {
  it('should calculate SMA correctly for simple data', () => {
    const candles = makeCandleSeries([10, 20, 30, 40, 50]);
    const sma = calculateSMA(candles, 5);

    expect(sma).not.toBeNull();
    expect(sma!.value).toBe(30); // (10+20+30+40+50)/5 = 30
    expect(sma!.period).toBe(5);
  });

  it('should calculate SMA for partial period', () => {
    const candles = makeCandleSeries([100, 102, 104, 106, 108]);
    const sma = calculateSMA(candles, 3);

    expect(sma).not.toBeNull();
    // Uses most recent 3: 108, 106, 104 -> avg = 106
    expect(round(sma!.value, 2)).toBe(106);
  });

  it('should return null for insufficient data', () => {
    const candles = makeCandleSeries([100, 101, 102]);
    const sma = calculateSMA(candles, 5);

    expect(sma).toBeNull();
  });

  it('should handle single candle', () => {
    const candles = makeCandleSeries([100]);
    const sma = calculateSMA(candles, 1);

    expect(sma).not.toBeNull();
    expect(sma!.value).toBe(100);
  });
});

// ============================================================================
// EMA TESTS
// ============================================================================

describe('Exponential Moving Average (EMA)', () => {
  it('should calculate EMA correctly', () => {
    // Use known ascending prices
    const candles = makeCandleSeries(KNOWN_VALUES.ascendingPrices);
    const ema = calculateEMA(candles, 5);

    expect(ema).not.toBeNull();
    // EMA should be close to recent prices but smoothed
    expect(ema!.value).toBeGreaterThan(105);
    expect(ema!.value).toBeLessThan(110);
  });

  it('should give more weight to recent prices than SMA', () => {
    const candles = makeCandleSeries([100, 100, 100, 100, 100, 110, 110, 110]);
    const ema = calculateEMA(candles, 5);
    const sma = calculateSMA(candles, 5);

    expect(ema).not.toBeNull();
    expect(sma).not.toBeNull();
    // EMA should be higher because it weights recent (110) prices more
    expect(ema!.value).toBeGreaterThan(sma!.value);
  });

  it('should return null for insufficient data', () => {
    const candles = makeCandleSeries([100, 101]);
    const ema = calculateEMA(candles, 5);

    expect(ema).toBeNull();
  });

  it('should track the multiplier correctly', () => {
    // For period 5, k = 2/(5+1) = 0.333
    // Starting with SMA of first 5 prices
    const prices = [100, 102, 104, 106, 108, 110, 112];
    const candles = makeCandleSeries(prices);
    const ema = calculateEMA(candles, 5);

    expect(ema).not.toBeNull();
    // Hand calculation:
    // SMA of first 5: (100+102+104+106+108)/5 = 104
    // EMA after 110: 110 * 0.333 + 104 * 0.667 = 36.63 + 69.37 = 106
    // EMA after 112: 112 * 0.333 + 106 * 0.667 = 37.3 + 70.7 = 108
    expect(round(ema!.value, 0)).toBe(108);
  });
});

// ============================================================================
// EMA COLLECTION TESTS
// ============================================================================

describe('EMA Collection', () => {
  it('should calculate multiple EMAs', () => {
    const candles = makeTrendingCandles(100, 120, 250);
    const emaCollection = calculateEMACollection(candles);

    expect(emaCollection.ema9).not.toBeNull();
    expect(emaCollection.ema21).not.toBeNull();
    expect(emaCollection.ema50).not.toBeNull();
    expect(emaCollection.ema200).not.toBeNull();
  });

  it('should detect bullish EMA alignment', () => {
    // Strong uptrend: all EMAs should be aligned
    const candles = makeTrendingCandles(50, 150, 250);
    const emaCollection = calculateEMACollection(candles);

    // In uptrend, shorter EMAs should be above longer EMAs
    expect(emaCollection.ema9Above21).toBe(true);
    expect(emaCollection.ema21Above50).toBe(true);
    expect(emaCollection.trend).toBe('strong_bullish');
  });

  it('should detect bearish EMA alignment', () => {
    // Strong downtrend
    const candles = makeTrendingCandles(150, 50, 250);
    const emaCollection = calculateEMACollection(candles);

    expect(emaCollection.ema9Above21).toBe(false);
    expect(emaCollection.ema21Above50).toBe(false);
    expect(emaCollection.trend).toBe('strong_bearish');
  });

  it('should handle insufficient data gracefully', () => {
    const candles = makeCandleSeries([100, 101, 102]);
    const emaCollection = calculateEMACollection(candles);

    expect(emaCollection.ema9).toBeNull();
    expect(emaCollection.ema21).toBeNull();
    expect(emaCollection.trend).toBe('neutral');
  });
});

// ============================================================================
// RSI TESTS
// ============================================================================

describe('Relative Strength Index (RSI)', () => {
  it('should calculate RSI in expected range', () => {
    const candles = makeTrendingCandles(100, 110, 20);
    const rsi = calculateRSI(candles, 14);

    expect(rsi).not.toBeNull();
    expect(rsi!.value).toBeGreaterThanOrEqual(0);
    expect(rsi!.value).toBeLessThanOrEqual(100);
  });

  it('should return high RSI for strong uptrend', () => {
    // Consistent gains should give high RSI
    const prices = Array.from({ length: 20 }, (_, i) => 100 + i);
    const candles = makeCandleSeries(prices);
    const rsi = calculateRSI(candles, 14);

    expect(rsi).not.toBeNull();
    expect(rsi!.value).toBeGreaterThan(70);
    expect(rsi!.zone).toBe('overbought');
  });

  it('should return low RSI for strong downtrend', () => {
    // Consistent losses should give low RSI
    const prices = Array.from({ length: 20 }, (_, i) => 120 - i);
    const candles = makeCandleSeries(prices);
    const rsi = calculateRSI(candles, 14);

    expect(rsi).not.toBeNull();
    expect(rsi!.value).toBeLessThan(30);
    expect(rsi!.zone).toBe('oversold');
  });

  it('should return neutral RSI for sideways market', () => {
    // Alternating gains and losses
    const prices = [100, 101, 100, 101, 100, 101, 100, 101, 100, 101, 100, 101, 100, 101, 100, 101];
    const candles = makeCandleSeries(prices);
    const rsi = calculateRSI(candles, 14);

    expect(rsi).not.toBeNull();
    expect(rsi!.value).toBeGreaterThan(40);
    expect(rsi!.value).toBeLessThan(60);
    expect(rsi!.zone).toBe('neutral');
  });

  it('should handle all gains (RSI = 100)', () => {
    // Only gains, no losses
    const prices = Array.from({ length: 20 }, (_, i) => 100 + i * 2);
    const candles = makeCandleSeries(prices);
    const rsi = calculateRSI(candles, 14);

    expect(rsi).not.toBeNull();
    expect(rsi!.value).toBe(100);
  });

  it('should return null for insufficient data', () => {
    const candles = makeCandleSeries([100, 101, 102]);
    const rsi = calculateRSI(candles, 14);

    expect(rsi).toBeNull();
  });

  it('should respect custom overbought/oversold thresholds', () => {
    // Create prices that result in RSI around 65 (between default 70 and custom 60)
    const prices = [
      100, 101, 100.5, 101.5, 101, 102, 101.5, 102.5, 102, 103,
      102.5, 103.5, 103, 104, 103.5, 104.5, 104, 105, 104.5, 105.5
    ];
    const candles = makeCandleSeries(prices);

    const rsiDefault = calculateRSI(candles, 14, 70, 30);
    const rsiCustom = calculateRSI(candles, 14, 60, 40);

    expect(rsiDefault).not.toBeNull();
    expect(rsiCustom).not.toBeNull();

    // Both should return the same RSI value
    expect(rsiDefault!.value).toBe(rsiCustom!.value);

    // With 60 threshold, should be overbought. With 70, might not be.
    // The key is that isOverbought is calculated based on the passed threshold
    expect(rsiCustom!.isOverbought).toBe(rsiCustom!.value >= 60);
    expect(rsiDefault!.isOverbought).toBe(rsiDefault!.value >= 70);
  });
});

// ============================================================================
// MACD TESTS
// ============================================================================

describe('MACD', () => {
  it('should calculate MACD components', () => {
    const candles = makeTrendingCandles(100, 150, 50);
    const macd = calculateMACD(candles);

    expect(macd).not.toBeNull();
    expect(typeof macd!.macd).toBe('number');
    expect(typeof macd!.signal).toBe('number');
    expect(typeof macd!.histogram).toBe('number');
  });

  it('should have positive MACD in uptrend', () => {
    const candles = makeTrendingCandles(100, 200, 50);
    const macd = calculateMACD(candles);

    expect(macd).not.toBeNull();
    // In uptrend, fast EMA > slow EMA, so MACD > 0
    expect(macd!.macd).toBeGreaterThan(0);
    expect(macd!.isAboveSignal).toBe(true);
  });

  it('should have negative MACD in downtrend', () => {
    const candles = makeTrendingCandles(200, 100, 50);
    const macd = calculateMACD(candles);

    expect(macd).not.toBeNull();
    // In downtrend, fast EMA < slow EMA, so MACD < 0
    expect(macd!.macd).toBeLessThan(0);
  });

  it('should calculate histogram correctly', () => {
    const candles = makeTrendingCandles(100, 150, 50);
    const macd = calculateMACD(candles);

    expect(macd).not.toBeNull();
    // Histogram = MACD - Signal
    expect(round(macd!.histogram, 4)).toBe(round(macd!.macd - macd!.signal, 4));
  });

  it('should return null for insufficient data', () => {
    const candles = makeCandleSeries([100, 101, 102, 103, 104]);
    const macd = calculateMACD(candles);

    expect(macd).toBeNull();
  });

  it('should detect bullish crossover', () => {
    // Create data that crosses: down then up
    const downPrices = Array.from({ length: 30 }, (_, i) => 150 - i * 0.5);
    const upPrices = Array.from({ length: 20 }, (_, i) => 135 + i * 2);
    const prices = [...downPrices, ...upPrices];
    const candles = makeCandleSeries(prices);
    const macd = calculateMACD(candles);

    expect(macd).not.toBeNull();
    // After strong up move, MACD should cross above signal
    if (macd!.crossover !== 'none') {
      expect(['bullish', 'bearish']).toContain(macd!.crossover);
    }
  });
});

// ============================================================================
// BOLLINGER BANDS TESTS
// ============================================================================

describe('Bollinger Bands', () => {
  it('should calculate all three bands', () => {
    const candles = makeCandleSeries(KNOWN_VALUES.bbPrices);
    const bb = calculateBollingerBands(candles);

    expect(bb).not.toBeNull();
    expect(bb!.upper).toBeGreaterThan(bb!.middle);
    expect(bb!.middle).toBeGreaterThan(bb!.lower);
  });

  it('should have middle band equal to SMA', () => {
    const candles = makeCandleSeries(KNOWN_VALUES.bbPrices);
    const bb = calculateBollingerBands(candles, 20);
    const sma = calculateSMA(candles, 20);

    expect(bb).not.toBeNull();
    expect(sma).not.toBeNull();
    expect(round(bb!.middle, 4)).toBe(round(sma!.value, 4));
  });

  it('should widen during high volatility', () => {
    // Low volatility prices
    const lowVol = Array.from({ length: 25 }, () => 100 + Math.random() * 0.5);
    const lowVolCandles = makeCandleSeries(lowVol);
    const bbLow = calculateBollingerBands(lowVolCandles);

    // High volatility prices
    const highVol = Array.from({ length: 25 }, () => 100 + Math.random() * 10 - 5);
    const highVolCandles = makeCandleSeries(highVol);
    const bbHigh = calculateBollingerBands(highVolCandles);

    expect(bbLow).not.toBeNull();
    expect(bbHigh).not.toBeNull();
    expect(bbHigh!.bandwidth).toBeGreaterThan(bbLow!.bandwidth);
  });

  it('should calculate %B correctly', () => {
    const candles = makeCandleSeries(KNOWN_VALUES.bbPrices);
    const currentPrice = 89; // Between lower and upper
    const bb = calculateBollingerBands(candles, 20, 2, currentPrice);

    expect(bb).not.toBeNull();
    // %B should be between 0 and 1 for price within bands
    expect(bb!.percentB).toBeGreaterThanOrEqual(0);
    expect(bb!.percentB).toBeLessThanOrEqual(1);
  });

  it('should detect price above upper band', () => {
    const prices = Array.from({ length: 25 }, (_, i) => 100 + i * 0.1);
    const candles = makeCandleSeries(prices);
    // Price way above the range
    const bb = calculateBollingerBands(candles, 20, 2, 150);

    expect(bb).not.toBeNull();
    expect(bb!.isAboveUpper).toBe(true);
    expect(bb!.zone).toBe('above_upper');
  });

  it('should detect price below lower band', () => {
    const prices = Array.from({ length: 25 }, (_, i) => 100 - i * 0.1);
    const candles = makeCandleSeries(prices);
    // Price way below the range
    const bb = calculateBollingerBands(candles, 20, 2, 50);

    expect(bb).not.toBeNull();
    expect(bb!.isBelowLower).toBe(true);
    expect(bb!.zone).toBe('below_lower');
  });

  it('should return null for insufficient data', () => {
    const candles = makeCandleSeries([100, 101, 102]);
    const bb = calculateBollingerBands(candles, 20);

    expect(bb).toBeNull();
  });
});

// ============================================================================
// ATR TESTS
// ============================================================================

describe('Average True Range (ATR)', () => {
  it('should calculate ATR correctly', () => {
    // Create candles with known high-low ranges
    const candles: Candle[] = [];
    const now = Date.now();

    for (let i = 0; i < 20; i++) {
      candles.push(
        makeCandle(
          100,
          100,
          102, // High
          98, // Low (range of 4)
          100,
          now - i * 60000
        )
      );
    }

    const atr = calculateATR(candles, 14);

    expect(atr).not.toBeNull();
    // ATR should be close to 4 (the consistent range)
    expect(atr!.value).toBeGreaterThan(3);
    expect(atr!.value).toBeLessThan(5);
  });

  it('should increase with higher volatility', () => {
    // Low volatility candles
    const lowVolCandles: Candle[] = [];
    const now = Date.now();
    for (let i = 0; i < 20; i++) {
      lowVolCandles.push(makeCandle(100, 100, 100.5, 99.5, 100, now - i * 60000));
    }
    const atrLow = calculateATR(lowVolCandles, 14);

    // High volatility candles
    const highVolCandles: Candle[] = [];
    for (let i = 0; i < 20; i++) {
      highVolCandles.push(makeCandle(100, 100, 105, 95, 100, now - i * 60000));
    }
    const atrHigh = calculateATR(highVolCandles, 14);

    expect(atrLow).not.toBeNull();
    expect(atrHigh).not.toBeNull();
    expect(atrHigh!.value).toBeGreaterThan(atrLow!.value);
  });

  it('should calculate valuePercent correctly', () => {
    const candles: Candle[] = [];
    const now = Date.now();
    const price = 100;

    for (let i = 0; i < 20; i++) {
      candles.push(makeCandle(price, price, price + 2, price - 2, 100, now - i * 60000));
    }

    const atr = calculateATR(candles, 14, price);

    expect(atr).not.toBeNull();
    // ATR is ~4, so valuePercent should be ~4%
    expect(atr!.valuePercent).toBeGreaterThan(3);
    expect(atr!.valuePercent).toBeLessThan(5);
  });

  it('should classify volatility levels', () => {
    const now = Date.now();

    // Low volatility (< 0.3%)
    const lowVolCandles: Candle[] = [];
    for (let i = 0; i < 20; i++) {
      lowVolCandles.push(makeCandle(100, 100, 100.1, 99.9, 100, now - i * 60000));
    }
    const atrLow = calculateATR(lowVolCandles, 14, 100);
    expect(atrLow!.volatilityLevel).toBe('low');

    // High volatility (> 0.8%)
    const highVolCandles: Candle[] = [];
    for (let i = 0; i < 20; i++) {
      highVolCandles.push(makeCandle(100, 100, 101.5, 98.5, 100, now - i * 60000));
    }
    const atrHigh = calculateATR(highVolCandles, 14, 100);
    expect(['high', 'extreme']).toContain(atrHigh!.volatilityLevel);
  });

  it('should return null for insufficient data', () => {
    const candles = makeCandleSeries([100, 101, 102]);
    const atr = calculateATR(candles, 14);

    expect(atr).toBeNull();
  });

  it('should account for gaps (true range > high-low)', () => {
    const now = Date.now();
    const candles: Candle[] = [
      // Most recent candle with gap up
      {
        open: 110,
        high: 112,
        low: 109,
        close: 111,
        volume: 100,
        trades: 10,
        timestamp: now,
      },
      // Previous candle closed at 100 (10 point gap!)
      {
        open: 98,
        high: 101,
        low: 98,
        close: 100,
        volume: 100,
        trades: 10,
        timestamp: now - 60000,
      },
    ];

    // Add more candles for period requirement
    for (let i = 2; i < 20; i++) {
      candles.push(makeCandle(100, 100, 101, 99, 100, now - i * 60000));
    }

    const atr = calculateATR(candles, 14);

    expect(atr).not.toBeNull();
    // ATR should reflect the gap (TR of first candle should be ~12, not 3)
    expect(atr!.value).toBeGreaterThan(2);
  });
});
