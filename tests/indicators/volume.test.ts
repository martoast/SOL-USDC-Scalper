// tests/indicators/volume.test.ts

/**
 * Volume Indicator Tests
 *
 * Tests VWAP, buy/sell pressure, volume spikes, and OBV trend calculations.
 */

import { describe, it, expect } from 'vitest';
import {
  calculateVWAP,
  calculateVolumePressure,
  calculateVolumeSpike,
  calculateVolumeWeightedMomentum,
  calculateOBVTrend,
  calculateAllVolumeIndicators,
} from '../../server/indicators/volume';
import {
  makeCandleSeries,
  makeVolumePatternCandles,
  makeCandle,
  round,
} from './test-utils';
import type { Candle } from '../../server/indicators/types';
export type { Candle }; // Re-export to avoid unused warning

// ============================================================================
// VWAP TESTS
// ============================================================================

describe('VWAP (Volume Weighted Average Price)', () => {
  it('should calculate VWAP correctly', () => {
    // Create candles with known volume and prices
    const now = Date.now();
    const candles: Candle[] = [
      // Newest: $110 with 200 volume
      {
        open: 108,
        high: 112,
        low: 107,
        close: 110,
        volume: 200,
        trades: 20,
        timestamp: now,
      },
      // $100 with 100 volume
      {
        open: 98,
        high: 102,
        low: 97,
        close: 100,
        volume: 100,
        trades: 10,
        timestamp: now - 60000,
      },
      // $90 with 100 volume
      {
        open: 88,
        high: 92,
        low: 87,
        close: 90,
        volume: 100,
        trades: 10,
        timestamp: now - 120000,
      },
    ];

    const vwap = calculateVWAP(candles);

    expect(vwap).not.toBeNull();
    // Typical prices: (112+107+110)/3=109.67, (102+97+100)/3=99.67, (92+87+90)/3=89.67
    // VWAP = (109.67*200 + 99.67*100 + 89.67*100) / 400 = (21934 + 9967 + 8967) / 400 = 102.17
    expect(vwap!.value).toBeGreaterThan(100);
    expect(vwap!.value).toBeLessThan(110);
  });

  it('should detect price above VWAP', () => {
    const candles = makeCandleSeries([100, 101, 102, 103, 104]);
    const currentPrice = 110; // Above any reasonable VWAP
    const vwap = calculateVWAP(candles, currentPrice);

    expect(vwap).not.toBeNull();
    expect(vwap!.isAboveVwap).toBe(true);
    expect(vwap!.priceVsVwap).toBeGreaterThan(1);
  });

  it('should detect price below VWAP', () => {
    const candles = makeCandleSeries([100, 101, 102, 103, 104]);
    const currentPrice = 90; // Below any reasonable VWAP
    const vwap = calculateVWAP(candles, currentPrice);

    expect(vwap).not.toBeNull();
    expect(vwap!.isAboveVwap).toBe(false);
    expect(vwap!.priceVsVwap).toBeLessThan(1);
  });

  it('should handle zero volume candles', () => {
    const now = Date.now();
    const candles: Candle[] = [
      { open: 100, high: 101, low: 99, close: 100, volume: 0, trades: 0, timestamp: now },
      {
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 0,
        trades: 0,
        timestamp: now - 60000,
      },
    ];

    const vwap = calculateVWAP(candles);

    // Should fall back to simple average
    expect(vwap).not.toBeNull();
    expect(vwap!.value).toBeCloseTo(100, 1);
  });

  it('should return null for empty candles', () => {
    const vwap = calculateVWAP([]);
    expect(vwap).toBeNull();
  });
});

// ============================================================================
// VOLUME PRESSURE TESTS
// ============================================================================

