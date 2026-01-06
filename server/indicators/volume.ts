// server/indicators/volume.ts

/**
 * Volume Analysis Indicators
 *
 * Volume analysis provides crucial insight into the strength of price movements.
 * These indicators help distinguish between meaningful moves with conviction
 * and weak moves likely to reverse.
 */

import type {
  Candle,
  VWAPResult,
  VolumePressureResult,
  VolumeSpikeResult,
} from './types';
import { DEFAULT_PARAMS } from './types';

// ============================================================================
// VWAP (Volume Weighted Average Price)
// ============================================================================

/**
 * Calculate Volume Weighted Average Price
 *
 * VWAP = Sum(Price * Volume) / Sum(Volume)
 *
 * VWAP is the benchmark for "fair value" within a trading session.
 * Institutional traders use VWAP to ensure their executions are at good prices.
 *
 * - Price above VWAP = buyers in control (bullish)
 * - Price below VWAP = sellers in control (bearish)
 *
 * @param candles - Array of candles (newest first)
 * @param currentPrice - Current price for comparison
 * @returns VWAP result or null if insufficient data
 */
export function calculateVWAP(
  candles: Candle[],
  currentPrice?: number
): VWAPResult | null {
  if (candles.length === 0) {
    return null;
  }

  // Filter out zero volume candles
  const validCandles = candles.filter((c) => c.volume > 0);

  if (validCandles.length === 0) {
    // If no volume data, fall back to simple average price
    const typicalPrices = candles.map((c) => (c.high + c.low + c.close) / 3);
    const avgPrice = typicalPrices.reduce((a, b) => a + b, 0) / candles.length;

    const price = currentPrice ?? candles[0].close;

    return {
      value: avgPrice,
      timestamp: candles[0]?.timestamp || Date.now(),
      priceVsVwap: price / avgPrice,
      isAboveVwap: price > avgPrice,
    };
  }

  // Calculate VWAP: sum(typical price * volume) / sum(volume)
  let sumPriceVolume = 0;
  let sumVolume = 0;

  for (const candle of validCandles) {
    // Typical price = (High + Low + Close) / 3
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    sumPriceVolume += typicalPrice * candle.volume;
    sumVolume += candle.volume;
  }

  const vwap = sumVolume > 0 ? sumPriceVolume / sumVolume : candles[0].close;
  const price = currentPrice ?? candles[0].close;

  return {
    value: vwap,
    timestamp: candles[0]?.timestamp || Date.now(),
    priceVsVwap: vwap > 0 ? price / vwap : 1,
    isAboveVwap: price > vwap,
  };
}

// ============================================================================
// VOLUME PRESSURE (Buy/Sell Analysis)
// ============================================================================

/**
 * Calculate Buy/Sell Volume Pressure
 *
 * Uses the "tick rule" to estimate buy vs sell volume:
 * - If close > open: assume volume is buying pressure
 * - If close < open: assume volume is selling pressure
 * - If close = open: split 50/50
 *
 * This is an estimation since we don't have actual trade-by-trade data.
 * In reality, we'd want order flow data (tape) for accurate buy/sell separation.
 *
 * More sophisticated version considers:
 * - Position of close within the candle range
 * - Wicks (rejection of prices)
 *
 * @param candles - Array of candles (newest first)
 * @param lookback - Number of candles to analyze
 * @returns Volume pressure result or null if insufficient data
 */
