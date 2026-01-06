// server/indicators/signals.ts

/**
 * Signal Generation Engine
 *
 * Combines multiple indicators into actionable trading signals.
 * Uses a weighted scoring system to avoid over-reliance on any single indicator.
 *
 * Philosophy:
 * - No single indicator is reliable on its own
 * - Confluence (multiple indicators agreeing) increases probability
 * - Signals are scored, not binary - this allows for confidence levels
 */

import type {
  IndicatorSignals,
  CoreIndicators,
  VolumeIndicators,
} from './types';

// ============================================================================
// SIGNAL WEIGHTS
// ============================================================================

/**
 * Weights for combining indicator signals
 * Sum should equal 100 for easy interpretation
 */
const SIGNAL_WEIGHTS = {
  rsi: 20,           // RSI is a strong mean-reversion signal
  macd: 25,          // MACD captures momentum well
  ema: 25,           // EMA alignment is foundational
  bollinger: 15,     // Bollinger for volatility breakouts
  volume: 15,        // Volume confirms conviction
};

// ============================================================================
// INDIVIDUAL SIGNAL CALCULATIONS
// ============================================================================

/**
 * Generate RSI signal
 *
 * RSI is primarily a mean-reversion indicator:
 * - Oversold (< 30): Bullish signal (expect bounce)
 * - Overbought (> 70): Bearish signal (expect pullback)
 * - Middle zone: Neutral, trend-following from direction
 *
 * @returns Signal from -1 (strong sell) to +1 (strong buy)
 */
export function generateRSISignal(rsi: CoreIndicators['rsi']): number {
  if (!rsi) return 0;

  const value = rsi.value;

  // Extreme oversold - strong buy
  if (value <= 20) return 1.0;

  // Oversold - buy
  if (value <= 30) return 0.7;

  // Slightly oversold - mild buy
  if (value <= 40) return 0.3;

  // Neutral zone
  if (value <= 60) return 0;

  // Slightly overbought - mild sell
  if (value <= 70) return -0.3;

  // Overbought - sell
  if (value <= 80) return -0.7;

  // Extreme overbought - strong sell
  return -1.0;
}

/**
 * Generate MACD signal
 *
 * MACD captures momentum and trend direction:
 * - MACD above signal: Bullish momentum
 * - MACD below signal: Bearish momentum
 * - Histogram magnitude indicates strength
 * - Crossovers are the strongest signals
 *
 * @returns Signal from -1 (strong sell) to +1 (strong buy)
 */
export function generateMACDSignal(macd: CoreIndicators['macd']): number {
  if (!macd) return 0;

  let signal = 0;

  // Crossover is the strongest signal
  if (macd.crossover === 'bullish') {
    signal = 0.8;
  } else if (macd.crossover === 'bearish') {
    signal = -0.8;
  } else {
    // No crossover - use position relative to signal line
    if (macd.isAboveSignal) {
      // Bullish - scale by histogram strength
      signal = Math.min(0.6, Math.abs(macd.histogram) * 10);
    } else {
      // Bearish - scale by histogram strength
      signal = -Math.min(0.6, Math.abs(macd.histogram) * 10);
    }
  }

  // Boost signal if histogram is growing (momentum increasing)
  // This would require historical histogram data, simplified here

  return Math.max(-1, Math.min(1, signal));
}

/**
 * Generate EMA signal
 *
 * EMA alignment indicates trend strength:
 * - All EMAs aligned (9 > 21 > 50 > 200): Strong trend
 * - Price above/below EMAs: Direction
 * - EMA crossovers: Trend changes
 *
 * @returns Signal from -1 (strong sell) to +1 (strong buy)
 */
