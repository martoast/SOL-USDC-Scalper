// server/strategy/index.ts

/**
 * Trading Strategy Engine
 *
 * Intelligent trading strategy that combines:
 * - Technical indicator analysis
 * - Market regime detection
 * - Smart entry signals
 * - Smart exit signals with trailing stops
 * - Dynamic position sizing
 *
 * Usage:
 *   import { getStrategyAnalysis } from '../strategy';
 *
 *   const analysis = getStrategyAnalysis('1m');
 *   if (analysis.entry.shouldEnter) {
 *     // Execute trade with analysis.entry.direction
 *   }
 */

// Re-export types
export * from './types';

// Re-export components
export { detectMarketRegime, isRegimeFavorable, getRegimeAdjustedParams, resetRegimeState } from './regime';
export { generateEntrySignal, hasEntrySignal } from './entry';
export { generateExitSignal, updatePositionTracking, createPosition } from './exit';
export { checkTradability, isTradable, type TradabilityStatus } from './tradability';
export {
  checkThrottle,
  canTrade,
  recordTrade,
  resetConsecutiveLosses,
  clearStopLossCooldown,
  setThrottleConfig,
  resetThrottleState,
  type ThrottleStatus,
  type ThrottleConfig,
  DEFAULT_THROTTLE_CONFIG,
} from './throttle';
export {
  confirmEntry,
  isEntryConfirmed,
  type EntryConfirmation,
} from './entry-confirm';

// Import for internal use
import type { Timeframe } from '../indicators/types';
import type { StrategyAnalysis, StrategyConfig, ActivePosition } from './types';
import { DEFAULT_STRATEGY_CONFIG } from './types';
import { getIndicatorSnapshot } from '../indicators';
import { getLastPrice } from '../utils/sol-candles';
import { detectMarketRegime } from './regime';
import { generateEntrySignal } from './entry';
import { generateExitSignal } from './exit';
import { checkTradability } from './tradability';
import { checkThrottle } from './throttle';
import { confirmEntry } from './entry-confirm';
import type { EntryConfirmation } from './entry-confirm';

// ============================================================================
// HIGH-LEVEL API
// ============================================================================

/**
 * Get complete strategy analysis for a timeframe
 *
 * This is the main entry point for the trading strategy.
 * Call this periodically (e.g., every second) to get trading signals.
 *
 * @param timeframe - Candle timeframe to analyze
 * @param activePosition - Current position if any (for exit signals)
 * @param config - Strategy configuration (optional)
 * @returns Complete strategy analysis
 */
export function getStrategyAnalysis(
  timeframe: Timeframe = '1m',
  activePosition: ActivePosition | null = null,
  config: StrategyConfig = DEFAULT_STRATEGY_CONFIG
): StrategyAnalysis | null {
  // Get indicator snapshot
  const snapshot = getIndicatorSnapshot(timeframe, 60);

  if (!snapshot) {
    return null;
  }

  const currentPrice = getLastPrice() || snapshot.price;

  // ============================================================================
  // TRADABILITY GATE - Top level check (uses 15m internally)
  // ============================================================================
  const tradability = checkTradability();

  // ============================================================================
  // THROTTLE CHECK - Cooldowns and limits
  // ============================================================================
  const throttle = checkThrottle();

  // Detect market regime
  const regime = detectMarketRegime(snapshot);

  // Generate entry signal
  let entry = generateEntrySignal(snapshot, regime, currentPrice, config);

  // BLOCK ENTRIES if market not tradable
  if (!tradability.isTradable && entry.shouldEnter) {
    entry = {
      ...entry,
      shouldEnter: false,
      direction: 'NONE',
      warnings: [...entry.warnings, `Market not tradable: ${tradability.reason}`],
    };
  }

  // BLOCK ENTRIES if throttled (cooldown, max trades, etc.)
  if (!throttle.canTrade && entry.shouldEnter) {
    entry = {
      ...entry,
      shouldEnter: false,
      direction: 'NONE',
      warnings: [...entry.warnings, `Throttled: ${throttle.reason}`],
    };
  }

  // ============================================================================
  // ENTRY CONFIRMATION - 1m execution check (only if signal passed all gates)
  // ============================================================================
  let entryConfirmation: EntryConfirmation | null = null;

  if (entry.shouldEnter && entry.direction !== 'NONE') {
    // Run entry confirmation on 1m timeframe
    entryConfirmation = confirmEntry(entry.direction);

    // BLOCK ENTRY if not confirmed
    if (!entryConfirmation.confirmed) {
      entry = {
        ...entry,
        shouldEnter: false,
        warnings: [...entry.warnings, `Entry not confirmed: ${entryConfirmation.reason}`],
      };
    }
  }

  // Generate exit signal if we have a position
  // Note: We still allow exits even if market not tradable (position management)
  let exit = null;
  if (activePosition) {
    exit = generateExitSignal(snapshot, activePosition, currentPrice, regime, config);
  }

  return {
    tradability,
    throttle,
    entryConfirmation,
    regime,
    entry,
    exit,
    currentPrice,
    timestamp: Date.now(),
    config,
  };
}

