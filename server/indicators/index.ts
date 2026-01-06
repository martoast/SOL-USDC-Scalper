// server/indicators/index.ts

/**
 * Technical Indicators Engine
 *
 * Professional-grade technical analysis for SOL/USDC trading.
 * This module provides:
 * - Core indicators (EMA, RSI, MACD, Bollinger Bands, ATR)
 * - Volume analysis (VWAP, buy/sell pressure, volume spikes)
 * - Signal generation with weighted scoring
 *
 * Usage:
 *   import { getIndicators, getIndicatorSnapshot } from '../indicators';
 *
 *   // Get full snapshot for a timeframe
 *   const snapshot = getIndicatorSnapshot('1m');
 *
 *   // Or get individual indicators
 *   const indicators = getIndicators('5m', 50);
 */

// Re-export types
export * from './types';

// Re-export core indicator functions
export {
  calculateSMA,
  calculateSMASeries,
  calculateEMA,
  calculateEMASeries,
  calculateEMACollection,
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
  calculateATR,
  calculateADX,
  calculateAllCoreIndicators,
  getClosingPrices,
  standardDeviation,
  trueRange,
} from './core';

// Re-export ADX type
export type { ADXResult } from './core';

// Re-export volume indicator functions
export {
  calculateVWAP,
  calculateVolumePressure,
  calculateVolumeSpike,
  calculateVolumeWeightedMomentum,
  calculateOBVTrend,
  calculateAllVolumeIndicators,
} from './volume';

// Re-export signal generation functions
export {
  generateRSISignal,
  generateMACDSignal,
  generateEMASignal,
  generateBollingerSignal,
  generateVolumeSignal,
  generateSignals,
  getTradeDirection,
  meetsConfidenceThreshold,
  explainSignals,
} from './signals';

// Import for internal use
import type { Timeframe, IndicatorSnapshot, Candle } from './types';
import { DEFAULT_PARAMS } from './types';
import { calculateAllCoreIndicators } from './core';
import { calculateAllVolumeIndicators } from './volume';
import { generateSignals } from './signals';
import { getCandles, getLastPrice } from '../utils/sol-candles';

// ============================================================================
// HIGH-LEVEL API
// ============================================================================

/**
 * Get all indicators for a given timeframe
 *
 * This is the main entry point for the indicator system.
 * It fetches candles and calculates all indicators in one call.
 *
 * @param timeframe - Candle timeframe ('1s', '1m', '5m', etc.)
 * @param candleLimit - Maximum candles to use (default: 50)
 * @returns Complete indicator snapshot
 */
export function getIndicatorSnapshot(
  timeframe: Timeframe,
  candleLimit: number = 50
): IndicatorSnapshot | null {
  const candles = getCandles(timeframe, candleLimit);

  if (candles.length === 0) {
    return null;
  }

  const currentPrice = getLastPrice() || candles[0]?.close;

  // Calculate all indicators
  const core = calculateAllCoreIndicators(candles, currentPrice);
  const volume = calculateAllVolumeIndicators(candles, currentPrice);
  const signals = generateSignals(core, volume, currentPrice);

  return {
    timeframe,
    timestamp: Date.now(),
    price: currentPrice,
    ema: core.ema,
    rsi: core.rsi,
    macd: core.macd,
    bollingerBands: core.bollingerBands,
    atr: core.atr,
    adx: core.adx,
    vwap: volume.vwap,
    volumePressure: volume.pressure,
    volumeSpike: volume.spike,
    signals,
  };
}

/**
 * Get indicator snapshots for multiple timeframes
 *
 * Useful for multi-timeframe analysis where you want to
 * see if signals align across different time horizons.
 *
 * @param timeframes - Array of timeframes to analyze
 * @returns Map of timeframe to indicator snapshot
 */
export function getMultiTimeframeSnapshots(
  timeframes: Timeframe[] = ['1m', '5m', '10m']
): Record<Timeframe, IndicatorSnapshot | null> {
  const result: Record<string, IndicatorSnapshot | null> = {};

  for (const tf of timeframes) {
    result[tf] = getIndicatorSnapshot(tf);
  }

  return result as Record<Timeframe, IndicatorSnapshot | null>;
}

/**
 * Calculate indicators from provided candles
 *
 * Use this when you have candle data from a different source
 * (e.g., backtesting with historical data).
 *
 * @param candles - Array of candles (newest first)
 * @param timeframe - Timeframe label for the snapshot
 * @returns Complete indicator snapshot
 */
export function calculateIndicatorsFromCandles(
  candles: Candle[],
  timeframe: Timeframe = '1m'
): IndicatorSnapshot | null {
  if (candles.length === 0) {
    return null;
  }

  const currentPrice = candles[0].close;

  const core = calculateAllCoreIndicators(candles, currentPrice);
  const volume = calculateAllVolumeIndicators(candles, currentPrice);
  const signals = generateSignals(core, volume, currentPrice);

  return {
    timeframe,
    timestamp: Date.now(),
    price: currentPrice,
    ema: core.ema,
    rsi: core.rsi,
    macd: core.macd,
    bollingerBands: core.bollingerBands,
    atr: core.atr,
    adx: core.adx,
    vwap: volume.vwap,
    volumePressure: volume.pressure,
    volumeSpike: volume.spike,
    signals,
  };
}