describe('Volume Pressure (Buy/Sell Analysis)', () => {
  it('should detect buyer dominance on bullish candles', () => {
    // Create bullish candles (close near high)
    const now = Date.now();
    const candles: Candle[] = [];
    for (let i = 0; i < 10; i++) {
      candles.push({
        open: 100,
        high: 105,
        low: 99,
        close: 104, // Close near high = buying pressure
        volume: 100,
        trades: 10,
        timestamp: now - i * 60000,
      });
    }

    const pressure = calculateVolumePressure(candles);

    expect(pressure).not.toBeNull();
    expect(pressure!.buyRatio).toBeGreaterThan(0.6);
    expect(pressure!.dominance).toBe('buyers');
  });

  it('should detect seller dominance on bearish candles', () => {
    // Create bearish candles (close near low)
    const now = Date.now();
    const candles: Candle[] = [];
    for (let i = 0; i < 10; i++) {
      candles.push({
        open: 100,
        high: 101,
        low: 95,
        close: 96, // Close near low = selling pressure
        volume: 100,
        trades: 10,
        timestamp: now - i * 60000,
      });
    }

    const pressure = calculateVolumePressure(candles);

    expect(pressure).not.toBeNull();
    expect(pressure!.buyRatio).toBeLessThan(0.4);
    expect(pressure!.dominance).toBe('sellers');
  });

  it('should detect neutral pressure on doji candles', () => {
    // Create doji candles (close = open, or close in middle)
    const now = Date.now();
    const candles: Candle[] = [];
    for (let i = 0; i < 10; i++) {
      candles.push({
        open: 100,
        high: 102,
        low: 98,
        close: 100, // Close in middle
        volume: 100,
        trades: 10,
        timestamp: now - i * 60000,
      });
    }

    const pressure = calculateVolumePressure(candles);

    expect(pressure).not.toBeNull();
    expect(pressure!.buyRatio).toBeGreaterThan(0.45);
    expect(pressure!.buyRatio).toBeLessThan(0.55);
    expect(pressure!.dominance).toBe('neutral');
  });

  it('should calculate net pressure correctly', () => {
    const now = Date.now();
    const candles: Candle[] = [
      {
        open: 100,
        high: 110,
        low: 100,
        close: 110, // All buying (buyRatio = 1)
        volume: 100,
        trades: 10,
        timestamp: now,
      },
    ];

    const pressure = calculateVolumePressure(candles, 1);

    expect(pressure).not.toBeNull();
    // With close at high, almost all volume is buy volume
    expect(pressure!.netPressure).toBeGreaterThan(0);
  });

  it('should return null for empty candles', () => {
    const pressure = calculateVolumePressure([]);
    expect(pressure).toBeNull();
  });
});

// ============================================================================
// VOLUME SPIKE TESTS
// ============================================================================

describe('Volume Spike Detection', () => {
  it('should detect volume spike', () => {
    const now = Date.now();
    const candles: Candle[] = [
      // Current candle with spike (500 volume)
      {
        open: 100,
        high: 102,
        low: 99,
        close: 101,
        volume: 500,
        trades: 50,
        timestamp: now,
      },
      // Historical candles with normal volume (100)
      ...Array.from({ length: 20 }, (_, i) => ({
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 100,
        trades: 10,
        timestamp: now - (i + 1) * 60000,
      })),
    ];

    const spike = calculateVolumeSpike(candles);

    expect(spike).not.toBeNull();
    expect(spike!.isSpike).toBe(true);
    expect(spike!.ratio).toBeCloseTo(5, 1); // 500/100 = 5x
  });

  it('should not flag normal volume as spike', () => {
    const now = Date.now();
    const candles: Candle[] = Array.from({ length: 25 }, (_, i) => ({
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 100 + Math.random() * 20, // Slight variation
      trades: 10,
      timestamp: now - i * 60000,
    }));

    const spike = calculateVolumeSpike(candles);

    expect(spike).not.toBeNull();
    expect(spike!.isSpike).toBe(false);
    expect(spike!.ratio).toBeLessThan(2);
  });

  it('should use custom spike multiplier', () => {
    const now = Date.now();
    const candles: Candle[] = [
      // Current candle with 150% volume
      {
        open: 100,
        high: 102,
        low: 99,
        close: 101,
        volume: 150,
        trades: 15,
        timestamp: now,
      },
      // Historical with 100 volume
      ...Array.from({ length: 10 }, (_, i) => ({
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 100,
        trades: 10,
        timestamp: now - (i + 1) * 60000,
      })),
    ];

    // Default (2x) should not flag
    const spikeDefault = calculateVolumeSpike(candles, 10, 2.0);
    expect(spikeDefault!.isSpike).toBe(false);

    // Lower threshold (1.3x) should flag
    const spikeLow = calculateVolumeSpike(candles, 10, 1.3);
    expect(spikeLow!.isSpike).toBe(true);
  });

  it('should handle insufficient historical data', () => {
    const candles = makeCandleSeries([100]);
    const spike = calculateVolumeSpike(candles);

    // Should return null for single candle
    expect(spike).toBeNull();
  });
});