export function calculateVolumePressure(
  candles: Candle[],
  lookback: number = DEFAULT_PARAMS.volumeLookback
): VolumePressureResult | null {
  if (candles.length === 0) {
    return null;
  }

  const analyzeCandles = candles.slice(0, Math.min(lookback, candles.length));

  let buyVolume = 0;
  let sellVolume = 0;

  for (const candle of analyzeCandles) {
    const volume = candle.volume || 1; // Default to 1 if no volume

    // Calculate where close is within the candle's range
    // This is more accurate than simple open/close comparison
    const range = candle.high - candle.low;

    if (range === 0) {
      // No range - split evenly
      buyVolume += volume * 0.5;
      sellVolume += volume * 0.5;
    } else {
      // Buying pressure = how far close is from low as % of range
      // Selling pressure = how far close is from high as % of range
      const buyRatio = (candle.close - candle.low) / range;
      const sellRatio = (candle.high - candle.close) / range;

      buyVolume += volume * buyRatio;
      sellVolume += volume * sellRatio;
    }
  }

  const totalVolume = buyVolume + sellVolume;
  const buyRatio = totalVolume > 0 ? buyVolume / totalVolume : 0.5;
  const netPressure = buyVolume - sellVolume;

  // Determine dominance
  let dominance: VolumePressureResult['dominance'] = 'neutral';
  if (buyRatio > 0.55) {
    dominance = 'buyers';
  } else if (buyRatio < 0.45) {
    dominance = 'sellers';
  }

  return {
    buyVolume,
    sellVolume,
    buyRatio,
    netPressure,
    timestamp: candles[0]?.timestamp || Date.now(),
    dominance,
  };
}

// ============================================================================
// VOLUME SPIKE DETECTION
// ============================================================================

/**
 * Detect Volume Spikes
 *
 * A volume spike indicates unusual activity - potential:
 * - Institutional buying/selling
 * - News-driven movement
 * - Breakout confirmation
 * - Exhaustion (climax volume)
 *
 * Rule of thumb: Volume > 2x average = significant spike
 *
 * @param candles - Array of candles (newest first)
 * @param lookback - Periods for average calculation
 * @param spikeMultiplier - Multiple of average to be considered spike
 * @returns Volume spike result or null if insufficient data
 */
export function calculateVolumeSpike(
  candles: Candle[],
  lookback: number = DEFAULT_PARAMS.volumeLookback,
  spikeMultiplier: number = DEFAULT_PARAMS.volumeSpikeMult
): VolumeSpikeResult | null {
  if (candles.length < 2) {
    return null;
  }

  const currentVolume = candles[0]?.volume || 0;

  // Calculate average volume (excluding current candle)
  const historicalCandles = candles.slice(1, Math.min(lookback + 1, candles.length));

  if (historicalCandles.length === 0) {
    return {
      currentVolume,
      averageVolume: currentVolume,
      ratio: 1,
      isSpike: false,
      timestamp: candles[0]?.timestamp || Date.now(),
    };
  }

  const totalVolume = historicalCandles.reduce((sum, c) => sum + (c.volume || 0), 0);
  const averageVolume = totalVolume / historicalCandles.length;

  const ratio = averageVolume > 0 ? currentVolume / averageVolume : 1;
  const isSpike = ratio >= spikeMultiplier;

  return {
    currentVolume,
    averageVolume,
    ratio,
    isSpike,
    timestamp: candles[0]?.timestamp || Date.now(),
  };
}

// ============================================================================
// VOLUME WEIGHTED MOMENTUM
// ============================================================================

/**
 * Volume Weighted Momentum
 *
 * Combines price change with volume to measure the "force" of a move.
 * Strong moves have both price change AND volume.
 * Weak moves have price change but low volume (likely to reverse).
 *
 * @param candles - Array of candles (newest first)
 * @param lookback - Periods to analyze
 * @returns Momentum value (positive = bullish, negative = bearish)
 */
export function calculateVolumeWeightedMomentum(
  candles: Candle[],
  lookback: number = 10
): number {
  if (candles.length < 2) {
    return 0;
  }

  const analyzeCandles = candles.slice(0, Math.min(lookback, candles.length));

  let weightedSum = 0;
  let volumeSum = 0;

  for (let i = 0; i < analyzeCandles.length - 1; i++) {
    const current = analyzeCandles[i];
    const previous = analyzeCandles[i + 1];
    const volume = current.volume || 1;

    // Price change as percentage
    const priceChange = (current.close - previous.close) / previous.close;

    // Weight by volume
    weightedSum += priceChange * volume;
    volumeSum += volume;
  }

  return volumeSum > 0 ? (weightedSum / volumeSum) * 100 : 0;
}