/**
 * Quick check for entry opportunities
 *
 * Lighter-weight check for use in tight loops.
 */
export function shouldEnterNow(
  timeframe: Timeframe = '1m',
  config: StrategyConfig = DEFAULT_STRATEGY_CONFIG
): { shouldEnter: boolean; direction: 'LONG' | 'SHORT' | 'NONE'; confidence: number } {
  const analysis = getStrategyAnalysis(timeframe, null, config);

  if (!analysis) {
    return { shouldEnter: false, direction: 'NONE', confidence: 0 };
  }

  return {
    shouldEnter: analysis.entry.shouldEnter,
    direction: analysis.entry.direction,
    confidence: analysis.entry.confidence,
  };
}

/**
 * Quick check for exit
 *
 * Lighter-weight check for use in tight loops.
 */
export function shouldExitNow(
  timeframe: Timeframe = '1m',
  activePosition: ActivePosition,
  config: StrategyConfig = DEFAULT_STRATEGY_CONFIG
): { shouldExit: boolean; reason: string; urgency: string } {
  const analysis = getStrategyAnalysis(timeframe, activePosition, config);

  if (!analysis || !analysis.exit) {
    return { shouldExit: false, reason: 'NONE', urgency: 'low' };
  }

  return {
    shouldExit: analysis.exit.shouldExit,
    reason: analysis.exit.reason,
    urgency: analysis.exit.urgency,
  };
}

// ============================================================================
// MULTI-TIMEFRAME STRATEGY
// ============================================================================

/**
 * Get strategy analysis with multi-timeframe confirmation
 *
 * Only generates entry signals when multiple timeframes agree.
 */
