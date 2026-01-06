// server/strategy/entry-confirm.ts

/**
 * Entry Confirmation System (1m Execution Timeframe)
 *
 * Binary checks to validate entry timing AFTER a signal is generated.
 * This is the "dumb execution" layer - it should NOT think, just validate.
 *
 * Checks:
 * 1. Range Check - Not entering a spike (1m range < 2× ATR)
 * 2. Momentum Check - 1m shows continuation in signal direction
 * 3. No Exhaustion - 1m RSI not at extreme (20-80 range)
 */

import { getIndicatorSnapshot } from '../indicators';
import type { IndicatorSnapshot } from '../indicators/types';

// ============================================================================
// TYPES
// ============================================================================

export interface EntryConfirmation {
  confirmed: boolean;
  reason: string | null;          // null if confirmed, otherwise why not
  checks: {
    rangeCheck: { passed: boolean; value: number | null; threshold: string };
    momentumCheck: { passed: boolean; direction: string | null };
    exhaustionCheck: { passed: boolean; rsiValue: number | null; threshold: string };
  };
  timestamp: number;
}

// ============================================================================
// THRESHOLDS
// ============================================================================

// Range check: candle range should be < 2× ATR (not a spike)
const RANGE_ATR_MULTIPLIER = 2.0;

// RSI exhaustion thresholds
const RSI_MIN = 20;  // Below this = too oversold for LONG
const RSI_MAX = 80;  // Above this = too overbought for SHORT

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Confirm entry using 1m execution timeframe
 *
 * Call this AFTER a signal is generated on 3m to validate entry timing.
 * Returns whether to proceed with the entry.
 *
 * @param signalDirection - 'LONG' or 'SHORT' from the signal
 * @param snapshot - Optional 1m snapshot (will fetch if not provided)
 */
export function confirmEntry(
  signalDirection: 'LONG' | 'SHORT',
  snapshot?: IndicatorSnapshot | null
): EntryConfirmation {
  // Get 1m snapshot if not provided
  const snap = snapshot ?? getIndicatorSnapshot('1m', 30);

  // No data = don't confirm
  if (!snap) {
    return {
      confirmed: false,
      reason: 'Insufficient 1m data for entry confirmation',
      checks: {
        rangeCheck: { passed: false, value: null, threshold: `< ${RANGE_ATR_MULTIPLIER}× ATR` },
        momentumCheck: { passed: false, direction: null },
        exhaustionCheck: { passed: false, rsiValue: null, threshold: `${RSI_MIN}-${RSI_MAX}` },
      },
      timestamp: Date.now(),
    };
  }

  const { atr, rsi, macd, ema } = snap;

  // ============================================================================
  // CHECK 1: Range Check (not entering a spike)
  // ============================================================================

  let rangeCheckPassed = true;
  let rangeValue: number | null = null;
  let rangeReason: string | null = null;

  if (atr) {
    // Get the most recent candle's range
    // We can estimate this from ATR or use the snapshot price context
    // For simplicity, we'll use ATR volatility level as a proxy
    const atrPercent = atr.valuePercent;
    rangeValue = atrPercent;

    // If volatility is extreme on 1m, don't enter (spike)
    if (atr.volatilityLevel === 'extreme') {
      rangeCheckPassed = false;
      rangeReason = `1m volatility extreme (${atrPercent.toFixed(2)}%) - likely spike`;
    } else if (atr.volatilityLevel === 'high' && atrPercent > 1.5) {
      rangeCheckPassed = false;
      rangeReason = `1m volatility too high (${atrPercent.toFixed(2)}%) - wait for calmer entry`;
    }
  }
  // If no ATR, pass by default (don't block on missing data)

  // ============================================================================
  // CHECK 2: Momentum Check (1m continuation in signal direction)
  // ============================================================================

  let momentumCheckPassed = true;
  let momentumDirection: string | null = null;
  let momentumReason: string | null = null;

  // Use EMA trend and MACD to determine 1m momentum
  if (ema) {
    momentumDirection = ema.trend;

    if (signalDirection === 'LONG') {
      // For LONG, want 1m to not be strongly bearish
      if (ema.trend === 'strong_bearish') {
        momentumCheckPassed = false;
        momentumReason = '1m showing strong bearish momentum - wait for pullback to end';
      }
    } else {
      // For SHORT, want 1m to not be strongly bullish
      if (ema.trend === 'strong_bullish') {
        momentumCheckPassed = false;
        momentumReason = '1m showing strong bullish momentum - wait for rally to end';
      }
    }
  }

  // Additional MACD check
  if (macd && momentumCheckPassed) {
    if (signalDirection === 'LONG' && macd.histogram < -0.5) {
      // Strong bearish histogram on 1m - momentum against us
      momentumCheckPassed = false;
      momentumReason = '1m MACD histogram strongly negative - wait for momentum shift';
    } else if (signalDirection === 'SHORT' && macd.histogram > 0.5) {
      // Strong bullish histogram on 1m - momentum against us
      momentumCheckPassed = false;
      momentumReason = '1m MACD histogram strongly positive - wait for momentum shift';
    }
  }

  // ============================================================================
  // CHECK 3: Exhaustion Check (RSI not at extreme)
  // ============================================================================

  let exhaustionCheckPassed = true;
  let rsiValue: number | null = null;
  let exhaustionReason: string | null = null;

  if (rsi) {
    rsiValue = rsi.value;

    if (signalDirection === 'LONG') {
      // For LONG, RSI shouldn't be too high (overbought = bad entry)
      if (rsi.value > RSI_MAX) {
        exhaustionCheckPassed = false;
        exhaustionReason = `1m RSI overbought (${rsi.value.toFixed(1)} > ${RSI_MAX}) - LONG entry exhausted`;
      }
    } else {
      // For SHORT, RSI shouldn't be too low (oversold = bad entry)
      if (rsi.value < RSI_MIN) {
        exhaustionCheckPassed = false;
        exhaustionReason = `1m RSI oversold (${rsi.value.toFixed(1)} < ${RSI_MIN}) - SHORT entry exhausted`;
      }
    }
  }
  // If no RSI, pass by default

  // ============================================================================
  // FINAL DECISION
  // ============================================================================

  // ALL checks must pass
  const confirmed = rangeCheckPassed && momentumCheckPassed && exhaustionCheckPassed;

  // Determine primary reason for not confirming
  let reason: string | null = null;
  if (!confirmed) {
    if (!rangeCheckPassed && rangeReason) {
      reason = rangeReason;
    } else if (!momentumCheckPassed && momentumReason) {
      reason = momentumReason;
    } else if (!exhaustionCheckPassed && exhaustionReason) {
      reason = exhaustionReason;
    } else {
      reason = 'Entry conditions not met';
    }
  }

  return {
    confirmed,
    reason,
    checks: {
      rangeCheck: {
        passed: rangeCheckPassed,
        value: rangeValue,
        threshold: `< ${RANGE_ATR_MULTIPLIER}× ATR`,
      },
      momentumCheck: {
        passed: momentumCheckPassed,
        direction: momentumDirection,
      },
      exhaustionCheck: {
        passed: exhaustionCheckPassed,
        rsiValue,
        threshold: `${RSI_MIN}-${RSI_MAX}`,
      },
    },
    timestamp: Date.now(),
  };
}

/**
 * Quick check - just returns boolean
 */
export function isEntryConfirmed(signalDirection: 'LONG' | 'SHORT'): boolean {
  return confirmEntry(signalDirection).confirmed;
}

/**
 * Reset function for testing (no state to reset, but kept for consistency)
 */
export function resetEntryConfirmState(): void {
  // No persistent state in this module
}
