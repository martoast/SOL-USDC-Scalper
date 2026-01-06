// server/strategy/tradability.ts

/**
 * Market Tradability Gate
 *
 * Top-level check BEFORE any signal processing.
 * Blocks trading in unfavorable conditions to prevent losses.
 *
 * Checks:
 * 1. Volatility - Is 15m ATR in normal range?
 * 2. Trend Strength - Is ADX showing any trend? (>20)
 * 3. Range Compression - Not stuck in tight chop?
 */

import { getIndicatorSnapshot } from '../indicators';
import type { TradabilityStatus } from './types';

// Re-export the type for convenience
export type { TradabilityStatus } from './types';

// ============================================================================
// THRESHOLDS
// ============================================================================

// ATR thresholds (as % of price)
const ATR_MIN_PERCENT = 0.15;  // Below this = too quiet, chop zone
const ATR_MAX_PERCENT = 2.0;   // Above this = too volatile, dangerous

// ADX threshold
const ADX_MIN = 18;            // Below 18 = no trend, ranging/chop

// Bollinger bandwidth threshold (squeeze detection)
const BB_BANDWIDTH_MIN = 0.8;  // Below this = compression, avoid

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Check if market conditions are tradable
 *
 * Uses 15m timeframe for regime-level assessment.
 * This runs BEFORE signal generation - blocks everything if not tradable.
 */
export function checkTradability(): TradabilityStatus {
  const snapshot = getIndicatorSnapshot('15m', 60);

  // No data = not tradable
  if (!snapshot) {
    return {
      isTradable: false,
      reason: 'Insufficient data (waiting for 15m candles)',
      checks: {
        volatility: { passed: false, value: null, threshold: `${ATR_MIN_PERCENT}%-${ATR_MAX_PERCENT}%` },
        trendStrength: { passed: false, value: null, threshold: `ADX > ${ADX_MIN}` },
        rangeCompression: { passed: false, value: null, threshold: `BB width > ${BB_BANDWIDTH_MIN}%` },
      },
      timestamp: Date.now(),
    };
  }

  const { atr, adx, bollingerBands } = snapshot;

  // ============================================================================
  // CHECK 1: Volatility (ATR)
  // ============================================================================

  let volatilityPassed = true;
  let volatilityValue: number | null = null;
  let volatilityReason: string | null = null;

  if (atr) {
    volatilityValue = atr.valuePercent;

    if (atr.valuePercent < ATR_MIN_PERCENT) {
      volatilityPassed = false;
      volatilityReason = `Low volatility (ATR ${atr.valuePercent.toFixed(2)}% < ${ATR_MIN_PERCENT}%) - chop zone`;
    } else if (atr.valuePercent > ATR_MAX_PERCENT) {
      volatilityPassed = false;
      volatilityReason = `Extreme volatility (ATR ${atr.valuePercent.toFixed(2)}% > ${ATR_MAX_PERCENT}%) - too risky`;
    }
  } else {
    volatilityPassed = false;
    volatilityReason = 'ATR data unavailable';
  }

  // ============================================================================
  // CHECK 2: Trend Strength (ADX)
  // ============================================================================

  let trendPassed = true;
  let trendValue: number | null = null;
  let trendReason: string | null = null;

  if (adx) {
    trendValue = adx.adx;

    if (adx.adx < ADX_MIN) {
      trendPassed = false;
      trendReason = `No trend (ADX ${adx.adx.toFixed(1)} < ${ADX_MIN}) - ranging/chop`;
    }
  } else {
    trendPassed = false;
    trendReason = 'ADX data unavailable';
  }

  // ============================================================================
  // CHECK 3: Range Compression (Bollinger Bandwidth)
  // ============================================================================

  let compressionPassed = true;
  let compressionValue: number | null = null;
  let compressionReason: string | null = null;

  if (bollingerBands) {
    compressionValue = bollingerBands.bandwidth;

    if (bollingerBands.bandwidth < BB_BANDWIDTH_MIN) {
      compressionPassed = false;
      compressionReason = `Tight compression (BB width ${bollingerBands.bandwidth.toFixed(2)}% < ${BB_BANDWIDTH_MIN}%) - wait for breakout`;
    }
  }
  // Note: If BB is unavailable, we don't fail - it's a secondary check

  // ============================================================================
  // FINAL DECISION
  // ============================================================================

  // Primary rule: volatility must pass, and either trend or compression must pass
  // BUT: if ADX is completely unavailable (not just low), don't use relaxed rule
  const adxDataAvailable = adx !== null && adx !== undefined;

  // Relaxed rule only applies when ADX exists but is weak (not when ADX is missing)
  const canUseRelaxedRule = adxDataAvailable && !trendPassed && compressionPassed;

  const isTradable = volatilityPassed && (trendPassed || canUseRelaxedRule);

  // Determine primary reason for blocking
  let reason: string | null = null;
  if (!isTradable) {
    if (!volatilityPassed && volatilityReason) {
      reason = volatilityReason;
    } else if (!trendPassed && trendReason) {
      reason = trendReason;
    } else if (!compressionPassed && compressionReason) {
      reason = compressionReason;
    } else {
      reason = 'Multiple unfavorable conditions';
    }
  }

  return {
    isTradable,
    reason,
    checks: {
      volatility: {
        passed: volatilityPassed,
        value: volatilityValue,
        threshold: `${ATR_MIN_PERCENT}%-${ATR_MAX_PERCENT}%`,
      },
      trendStrength: {
        passed: trendPassed,
        value: trendValue,
        threshold: `ADX > ${ADX_MIN}`,
      },
      rangeCompression: {
        passed: compressionPassed,
        value: compressionValue,
        threshold: `BB width > ${BB_BANDWIDTH_MIN}%`,
      },
    },
    timestamp: Date.now(),
  };
}

/**
 * Quick check - just returns boolean
 */
export function isTradable(): boolean {
  return checkTradability().isTradable;
}