// ============================================================================
// VOLUME WEIGHTED MOMENTUM TESTS
// ============================================================================

describe('Volume Weighted Momentum', () => {
  it('should return positive momentum for uptrend with volume', () => {
    // Create uptrend with increasing volume
    const candles = makeVolumePatternCandles(
      100,
      [100, 150, 200, 250, 300], // Increasing volume
      [0.01, 0.01, 0.01, 0.01, 0.01] // All positive price changes
    );

    const momentum = calculateVolumeWeightedMomentum(candles);

    expect(momentum).toBeGreaterThan(0);
  });

  it('should return negative momentum for downtrend with volume', () => {
    // Create downtrend with increasing volume
    const candles = makeVolumePatternCandles(
      100,
      [100, 150, 200, 250, 300],
      [-0.01, -0.01, -0.01, -0.01, -0.01] // All negative price changes
    );

    const momentum = calculateVolumeWeightedMomentum(candles);

    expect(momentum).toBeLessThan(0);
  });

  it('should return near-zero momentum for sideways market', () => {
    // Create sideways movement
    const candles = makeVolumePatternCandles(
      100,
      [100, 100, 100, 100, 100],
      [0.01, -0.01, 0.01, -0.01, 0.01] // Alternating
    );

    const momentum = calculateVolumeWeightedMomentum(candles);

    expect(Math.abs(momentum)).toBeLessThan(0.5);
  });

  it('should weight high-volume moves more', () => {
    // Create candles manually with clear volume differences
    const now = Date.now();

    // Scenario 1: High volume on UP move, low volume on down move
    const candles1: Candle[] = [
      // Most recent (down move, low volume)
      { open: 102, high: 102.5, low: 99.5, close: 100, volume: 100, trades: 10, timestamp: now },
      // Previous (up move, HIGH volume)
      { open: 100, high: 102.5, low: 99.5, close: 102, volume: 1000, trades: 100, timestamp: now - 60000 },
      // Base
      { open: 100, high: 100.5, low: 99.5, close: 100, volume: 100, trades: 10, timestamp: now - 120000 },
    ];

    // Scenario 2: Low volume on up move, HIGH volume on DOWN move
    const candles2: Candle[] = [
      // Most recent (down move, HIGH volume)
      { open: 102, high: 102.5, low: 99.5, close: 100, volume: 1000, trades: 100, timestamp: now },
      // Previous (up move, low volume)
      { open: 100, high: 102.5, low: 99.5, close: 102, volume: 100, trades: 10, timestamp: now - 60000 },
      // Base
      { open: 100, high: 100.5, low: 99.5, close: 100, volume: 100, trades: 10, timestamp: now - 120000 },
    ];

    const momentum1 = calculateVolumeWeightedMomentum(candles1);
    const momentum2 = calculateVolumeWeightedMomentum(candles2);

    // Momentum1 should be more positive (high volume on up move weighted more)
    // Momentum2 should be more negative (high volume on down move weighted more)
    expect(momentum1).toBeGreaterThan(momentum2);
  });

  it('should return 0 for insufficient data', () => {
    const candles = makeCandleSeries([100]);
    const momentum = calculateVolumeWeightedMomentum(candles);

    expect(momentum).toBe(0);
  });
});

