// server/indicators/types.ts

/**
 * Technical Indicators Type Definitions
 *
 * Industry-standard interfaces for financial technical analysis
 */

import type { Candle, Timeframe } from '../utils/sol-candles';

// Re-export for convenience
export type { Candle, Timeframe };

// ============================================================================
// CORE INDICATOR TYPES
// ============================================================================

/**
 * Exponential Moving Average result
 */
export interface EMAResult {
  value: number;
  period: number;
  timestamp: number;
}

/**
 * Simple Moving Average result
 */
export interface SMAResult {
  value: number;
  period: number;
  timestamp: number;
}

/**
 * Relative Strength Index result
 */
export interface RSIResult {
  value: number;           // 0-100 scale
  period: number;
  timestamp: number;
  // Signal zones
  isOverbought: boolean;   // > 70
  isOversold: boolean;     // < 30
  zone: 'overbought' | 'oversold' | 'neutral';
}

/**
 * MACD (Moving Average Convergence Divergence) result
 */
export interface MACDResult {
  macd: number;            // MACD line (fast EMA - slow EMA)
  signal: number;          // Signal line (EMA of MACD)
  histogram: number;       // MACD - Signal
  timestamp: number;
  // Signal states
  isAboveSignal: boolean;
  isBelowSignal: boolean;
  crossover: 'bullish' | 'bearish' | 'none';  // Recent crossover
}

/**
 * Bollinger Bands result
 */
export interface BollingerBandsResult {
  upper: number;           // Upper band (SMA + k*stddev)
  middle: number;          // Middle band (SMA)
  lower: number;           // Lower band (SMA - k*stddev)
  bandwidth: number;       // (upper - lower) / middle * 100
  percentB: number;        // (price - lower) / (upper - lower)
  timestamp: number;
  // Signal states
  isAboveUpper: boolean;
  isBelowLower: boolean;
  zone: 'above_upper' | 'below_lower' | 'middle';
}

/**
 * Average True Range result
 */
export interface ATRResult {
  value: number;           // ATR value
  valuePercent: number;    // ATR as % of current price
  period: number;
  timestamp: number;
  // Volatility classification
  volatilityLevel: 'low' | 'normal' | 'high' | 'extreme';
}

// ============================================================================
// VOLUME INDICATOR TYPES
// ============================================================================

/**
 * Volume Weighted Average Price result
 */
export interface VWAPResult {
  value: number;           // VWAP price
  timestamp: number;
  // Price relation to VWAP
  priceVsVwap: number;     // Current price / VWAP
  isAboveVwap: boolean;
}

/**
 * Buy/Sell pressure analysis
 */
export interface VolumePressureResult {
  buyVolume: number;       // Estimated buy volume
  sellVolume: number;      // Estimated sell volume
  buyRatio: number;        // buyVolume / totalVolume (0-1)
  netPressure: number;     // buyVolume - sellVolume
  timestamp: number;
  // Signal
  dominance: 'buyers' | 'sellers' | 'neutral';
}

/**
 * Volume spike detection
 */
export interface VolumeSpikeResult {
  currentVolume: number;
  averageVolume: number;
  ratio: number;           // currentVolume / averageVolume
  isSpike: boolean;        // ratio > threshold (usually 2x)
  timestamp: number;
}

// ============================================================================
// AGGREGATE INDICATOR RESULTS
// ============================================================================

/**
 * All EMA values for standard periods
 */
export interface EMACollection {
  ema9: EMAResult | null;
  ema21: EMAResult | null;
  ema50: EMAResult | null;
  ema200: EMAResult | null;
  // Crossover signals
  ema9Above21: boolean;
  ema21Above50: boolean;
  ema50Above200: boolean;
  // Trend based on EMAs
  trend: 'strong_bullish' | 'bullish' | 'neutral' | 'bearish' | 'strong_bearish';
}

/**
 * ADX Result (imported from core, defined here for reference)
 */
export interface ADXResult {
  adx: number;
  plusDI: number;
  minusDI: number;
  period: number;
  timestamp: number;
  trendStrength: 'none' | 'weak' | 'moderate' | 'strong' | 'extreme';
  trendDirection: 'bullish' | 'bearish' | 'neutral';
}

/**
 * Complete indicator snapshot for a timeframe
 */
export interface IndicatorSnapshot {
  timeframe: Timeframe;
  timestamp: number;
  price: number;

  // Core indicators
  ema: EMACollection;
  rsi: RSIResult | null;
  macd: MACDResult | null;
  bollingerBands: BollingerBandsResult | null;
  atr: ATRResult | null;
  adx: ADXResult | null;

  // Volume indicators
  vwap: VWAPResult | null;
  volumePressure: VolumePressureResult | null;
  volumeSpike: VolumeSpikeResult | null;

  // Computed signals
  signals: IndicatorSignals;
}

/**
 * Aggregated trading signals from indicators
 */
export interface IndicatorSignals {
  // Individual signals (-1 to +1)
  rsiSignal: number;
  macdSignal: number;
  emaSignal: number;
  bollingerSignal: number;
  volumeSignal: number;

  // Composite score (-100 to +100)
  compositeScore: number;

  // Interpretation
  recommendation: 'strong_buy' | 'buy' | 'neutral' | 'sell' | 'strong_sell';
  confidence: number;  // 0-100
}

// ============================================================================
// CALCULATION PARAMETERS
// ============================================================================

/**
 * Standard indicator parameters
 */
export interface IndicatorParams {
  // EMA periods
  emaPeriods: number[];

  // RSI
  rsiPeriod: number;
  rsiOverbought: number;
  rsiOversold: number;

  // MACD
  macdFast: number;
  macdSlow: number;
  macdSignal: number;

  // Bollinger Bands
  bbPeriod: number;
  bbStdDev: number;

  // ATR
  atrPeriod: number;

  // Volume
  volumeSpikeMult: number;  // Multiple of average to be considered spike
  volumeLookback: number;   // Periods to average for volume
}

/**
 * Default indicator parameters (industry standard)
 */
export const DEFAULT_PARAMS: IndicatorParams = {
  emaPeriods: [9, 21, 50, 200],
  rsiPeriod: 14,
  rsiOverbought: 70,
  rsiOversold: 30,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  bbPeriod: 20,
  bbStdDev: 2,
  atrPeriod: 14,
  volumeSpikeMult: 2.0,
  volumeLookback: 20,
};