export function generateEMASignal(
  ema: CoreIndicators['ema'],
  currentPrice?: number
): number {
  if (!ema) return 0;

  let signal = 0;

  // Trend-based signal
  switch (ema.trend) {
    case 'strong_bullish':
      signal = 0.8;
      break;
    case 'bullish':
      signal = 0.5;
      break;
    case 'bearish':
      signal = -0.5;
      break;
    case 'strong_bearish':
      signal = -0.8;
      break;
    default:
      signal = 0;
  }

  // Adjust based on price position relative to EMAs
  if (currentPrice && ema.ema21) {
    const ema21Value = ema.ema21.value;
    const distancePercent = ((currentPrice - ema21Value) / ema21Value) * 100;

    // Price far above EMA21 = overbought territory
    if (distancePercent > 2) {
      signal -= 0.2;  // Reduce bullish signal
    } else if (distancePercent < -2) {
      signal += 0.2;  // Reduce bearish signal
    }
  }

  return Math.max(-1, Math.min(1, signal));
}

/**
 * Generate Bollinger Bands signal
 *
 * Bollinger Bands capture volatility and mean-reversion:
 * - Price at lower band: Potential bounce (bullish)
 * - Price at upper band: Potential pullback (bearish)
 * - Bandwidth squeeze: Expect breakout
 *
 * Note: In strong trends, bands become support/resistance, not reversal signals
 *
 * @returns Signal from -1 (strong sell) to +1 (strong buy)
 */
export function generateBollingerSignal(bb: CoreIndicators['bollingerBands']): number {
  if (!bb) return 0;

  let signal = 0;

  // %B based signal (0 = at lower band, 1 = at upper band)
  const percentB = bb.percentB;

  if (percentB <= 0) {
    // At or below lower band - oversold
    signal = 0.7;
  } else if (percentB <= 0.2) {
    // Near lower band - mild bullish
    signal = 0.4;
  } else if (percentB >= 1) {
    // At or above upper band - overbought
    signal = -0.7;
  } else if (percentB >= 0.8) {
    // Near upper band - mild bearish
    signal = -0.4;
  }
  // Middle zone (0.2 to 0.8) returns 0 (neutral)

  return signal;
}

/**
 * Generate Volume signal
 *
 * Volume confirms price movements:
 * - High volume + price up: Strong bullish
 * - High volume + price down: Strong bearish
 * - Low volume moves are suspect (likely to reverse)
 * - Volume spikes can signal exhaustion or breakout
 *
 * @returns Signal from -1 (strong sell) to +1 (strong buy)
 */
export function generateVolumeSignal(volume: VolumeIndicators): number {
  if (!volume) return 0;

  let signal = 0;

  // VWAP positioning
  if (volume.vwap) {
    if (volume.vwap.isAboveVwap) {
      signal += 0.3;  // Price above VWAP = bullish
    } else {
      signal -= 0.3;  // Price below VWAP = bearish
    }
  }

  // Volume pressure (buy/sell dominance)
  if (volume.pressure) {
    const buyRatio = volume.pressure.buyRatio;
    if (buyRatio > 0.6) {
      signal += 0.3;  // Buyers dominant
    } else if (buyRatio < 0.4) {
      signal -= 0.3;  // Sellers dominant
    }
  }

  // Volume momentum
  if (Math.abs(volume.momentum) > 0.1) {
    signal += volume.momentum > 0 ? 0.2 : -0.2;
  }

  // OBV divergence (these are reversal signals)
  if (volume.obvTrend.divergence === 'bullish') {
    signal += 0.3;  // Accumulation despite price drop
  } else if (volume.obvTrend.divergence === 'bearish') {
    signal -= 0.3;  // Distribution despite price rise
  }

  return Math.max(-1, Math.min(1, signal));
}

// ============================================================================
// COMPOSITE SIGNAL GENERATION
// ============================================================================

/**
 * Generate all signals and composite score
 *
 * @param core - Core technical indicators
 * @param volume - Volume indicators
 * @param currentPrice - Current price for calculations
 * @returns Complete signal analysis
 */