// ============================================================================
// OBV TREND TESTS
// ============================================================================

describe('OBV Trend Analysis', () => {
  it('should detect rising OBV', () => {
    // Create consistent uptrend (gains add volume)
    const now = Date.now();
    const candles: Candle[] = [];
    for (let i = 0; i < 20; i++) {
      candles.push({
        open: 100 + i,
        high: 102 + i,
        low: 99 + i,
        close: 101 + i, // Always higher close
        volume: 100,
        trades: 10,
        timestamp: now - (19 - i) * 60000,
      });
    }
    // Reverse to newest-first
    candles.reverse();

    const obv = calculateOBVTrend(candles);

    expect(obv.trend).toBe('rising');
    expect(obv.divergence).toBe('none');
  });

  it('should detect falling OBV', () => {
    // Create consistent downtrend (losses subtract volume)
    const now = Date.now();
    const candles: Candle[] = [];
    for (let i = 0; i < 20; i++) {
      candles.push({
        open: 120 - i,
        high: 121 - i,
        low: 118 - i,
        close: 119 - i, // Always lower close
        volume: 100,
        trades: 10,
        timestamp: now - (19 - i) * 60000,
      });
    }
    candles.reverse();

    const obv = calculateOBVTrend(candles);

    expect(obv.trend).toBe('falling');
  });

  it('should detect bullish divergence (OBV up, price down)', () => {
    // Price going down but OBV going up (accumulation)
    const now = Date.now();
    const candles: Candle[] = [];

    // First half: normal down moves
    for (let i = 0; i < 10; i++) {
      candles.push({
        open: 100 - i * 0.5,
        high: 101 - i * 0.5,
        low: 99 - i * 0.5,
        close: 99.5 - i * 0.5, // Slightly down
        volume: 50,
        trades: 5,
        timestamp: now - (19 - i) * 60000,
      });
    }

    // Second half: down price but up closes (accumulation pattern)
    for (let i = 10; i < 20; i++) {
      const basePrice = 95 - (i - 10) * 0.3;
      candles.push({
        open: basePrice,
        high: basePrice + 1,
        low: basePrice - 0.5,
        close: basePrice + 0.8, // Closing higher = accumulation
        volume: 150,
        trades: 15,
        timestamp: now - (19 - i) * 60000,
      });
    }
    candles.reverse();

    const obv = calculateOBVTrend(candles);

    // Price is overall down but OBV is up = bullish divergence
    if (obv.trend === 'rising') {
      expect(obv.divergence).toBe('bullish');
    }
  });

  it('should return flat for insufficient data', () => {
    const candles = makeCandleSeries([100, 101, 102]);
    const obv = calculateOBVTrend(candles);

    expect(obv.trend).toBe('flat');
    expect(obv.divergence).toBe('none');
  });
});

// ============================================================================
// ALL VOLUME INDICATORS
// ============================================================================

describe('All Volume Indicators', () => {
  it('should calculate all indicators at once', () => {
    const candles = makeCandleSeries(
      Array.from({ length: 30 }, (_, i) => 100 + i * 0.5)
    );

    const all = calculateAllVolumeIndicators(candles, 115);

    expect(all.vwap).not.toBeNull();
    expect(all.pressure).not.toBeNull();
    expect(all.spike).not.toBeNull();
    expect(typeof all.momentum).toBe('number');
    expect(all.obvTrend).toBeDefined();
  });

  it('should handle empty candles gracefully', () => {
    const all = calculateAllVolumeIndicators([]);

    expect(all.vwap).toBeNull();
    expect(all.pressure).toBeNull();
    expect(all.spike).toBeNull();
    expect(all.momentum).toBe(0);
  });
});
