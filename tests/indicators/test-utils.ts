// tests/indicators/test-utils.ts

/**
 * Test Utilities for Indicator Tests
 *
 * Provides mock candle data and helper functions for testing.
 */

import type { Candle } from '../../server/indicators/types';

/**
 * Generate a simple candle
 */
export function makeCandle(
  close: number,
  open?: number,
  high?: number,
  low?: number,
  volume: number = 100,
  timestamp?: number
): Candle {
  const o = open ?? close;
  const h = high ?? Math.max(close, o) * 1.001;
  const l = low ?? Math.min(close, o) * 0.999;

  return {
    open: o,
    high: h,
    low: l,
    close,
    volume,
    trades: Math.floor(volume / 10),
    timestamp: timestamp ?? Date.now(),
  };
}

/**
 * Generate a series of candles with specified closing prices
 * Returns candles in newest-first order (as the system expects)
 */
export function makeCandleSeries(
  closingPrices: number[],
  baseTimestamp: number = Date.now(),
  intervalMs: number = 60000
): Candle[] {
  // Reverse so newest is first
  return closingPrices
    .map((price, i) => {
      const timestamp = baseTimestamp - (closingPrices.length - 1 - i) * intervalMs;
      return makeCandle(price, undefined, undefined, undefined, 100, timestamp);
    })
    .reverse();
}

/**
 * Generate trending candles (up or down)
 */
export function makeTrendingCandles(
  startPrice: number,
  endPrice: number,
  count: number,
  baseTimestamp: number = Date.now()
): Candle[] {
  const step = (endPrice - startPrice) / (count - 1);
  const prices: number[] = [];

  for (let i = 0; i < count; i++) {
    // Add some noise but maintain trend
    const noise = (Math.random() - 0.5) * Math.abs(step) * 0.3;
    prices.push(startPrice + step * i + noise);
  }

  return makeCandleSeries(prices, baseTimestamp);
}

/**
 * Generate oscillating candles (for RSI testing)
 */
export function makeOscillatingCandles(
  basePrice: number,
  amplitude: number,
  count: number,
  periodsPerCycle: number = 10
): Candle[] {
  const prices: number[] = [];

  for (let i = 0; i < count; i++) {
    const angle = (i / periodsPerCycle) * 2 * Math.PI;
    prices.push(basePrice + amplitude * Math.sin(angle));
  }

  return makeCandleSeries(prices);
}

/**
 * Generate candles with specific volume pattern
 */
export function makeVolumePatternCandles(
  basePrice: number,
  volumes: number[],
  priceChanges: number[]
): Candle[] {
  if (volumes.length !== priceChanges.length) {
    throw new Error('Volumes and priceChanges must have same length');
  }

  let currentPrice = basePrice;
  const candles: Candle[] = [];
  const now = Date.now();

  for (let i = 0; i < volumes.length; i++) {
    const newPrice = currentPrice * (1 + priceChanges[i]);
    candles.push(
      makeCandle(
        newPrice,
        currentPrice,
        Math.max(currentPrice, newPrice) * 1.002,
        Math.min(currentPrice, newPrice) * 0.998,
        volumes[i],
        now - (volumes.length - 1 - i) * 60000
      )
    );
    currentPrice = newPrice;
  }

  return candles.reverse(); // Newest first
}

/**
 * Known test data for verification against TradingView/other platforms
 * These are hand-calculated values for specific inputs
 */
export const KNOWN_VALUES = {
  // Simple ascending prices for EMA testing
  ascendingPrices: [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110],

  // Known RSI calculation (14-period)
  // For prices: 44, 44.34, 44.09, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08,
  //             45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41, 46.22, 45.64
  // RSI should be approximately 70.53
  rsiPrices: [
    44, 44.34, 44.09, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89,
    46.03, 45.61, 46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64,
  ],
  expectedRSI: 70.53,

  // Bollinger Band test data (20-period, 2 std dev)
  bbPrices: [
    86.16, 89.09, 88.78, 90.32, 89.07, 91.15, 89.44, 89.18, 86.93, 87.68, 86.96,
    89.43, 89.32, 88.72, 87.45, 87.26, 89.5, 87.9, 89.13, 90.7,
  ],
};

/**
 * Round to specified decimal places (for comparison)
 */
export function round(value: number, decimals: number = 2): number {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

/**
 * Check if two numbers are approximately equal
 */
export function approxEqual(a: number, b: number, tolerance: number = 0.01): boolean {
  return Math.abs(a - b) <= tolerance;
}