export function generateSignals(
  core: CoreIndicators,
  volume: VolumeIndicators,
  currentPrice?: number
): IndicatorSignals {
  // Calculate individual signals (-1 to +1)
  const rsiSignal = generateRSISignal(core.rsi);
  const macdSignal = generateMACDSignal(core.macd);
  const emaSignal = generateEMASignal(core.ema, currentPrice);
  const bollingerSignal = generateBollingerSignal(core.bollingerBands);
  const volumeSignal = generateVolumeSignal(volume);

  // Calculate weighted composite score (-100 to +100)
  const compositeScore =
    rsiSignal * SIGNAL_WEIGHTS.rsi +
    macdSignal * SIGNAL_WEIGHTS.macd +
    emaSignal * SIGNAL_WEIGHTS.ema +
    bollingerSignal * SIGNAL_WEIGHTS.bollinger +
    volumeSignal * SIGNAL_WEIGHTS.volume;

  // Determine recommendation based on composite score
  let recommendation: IndicatorSignals['recommendation'];
  if (compositeScore >= 40) {
    recommendation = 'strong_buy';
  } else if (compositeScore >= 15) {
    recommendation = 'buy';
  } else if (compositeScore <= -40) {
    recommendation = 'strong_sell';
  } else if (compositeScore <= -15) {
    recommendation = 'sell';
  } else {
    recommendation = 'neutral';
  }

  // Calculate confidence based on indicator agreement
  const signals = [rsiSignal, macdSignal, emaSignal, bollingerSignal, volumeSignal];
  const positiveSignals = signals.filter((s) => s > 0.2).length;
  const negativeSignals = signals.filter((s) => s < -0.2).length;
  const neutralSignals = signals.filter((s) => Math.abs(s) <= 0.2).length;

  // Confidence increases when indicators agree
  const agreementCount = Math.max(positiveSignals, negativeSignals);
  const confidence = Math.min(100, agreementCount * 20 + Math.abs(compositeScore));

  return {
    rsiSignal,
    macdSignal,
    emaSignal,
    bollingerSignal,
    volumeSignal,
    compositeScore,
    recommendation,
    confidence,
  };
}

// ============================================================================
// SIGNAL INTERPRETATION HELPERS
// ============================================================================

/**
 * Convert recommendation to actionable direction
 */
export function getTradeDirection(
  signals: IndicatorSignals
): 'LONG' | 'SHORT' | 'NONE' {
  if (signals.recommendation === 'strong_buy' || signals.recommendation === 'buy') {
    return 'LONG';
  }
  if (signals.recommendation === 'strong_sell' || signals.recommendation === 'sell') {
    return 'SHORT';
  }
  return 'NONE';
}

/**
 * Check if signal meets minimum confidence threshold
 */
export function meetsConfidenceThreshold(
  signals: IndicatorSignals,
  minConfidence: number = 50
): boolean {
  return signals.confidence >= minConfidence;
}

/**
 * Get human-readable signal explanation
 */
export function explainSignals(signals: IndicatorSignals): string[] {
  const explanations: string[] = [];

  // RSI
  if (signals.rsiSignal > 0.5) {
    explanations.push('RSI shows oversold conditions - potential bounce');
  } else if (signals.rsiSignal < -0.5) {
    explanations.push('RSI shows overbought conditions - potential pullback');
  }

  // MACD
  if (signals.macdSignal > 0.5) {
    explanations.push('MACD bullish - momentum favors upside');
  } else if (signals.macdSignal < -0.5) {
    explanations.push('MACD bearish - momentum favors downside');
  }

  // EMA
  if (signals.emaSignal > 0.5) {
    explanations.push('EMAs aligned bullish - trend is up');
  } else if (signals.emaSignal < -0.5) {
    explanations.push('EMAs aligned bearish - trend is down');
  }

  // Bollinger
  if (signals.bollingerSignal > 0.5) {
    explanations.push('Price near lower Bollinger Band - oversold');
  } else if (signals.bollingerSignal < -0.5) {
    explanations.push('Price near upper Bollinger Band - overbought');
  }

  // Volume
  if (signals.volumeSignal > 0.3) {
    explanations.push('Volume supports bullish move');
  } else if (signals.volumeSignal < -0.3) {
    explanations.push('Volume supports bearish move');
  }

  // Overall
  explanations.push(
    `Composite score: ${signals.compositeScore.toFixed(1)} (${signals.recommendation})`
  );
  explanations.push(`Confidence: ${signals.confidence.toFixed(0)}%`);

  return explanations;
}