// ============================================================================
// ON-BALANCE VOLUME (OBV) TREND
// ============================================================================

/**
 * Calculate On-Balance Volume Trend
 *
 * OBV adds volume on up-days and subtracts on down-days.
 * The actual value matters less than the trend.
 *
 * - OBV rising while price rising = confirmed uptrend
 * - OBV falling while price rising = weak uptrend (divergence)
 * - OBV rising while price falling = accumulation (potential reversal)
 * - OBV falling while price falling = confirmed downtrend
 *
 * @param candles - Array of candles (newest first)
 * @param lookback - Periods to analyze for trend
 * @returns OBV trend direction
 */
export function calculateOBVTrend(
  candles: Candle[],
  lookback: number = 14
): {
  trend: 'rising' | 'falling' | 'flat';
  divergence: 'bullish' | 'bearish' | 'none';
} {
  if (candles.length < lookback) {
    return { trend: 'flat', divergence: 'none' };
  }

  // Reverse to oldest-first for OBV calculation
  const reversed = candles.slice(0, lookback).reverse();

  // Calculate OBV series
  const obvValues: number[] = [0];
  for (let i = 1; i < reversed.length; i++) {
    const prev = reversed[i - 1];
    const curr = reversed[i];
    const volume = curr.volume || 1;

    let obv = obvValues[obvValues.length - 1];
    if (curr.close > prev.close) {
      obv += volume;
    } else if (curr.close < prev.close) {
      obv -= volume;
    }
    obvValues.push(obv);
  }

  // Determine OBV trend (compare first half to second half)
  const midpoint = Math.floor(obvValues.length / 2);
  const firstHalfAvg =
    obvValues.slice(0, midpoint).reduce((a, b) => a + b, 0) / midpoint;
  const secondHalfAvg =
    obvValues.slice(midpoint).reduce((a, b) => a + b, 0) / (obvValues.length - midpoint);

  let obvTrend: 'rising' | 'falling' | 'flat' = 'flat';
  const obvChange = secondHalfAvg - firstHalfAvg;
  const threshold = Math.abs(firstHalfAvg) * 0.1 || 1;

  if (obvChange > threshold) {
    obvTrend = 'rising';
  } else if (obvChange < -threshold) {
    obvTrend = 'falling';
  }

  // Determine price trend
  const firstPrice = reversed[0].close;
  const lastPrice = reversed[reversed.length - 1].close;
  const priceChange = (lastPrice - firstPrice) / firstPrice;
  const priceTrend = priceChange > 0.01 ? 'rising' : priceChange < -0.01 ? 'falling' : 'flat';

  // Detect divergence
  let divergence: 'bullish' | 'bearish' | 'none' = 'none';

  if (obvTrend === 'rising' && priceTrend === 'falling') {
    // OBV up, price down = accumulation = bullish divergence
    divergence = 'bullish';
  } else if (obvTrend === 'falling' && priceTrend === 'rising') {
    // OBV down, price up = distribution = bearish divergence
    divergence = 'bearish';
  }

  return { trend: obvTrend, divergence };
}

// ============================================================================
// AGGREGATE VOLUME INDICATORS
// ============================================================================

export interface VolumeIndicators {
  vwap: VWAPResult | null;
  pressure: VolumePressureResult | null;
  spike: VolumeSpikeResult | null;
  momentum: number;
  obvTrend: {
    trend: 'rising' | 'falling' | 'flat';
    divergence: 'bullish' | 'bearish' | 'none';
  };
}

/**
 * Calculate all volume indicators at once
 */
export function calculateAllVolumeIndicators(
  candles: Candle[],
  currentPrice?: number
): VolumeIndicators {
  return {
    vwap: calculateVWAP(candles, currentPrice),
    pressure: calculateVolumePressure(candles),
    spike: calculateVolumeSpike(candles),
    momentum: calculateVolumeWeightedMomentum(candles),
    obvTrend: calculateOBVTrend(candles),
  };
}