export function getMultiTimeframeStrategy(
  primaryTimeframe: Timeframe = '1m',
  confirmationTimeframes: Timeframe[] = ['5m'],
  activePosition: ActivePosition | null = null,
  config: StrategyConfig = DEFAULT_STRATEGY_CONFIG
): StrategyAnalysis | null {
  // Get primary analysis
  const primary = getStrategyAnalysis(primaryTimeframe, activePosition, config);

  if (!primary) {
    return null;
  }

  // If no entry signal on primary, return as-is
  if (!primary.entry.shouldEnter) {
    return primary;
  }

  // Check confirmation timeframes
  const confirmations: { timeframe: Timeframe; agrees: boolean; direction: string }[] = [];
  let allAgree = true;

  for (const tf of confirmationTimeframes) {
    const snapshot = getIndicatorSnapshot(tf, 60);

    if (!snapshot) {
      allAgree = false;
      confirmations.push({ timeframe: tf, agrees: false, direction: 'unknown' });
      continue;
    }

    const tfSignals = snapshot.signals;
    const tfDirection =
      tfSignals.compositeScore >= 15
        ? 'LONG'
        : tfSignals.compositeScore <= -15
        ? 'SHORT'
        : 'NEUTRAL';

    const agrees = tfDirection === primary.entry.direction;
    confirmations.push({ timeframe: tf, agrees, direction: tfDirection });

    if (!agrees) {
      allAgree = false;
    }
  }

  // If not all timeframes agree, reduce confidence or cancel entry
  if (!allAgree && config.requireMultiTimeframeConfirmation) {
    return {
      ...primary,
      entry: {
        ...primary.entry,
        shouldEnter: false,
        warnings: [
          ...primary.entry.warnings,
          `Multi-timeframe disagreement: ${confirmations
            .filter((c) => !c.agrees)
            .map((c) => `${c.timeframe}: ${c.direction}`)
            .join(', ')}`,
        ],
      },
    };
  }

  // Add confirmation info to reasons
  if (allAgree) {
    primary.entry.reasons.push(
      `Confirmed by: ${confirmationTimeframes.join(', ')}`
    );
    // Boost confidence slightly
    primary.entry.confidence = Math.min(95, primary.entry.confidence + 10);
  }

  return primary;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Calculate position size based on signal confidence
 */
export function calculatePositionSize(
  baseSize: number,
  entry: { suggestedSizeMultiplier: number }
): number {
  return baseSize * entry.suggestedSizeMultiplier;
}

/**
 * Format strategy analysis for logging
 */
export function formatStrategyLog(analysis: StrategyAnalysis): string {
  const lines: string[] = [];

  lines.push(`[Strategy] Price: $${analysis.currentPrice.toFixed(4)}`);

  // Tradability gate status
  if (analysis.tradability.isTradable) {
    lines.push(`  Market: TRADABLE ✓`);
  } else {
    lines.push(`  Market: NOT TRADABLE ✗`);
    lines.push(`    Reason: ${analysis.tradability.reason}`);
  }

  // Throttle status
  if (analysis.throttle.canTrade) {
    lines.push(`  Throttle: OK (${analysis.throttle.tradesThisHour}/${analysis.throttle.maxTradesPerHour} trades this hour)`);
  } else {
    lines.push(`  Throttle: BLOCKED ✗`);
    lines.push(`    Reason: ${analysis.throttle.reason}`);
  }

  // Entry confirmation status
  if (analysis.entryConfirmation) {
    if (analysis.entryConfirmation.confirmed) {
      lines.push(`  Entry Confirm: READY ✓`);
    } else {
      lines.push(`  Entry Confirm: NOT READY ✗`);
      lines.push(`    Reason: ${analysis.entryConfirmation.reason}`);
    }
  }

  lines.push(`  Regime: ${analysis.regime.regime} (${analysis.regime.confidence}% confidence)`);

  if (analysis.entry.shouldEnter) {
    lines.push(`  ENTRY: ${analysis.entry.direction} @ ${analysis.entry.confidence.toFixed(0)}% confidence`);
    lines.push(`    TP: $${analysis.entry.suggestedTakeProfit.toFixed(4)} (${analysis.entry.takeProfitPercent.toFixed(3)}%)`);
    lines.push(`    SL: $${analysis.entry.suggestedStopLoss.toFixed(4)} (${analysis.entry.stopLossPercent.toFixed(3)}%)`);
    lines.push(`    Size: ${analysis.entry.suggestedSizeMultiplier.toFixed(2)}x`);
    lines.push(`    Reasons: ${analysis.entry.reasons.join('; ')}`);
    if (analysis.entry.warnings.length > 0) {
      lines.push(`    Warnings: ${analysis.entry.warnings.join('; ')}`);
    }
  } else {
    lines.push(`  No entry signal (score: ${analysis.entry.score.toFixed(1)})`);
  }

  if (analysis.exit) {
    if (analysis.exit.shouldExit) {
      lines.push(`  EXIT: ${analysis.exit.reason} (${analysis.exit.urgency})`);
      lines.push(`    ${analysis.exit.explanation}`);
    } else {
      lines.push(`  Holding position (P&L: ${analysis.exit.currentPnLPercent.toFixed(3)}%)`);
    }
  }

  return lines.join('\n');
}
