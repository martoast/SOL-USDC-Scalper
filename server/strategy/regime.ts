// server/strategy/regime.ts

/**
 * Market Regime Detection
 *
 * Determines the current market regime to adapt strategy accordingly:
 * - Trending markets: Use momentum/trend-following
 * - Ranging markets: Use mean-reversion
 * - Volatile markets: Reduce size, widen stops
 */

import type { IndicatorSnapshot } from '../indicators/types';
import type { MarketRegime, MarketRegimeAnalysis } from './types';

// ============================================================================
// HYSTERESIS STATE
// ============================================================================

// Track confirmed regime (what we output) and pending regime (what we're testing)
let confirmedRegime: MarketRegime = 'unknown';
let pendingRegime: MarketRegime = 'unknown';
let pendingCount = 0; // How many consecutive times we've seen pendingRegime

/**
 * Reset regime hysteresis state (for testing)
 */
export function resetRegimeState(): void {
  confirmedRegime = 'unknown';
  pendingRegime = 'unknown';
  pendingCount = 0;
}

// Thresholds
const ADX_ENTER_TRENDING = 25;  // Need ADX >= 25 to become "trending"
const ADX_EXIT_TRENDING = 18;   // Need ADX <= 18 to exit "trending" (hysteresis gap)
const STABILITY_REQUIRED = 5;   // Must see same regime 5x before switching (5 seconds)

/**
 * Detect the current market regime
 *
 * Uses ADX for trend strength and ATR for volatility classification.
 *
 * @param snapshot - Current indicator snapshot
 * @returns Market regime analysis
 */
export function detectMarketRegime(snapshot: IndicatorSnapshot): MarketRegimeAnalysis {
  const { adx, atr, ema, rsi } = snapshot;

  // Default values if indicators not available
  let rawRegime: MarketRegime = 'unknown';
  let confidence = 0;
  let recommendation = 'Wait for more data';

  // Extract values
  const adxValue = adx?.adx ?? null;
  const trendStrength = adx?.trendStrength ?? 'unknown';
  const trendDirection = adx?.trendDirection ?? 'neutral';
  const volatilityLevel = atr?.volatilityLevel ?? 'unknown';

  // ============================================================================
  // REGIME CLASSIFICATION LOGIC (with hysteresis)
  // ============================================================================

  // Check if we're currently in a trending state
  const wasInTrend = confirmedRegime === 'trending_bullish' || confirmedRegime === 'trending_bearish';

  // 1. Check for VOLATILE regime first (takes priority)
  if (volatilityLevel === 'extreme' || volatilityLevel === 'high') {
    rawRegime = 'volatile';
    confidence = volatilityLevel === 'extreme' ? 85 : 70;
    recommendation = 'Reduce position size, widen stops, or wait for volatility to decrease';
  }
  // 2. Check for TRENDING regime with hysteresis
  else if (adxValue !== null) {
    // Use different thresholds based on current state (hysteresis)
    const shouldBeTrending = wasInTrend
      ? adxValue >= ADX_EXIT_TRENDING  // Stay trending until ADX drops below 18
      : adxValue >= ADX_ENTER_TRENDING; // Need ADX >= 25 to become trending

    if (shouldBeTrending) {
      if (trendDirection === 'bullish' || (ema.trend === 'bullish' || ema.trend === 'strong_bullish')) {
        rawRegime = 'trending_bullish';
        confidence = calculateTrendConfidence(adxValue, ema.trend, 'bullish');
        recommendation = 'Look for LONG entries on pullbacks. Follow the trend.';
      } else if (trendDirection === 'bearish' || (ema.trend === 'bearish' || ema.trend === 'strong_bearish')) {
        rawRegime = 'trending_bearish';
        confidence = calculateTrendConfidence(adxValue, ema.trend, 'bearish');
        recommendation = 'Look for SHORT entries on rallies. Follow the trend.';
      } else {
        // ADX shows trend strength but direction unclear
        rawRegime = 'ranging';
        confidence = 50;
        recommendation = 'Mixed signals. Consider mean-reversion or wait for clarity.';
      }
    } else {
      // RANGING regime (ADX too low for trending)
      rawRegime = 'ranging';
      confidence = adxValue < 20 ? 75 : 60;

      // Check RSI for mean-reversion opportunities
      if (rsi && rsi.value <= 30) {
        recommendation = 'Ranging market. RSI oversold - potential bounce. Consider LONG mean-reversion.';
      } else if (rsi && rsi.value >= 70) {
        recommendation = 'Ranging market. RSI overbought - potential pullback. Consider SHORT mean-reversion.';
      } else {
        recommendation = 'Ranging market. Wait for extremes (RSI < 30 or > 70) for mean-reversion entries.';
      }
    }
  }
  // 3. Unknown - not enough data
  else {
    rawRegime = 'unknown';
    confidence = 0;
    recommendation = 'Insufficient indicator data. Wait for more candles.';
  }

  // ============================================================================
  // STABILITY CHECK - prevent flickering by requiring consecutive readings
  // ============================================================================

  let finalRegime: MarketRegime;

  // VOLATILE always takes effect immediately (safety override)
  if (rawRegime === 'volatile') {
    confirmedRegime = rawRegime;
    pendingRegime = rawRegime;
    pendingCount = 0;
    finalRegime = rawRegime;
  }
  // First time initialization
  else if (confirmedRegime === 'unknown') {
    confirmedRegime = rawRegime;
    pendingRegime = rawRegime;
    pendingCount = 1;
    finalRegime = rawRegime;
  }
  // Same as confirmed regime - stay stable
  else if (rawRegime === confirmedRegime) {
    pendingRegime = rawRegime;
    pendingCount = 0; // Reset any pending switch
    finalRegime = confirmedRegime;
  }
  // Different regime - track it as pending
  else {
    if (rawRegime === pendingRegime) {
      // Same pending regime as before - increment counter
      pendingCount++;
      if (pendingCount >= STABILITY_REQUIRED) {
        // Seen this new regime enough times - confirm the switch
        confirmedRegime = rawRegime;
        pendingCount = 0;
        finalRegime = rawRegime;
      } else {
        // Not stable enough yet - keep confirmed regime
        finalRegime = confirmedRegime;
      }
    } else {
      // New pending regime - start fresh count
      pendingRegime = rawRegime;
      pendingCount = 1;
      finalRegime = confirmedRegime; // Keep confirmed regime
    }
  }

  return {
    regime: finalRegime,
    confidence,
    adxValue,
    volatilityLevel: volatilityLevel.toString(),
    trendStrength: trendStrength.toString(),
    recommendation,
  };
}