// ============================================================================
// MULTI-TIMEFRAME CONFLUENCE
// ============================================================================

/**
 * Confluence score across multiple timeframes
 *
 * A trade signal is stronger when multiple timeframes agree.
 * This function checks alignment and returns a confluence score.
 *
 * @param timeframes - Timeframes to check
 * @returns Confluence analysis
 */
export function getConfluenceScore(
  timeframes: Timeframe[] = ['1m', '5m', '10m']
): {
  score: number;              // -100 to +100
  agreementCount: number;     // How many timeframes agree
  direction: 'LONG' | 'SHORT' | 'MIXED';
  snapshots: Record<Timeframe, IndicatorSnapshot | null>;
} {
  const snapshots = getMultiTimeframeSnapshots(timeframes);

  let bullishCount = 0;
  let bearishCount = 0;
  let totalScore = 0;
  let validCount = 0;

  for (const tf of timeframes) {
    const snapshot = snapshots[tf];
    if (snapshot) {
      validCount++;
      totalScore += snapshot.signals.compositeScore;

      if (snapshot.signals.compositeScore > 15) {
        bullishCount++;
      } else if (snapshot.signals.compositeScore < -15) {
        bearishCount++;
      }
    }
  }

  const averageScore = validCount > 0 ? totalScore / validCount : 0;
  const agreementCount = Math.max(bullishCount, bearishCount);

  let direction: 'LONG' | 'SHORT' | 'MIXED' = 'MIXED';
  if (bullishCount === validCount && validCount > 0) {
    direction = 'LONG';
  } else if (bearishCount === validCount && validCount > 0) {
    direction = 'SHORT';
  }

  return {
    score: averageScore,
    agreementCount,
    direction,
    snapshots,
  };
}

// ============================================================================
// QUICK ACCESS FUNCTIONS
// ============================================================================

/**
 * Quick RSI check - is it oversold or overbought?
 */
export function quickRSICheck(timeframe: Timeframe = '1m'): {
  value: number;
  zone: 'oversold' | 'overbought' | 'neutral';
} | null {
  const snapshot = getIndicatorSnapshot(timeframe);
  if (!snapshot?.rsi) return null;

  return {
    value: snapshot.rsi.value,
    zone: snapshot.rsi.zone,
  };
}

/**
 * Quick trend check using EMA alignment
 */
export function quickTrendCheck(timeframe: Timeframe = '5m'): {
  trend: string;
  ema9Above21: boolean;
} | null {
  const snapshot = getIndicatorSnapshot(timeframe);
  if (!snapshot?.ema) return null;

  return {
    trend: snapshot.ema.trend,
    ema9Above21: snapshot.ema.ema9Above21,
  };
}

/**
 * Quick volatility check using ATR
 */
export function quickVolatilityCheck(timeframe: Timeframe = '5m'): {
  atrPercent: number;
  level: string;
} | null {
  const snapshot = getIndicatorSnapshot(timeframe);
  if (!snapshot?.atr) return null;

  return {
    atrPercent: snapshot.atr.valuePercent,
    level: snapshot.atr.volatilityLevel,
  };
}

/**
 * Get trade recommendation with explanation
 */
export function getTradeRecommendation(timeframe: Timeframe = '1m'): {
  action: 'LONG' | 'SHORT' | 'WAIT';
  confidence: number;
  score: number;
  reasons: string[];
} | null {
  const snapshot = getIndicatorSnapshot(timeframe);
  if (!snapshot) return null;

  const { signals } = snapshot;

  // Determine action
  let action: 'LONG' | 'SHORT' | 'WAIT' = 'WAIT';
  if (signals.recommendation === 'strong_buy' || signals.recommendation === 'buy') {
    action = 'LONG';
  } else if (signals.recommendation === 'strong_sell' || signals.recommendation === 'sell') {
    action = 'SHORT';
  }

  // Generate reasons
  const reasons: string[] = [];

  if (snapshot.rsi) {
    if (snapshot.rsi.zone === 'oversold') {
      reasons.push(`RSI oversold at ${snapshot.rsi.value.toFixed(1)}`);
    } else if (snapshot.rsi.zone === 'overbought') {
      reasons.push(`RSI overbought at ${snapshot.rsi.value.toFixed(1)}`);
    }
  }

  if (snapshot.macd?.crossover === 'bullish') {
    reasons.push('MACD bullish crossover');
  } else if (snapshot.macd?.crossover === 'bearish') {
    reasons.push('MACD bearish crossover');
  }

  if (snapshot.ema.trend === 'strong_bullish') {
    reasons.push('Strong bullish trend (all EMAs aligned)');
  } else if (snapshot.ema.trend === 'strong_bearish') {
    reasons.push('Strong bearish trend (all EMAs aligned)');
  }

  if (snapshot.bollingerBands?.zone === 'below_lower') {
    reasons.push('Price below lower Bollinger Band');
  } else if (snapshot.bollingerBands?.zone === 'above_upper') {
    reasons.push('Price above upper Bollinger Band');
  }

  if (snapshot.volumeSpike?.isSpike) {
    reasons.push(`Volume spike detected (${snapshot.volumeSpike.ratio.toFixed(1)}x average)`);
  }

  return {
    action,
    confidence: signals.confidence,
    score: signals.compositeScore,
    reasons,
  };
}