/**
 * Calculate confidence in trending regime
 */
function calculateTrendConfidence(
  adxValue: number,
  emaTrend: string,
  expectedDirection: 'bullish' | 'bearish'
): number {
  let confidence = 50;

  // ADX strength adds confidence
  if (adxValue >= 50) confidence += 25;      // Very strong trend
  else if (adxValue >= 35) confidence += 15; // Strong trend
  else if (adxValue >= 25) confidence += 5;  // Moderate trend

  // EMA alignment adds confidence
  const isAligned =
    (expectedDirection === 'bullish' && (emaTrend === 'bullish' || emaTrend === 'strong_bullish')) ||
    (expectedDirection === 'bearish' && (emaTrend === 'bearish' || emaTrend === 'strong_bearish'));

  if (isAligned) {
    confidence += 20;
    if (emaTrend.includes('strong')) {
      confidence += 5;
    }
  }

  return Math.min(95, confidence);
}

/**
 * Check if regime is favorable for trading
 */
export function isRegimeFavorable(
  regime: MarketRegimeAnalysis,
  allowRanging: boolean = true
): boolean {
  // Volatile regime - generally avoid
  if (regime.regime === 'volatile') {
    return false;
  }

  // Unknown - don't trade
  if (regime.regime === 'unknown') {
    return false;
  }

  // Ranging - only if allowed
  if (regime.regime === 'ranging' && !allowRanging) {
    return false;
  }

  // Trending - favorable
  if (regime.regime === 'trending_bullish' || regime.regime === 'trending_bearish') {
    return regime.confidence >= 50;
  }

  // Ranging with sufficient confidence
  if (regime.regime === 'ranging' && allowRanging) {
    return regime.confidence >= 60;
  }

  return false;
}

/**
 * Get regime-adjusted strategy parameters
 */
export function getRegimeAdjustedParams(regime: MarketRegimeAnalysis): {
  stopLossMultiplier: number;
  takeProfitMultiplier: number;
  positionSizeMultiplier: number;
} {
  switch (regime.regime) {
    case 'volatile':
      // Volatile: widen stops, reduce size
      return {
        stopLossMultiplier: 2.0,  // Wider stops
        takeProfitMultiplier: 3.0, // Bigger targets
        positionSizeMultiplier: 0.5, // Smaller size
      };

    case 'trending_bullish':
    case 'trending_bearish':
      // Trending: standard stops, can size up if confident
      return {
        stopLossMultiplier: 1.5,
        takeProfitMultiplier: 2.5,
        positionSizeMultiplier: regime.confidence >= 70 ? 1.2 : 1.0,
      };

    case 'ranging':
      // Ranging: tighter stops, tighter targets (mean-reversion)
      return {
        stopLossMultiplier: 1.0,
        takeProfitMultiplier: 1.5,
        positionSizeMultiplier: 0.8,
      };

    default:
      // Unknown: conservative
      return {
        stopLossMultiplier: 1.5,
        takeProfitMultiplier: 2.0,
        positionSizeMultiplier: 0.5,
      };
  }
}
