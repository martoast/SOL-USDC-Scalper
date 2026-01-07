// server/diagnostics/trade-tracker.ts

/**
 * Real-time Trade Diagnostics Tracker
 *
 * Tracks MFE/MAE, execution quality, and regime context for active trades.
 * This is instrumentation only - no trading decisions are made here.
 */

import type {
  ActiveTradeTracker,
  TradeDiagnostics,
  ExcursionData,
  ExecutionQuality,
  RegimeTag,
  ExcursionPoint,
} from './types';
import { getIndicatorSnapshot } from '../indicators';
import { checkTradability } from '../strategy/tradability';
import { detectMarketRegime } from '../strategy/regime';

// ============================================================================
// STATE
// ============================================================================

// Active trade trackers (in-memory, keyed by tradeId)
const activeTrackers: Map<string, ActiveTradeTracker> = new Map();

// Completed trade diagnostics (in-memory cache, persisted to DB)
const completedDiagnostics: Map<string, TradeDiagnostics> = new Map();

// Sampling interval for price tracking (ms)
const SAMPLE_INTERVAL = 1000; // 1 second

// Significant move threshold (%)
const SIGNIFICANT_MOVE_THRESHOLD = 0.1;

// ============================================================================
// TRACKER MANAGEMENT
// ============================================================================

/**
 * Start tracking a new trade
 */
export function startTrackingTrade(params: {
  tradeId: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  signalScore: number;
  signalConfidence: number;
  stopLossPercent: number;
  takeProfitPercent: number;
}): ActiveTradeTracker {
  const now = Date.now();

  // Capture regime at entry
  const regimeAtEntry = captureRegimeTag();

  const tracker: ActiveTradeTracker = {
    tradeId: params.tradeId,
    direction: params.direction,
    entryPrice: params.entryPrice,
    entryTime: now,
    stopLossPercent: params.stopLossPercent,
    takeProfitPercent: params.takeProfitPercent,
    signalScore: params.signalScore,
    signalConfidence: params.signalConfidence,

    // Initialize tracking state
    currentMfe: 0,
    currentMae: 0,
    mfeTime: null,
    maeTime: null,
    timeToFirstFavorable: null,
    firstFavorablePercent: null,
    firstSignificantMove: null,

    // Price samples
    priceSamples: [{ timestamp: now, price: params.entryPrice }],

    // Regime
    regimeAtEntry,
  };

  activeTrackers.set(params.tradeId, tracker);

  console.log(
    `[Diagnostics] Started tracking trade ${params.tradeId} | ` +
      `${params.direction} @ $${params.entryPrice.toFixed(4)} | ` +
      `Score: ${params.signalScore.toFixed(1)}`
  );

  return tracker;
}

/**
 * Update tracker with current price
 * Call this frequently (every second) while trade is active
 */
export function updateTracker(tradeId: string, currentPrice: number): void {
  const tracker = activeTrackers.get(tradeId);
  if (!tracker) return;

  const now = Date.now();
  const timeFromEntry = now - tracker.entryTime;

  // Calculate current excursion
  const excursion = calculateExcursion(
    tracker.entryPrice,
    currentPrice,
    tracker.direction
  );

  // Record price sample
  tracker.priceSamples.push({ timestamp: now, price: currentPrice });

  // Trim old samples (keep last 15 minutes worth)
  const maxSamples = (15 * 60 * 1000) / SAMPLE_INTERVAL;
  if (tracker.priceSamples.length > maxSamples) {
    tracker.priceSamples = tracker.priceSamples.slice(-maxSamples);
  }

  // Update MFE (max favorable)
  if (excursion > tracker.currentMfe) {
    tracker.currentMfe = excursion;
    tracker.mfeTime = timeFromEntry;
  }

  // Update MAE (max adverse)
  if (excursion < tracker.currentMae) {
    tracker.currentMae = excursion;
    tracker.maeTime = timeFromEntry;
  }

  // Track first favorable tick
  if (tracker.timeToFirstFavorable === null && excursion > 0) {
    tracker.timeToFirstFavorable = timeFromEntry;
    tracker.firstFavorablePercent = excursion;
  }

  // Track first significant move (>0.1%)
  if (tracker.firstSignificantMove === null) {
    if (excursion >= SIGNIFICANT_MOVE_THRESHOLD) {
      tracker.firstSignificantMove = 'favorable';
    } else if (excursion <= -SIGNIFICANT_MOVE_THRESHOLD) {
      tracker.firstSignificantMove = 'adverse';
    }
  }
}

/**
 * Stop tracking and finalize diagnostics
 */
export function stopTrackingTrade(
  tradeId: string,
  exitData: {
    exitPrice: number;
    exitReason: string;
    theoreticalExitPrice: number;
    actualExitPrice: number;
    exitSlippageBps: number;
    exitSlippageUsd: number;
    totalFeesUsd: number;
    finalPnlPercent: number;
  }
): TradeDiagnostics | null {
  const tracker = activeTrackers.get(tradeId);
  if (!tracker) {
    console.warn(`[Diagnostics] No tracker found for trade ${tradeId}`);
    return null;
  }

  const now = Date.now();
  const holdDuration = now - tracker.entryTime;

  // Calculate excursion data
  const excursion = calculateExcursionData(tracker, exitData.exitPrice);

  // Calculate execution quality
  const execution = calculateExecutionQuality(tracker, exitData);

  // Capture regime at exit
  const regimeAtExit = captureRegimeTag();
  const regimeShifted =
    tracker.regimeAtEntry.marketState !== regimeAtExit.marketState ||
    tracker.regimeAtEntry.trendDirection !== regimeAtExit.trendDirection;

  // Build regime tag with post-entry shift
  const regime: RegimeTag = {
    ...tracker.regimeAtEntry,
    regimeShiftedAfterEntry: regimeShifted,
    regimeAtExit: `${regimeAtExit.marketState}_${regimeAtExit.trendDirection}`,
  };

  // Calculate R-multiple
  const rMultiple =
    tracker.stopLossPercent > 0
      ? exitData.finalPnlPercent / tracker.stopLossPercent
      : null;

  // Check if MFE reached 2R
  const twoR = tracker.stopLossPercent * 2;
  const mfeReachedTwoR = excursion.mfeMax >= twoR;

  // Determine outcome
  let outcome: 'win' | 'loss' | 'breakeven' = 'breakeven';
  if (exitData.finalPnlPercent > 0.05) outcome = 'win';
  else if (exitData.finalPnlPercent < -0.05) outcome = 'loss';

  const diagnostics: TradeDiagnostics = {
    tradeId,
    direction: tracker.direction,
    signalScore: tracker.signalScore,
    signalConfidence: tracker.signalConfidence,
    excursion,
    execution,
    regime,
    entryTime: tracker.entryTime,
    exitTime: now,
    holdDuration,
    outcome,
    exitReason: exitData.exitReason,
    finalPnlPercent: exitData.finalPnlPercent,
    stopLossPercent: tracker.stopLossPercent,
    takeProfitPercent: tracker.takeProfitPercent,
    rMultiple,
    mfeReachedTwoR,
  };

  // Store in completed cache
  completedDiagnostics.set(tradeId, diagnostics);

  // Limit completed diagnostics to prevent unbounded memory growth (keep last 500)
  if (completedDiagnostics.size > 500) {
    const keysToDelete = Array.from(completedDiagnostics.keys()).slice(0, completedDiagnostics.size - 500);
    for (const key of keysToDelete) {
      completedDiagnostics.delete(key);
    }
  }

  // Remove from active trackers
  activeTrackers.delete(tradeId);

  console.log(
    `[Diagnostics] Completed trade ${tradeId} | ` +
      `MFE: ${excursion.mfeMax.toFixed(3)}% | MAE: ${excursion.maeMax.toFixed(3)}% | ` +
      `MFE-first: ${excursion.mfeBeforeMae} | R: ${rMultiple?.toFixed(2) ?? 'N/A'} | ` +
      `2R reached: ${mfeReachedTwoR}`
  );

  return diagnostics;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Calculate excursion (favorable = positive, adverse = negative)
 */
function calculateExcursion(
  entryPrice: number,
  currentPrice: number,
  direction: 'LONG' | 'SHORT'
): number {
  const priceChange = ((currentPrice - entryPrice) / entryPrice) * 100;
  return direction === 'LONG' ? priceChange : -priceChange;
}

/**
 * Calculate MFE at specific time horizon
 */
function getMfeAtHorizon(
  samples: { timestamp: number; price: number }[],
  entryTime: number,
  entryPrice: number,
  direction: 'LONG' | 'SHORT',
  horizonMs: number
): number | null {
  const cutoffTime = entryTime + horizonMs;
  const relevantSamples = samples.filter((s) => s.timestamp <= cutoffTime);

  if (relevantSamples.length === 0) return null;

  let maxFavorable = 0;
  for (const sample of relevantSamples) {
    const excursion = calculateExcursion(entryPrice, sample.price, direction);
    if (excursion > maxFavorable) {
      maxFavorable = excursion;
    }
  }

  return maxFavorable;
}

/**
 * Calculate complete excursion data from tracker
 */
function calculateExcursionData(
  tracker: ActiveTradeTracker,
  exitPrice: number
): ExcursionData {
  const { entryPrice, entryTime, direction, priceSamples } = tracker;

  // MFE at horizons
  const mfe1m = getMfeAtHorizon(
    priceSamples,
    entryTime,
    entryPrice,
    direction,
    60 * 1000
  );
  const mfe3m = getMfeAtHorizon(
    priceSamples,
    entryTime,
    entryPrice,
    direction,
    3 * 60 * 1000
  );
  const mfe5m = getMfeAtHorizon(
    priceSamples,
    entryTime,
    entryPrice,
    direction,
    5 * 60 * 1000
  );
  const mfe10m = getMfeAtHorizon(
    priceSamples,
    entryTime,
    entryPrice,
    direction,
    10 * 60 * 1000
  );

  // Build price path
  const pricePath: ExcursionPoint[] = priceSamples.map((sample) => ({
    timestamp: sample.timestamp,
    price: sample.price,
    excursionPercent: calculateExcursion(entryPrice, sample.price, direction),
    timeFromEntry: sample.timestamp - entryTime,
  }));

  // Determine MFE-before-MAE ordering
  // Find first index we hit significant favorable vs significant adverse
  // Using index instead of timestamp to handle same-millisecond updates
  let firstSignificantFavorableIndex: number | null = null;
  let firstSignificantAdverseIndex: number | null = null;

  for (let i = 0; i < pricePath.length; i++) {
    const point = pricePath[i];
    if (
      firstSignificantFavorableIndex === null &&
      point.excursionPercent >= SIGNIFICANT_MOVE_THRESHOLD
    ) {
      firstSignificantFavorableIndex = i;
    }
    if (
      firstSignificantAdverseIndex === null &&
      point.excursionPercent <= -SIGNIFICANT_MOVE_THRESHOLD
    ) {
      firstSignificantAdverseIndex = i;
    }
  }

  let mfeBeforeMae: boolean | null = null;
  if (
    firstSignificantFavorableIndex !== null &&
    firstSignificantAdverseIndex !== null
  ) {
    mfeBeforeMae = firstSignificantFavorableIndex < firstSignificantAdverseIndex;
  } else if (firstSignificantFavorableIndex !== null) {
    mfeBeforeMae = true; // Only favorable, never adverse
  } else if (firstSignificantAdverseIndex !== null) {
    mfeBeforeMae = false; // Only adverse, never favorable
  }

  return {
    mfe1m,
    mfe3m,
    mfe5m,
    mfe10m,
    mfeMax: tracker.currentMfe,
    mfeMaxTime: tracker.mfeTime,
    maeMax: tracker.currentMae,
    maeMaxTime: tracker.maeTime,
    timeToFirstFavorable: tracker.timeToFirstFavorable,
    firstFavorablePercent: tracker.firstFavorablePercent,
    mfeBeforeMae,
    firstSignificantMove: tracker.firstSignificantMove,
    pricePath,
  };
}

/**
 * Calculate execution quality metrics
 */
function calculateExecutionQuality(
  tracker: ActiveTradeTracker,
  exitData: {
    theoreticalExitPrice: number;
    actualExitPrice: number;
    exitSlippageBps: number;
    exitSlippageUsd: number;
    totalFeesUsd: number;
    finalPnlPercent: number;
  }
): ExecutionQuality {
  const entryPrice = tracker.entryPrice;
  // Note: We need actual entry price from trade, using tracker.entryPrice as theoretical
  // The actual entry price would be passed in during trade open

  // Entry slippage (we'll estimate based on typical slippage)
  // In real implementation, this comes from trade.post.ts
  const entrySlippageBps = 0; // Will be set when we wire this up

  // Calculate ideal PnL (what would have happened with perfect execution)
  const idealExcursion = calculateExcursion(
    tracker.entryPrice,
    exitData.theoreticalExitPrice,
    tracker.direction
  );

  // Execution drag
  const executionDrag = idealExcursion - exitData.finalPnlPercent;

  return {
    theoreticalEntryPrice: tracker.entryPrice,
    actualEntryPrice: tracker.entryPrice, // Will be updated when wired up
    entrySlippageBps,
    entrySlippageUsd: 0,
    theoreticalExitPrice: exitData.theoreticalExitPrice,
    actualExitPrice: exitData.actualExitPrice,
    exitSlippageBps: exitData.exitSlippageBps,
    exitSlippageUsd: exitData.exitSlippageUsd,
    totalSlippageBps: entrySlippageBps + exitData.exitSlippageBps,
    totalSlippageUsd: exitData.exitSlippageUsd,
    totalFeesUsd: exitData.totalFeesUsd,
    idealPnlPercent: idealExcursion,
    actualPnlPercent: exitData.finalPnlPercent,
    executionDragPercent: executionDrag,
  };
}

/**
 * Capture current regime tag
 */
function captureRegimeTag(): RegimeTag {
  const snapshot = getIndicatorSnapshot('15m', 60);
  const tradability = checkTradability();

  let marketState: RegimeTag['marketState'] = 'unknown';
  let trendDirection: RegimeTag['trendDirection'] = 'neutral';
  let volatilityPercent = 0;
  let volatilityPercentile = 50;

  if (snapshot) {
    // Get market state from regime
    const regime = detectMarketRegime(snapshot);
    if (regime.regime.includes('trending')) {
      marketState = 'trending';
      trendDirection = regime.regime.includes('bullish') ? 'bullish' : 'bearish';
    } else if (regime.regime === 'volatile') {
      marketState = 'volatile';
    } else if (regime.regime === 'ranging') {
      marketState = 'ranging';
    }

    // Volatility
    volatilityPercent = snapshot.atr?.valuePercent ?? 0;

    // Estimate volatility percentile (simplified: compare to typical range)
    // Normal SOL volatility: 0.3-0.8%. Low: <0.2%, High: >1%
    if (volatilityPercent < 0.2) volatilityPercentile = 10;
    else if (volatilityPercent < 0.4) volatilityPercentile = 30;
    else if (volatilityPercent < 0.6) volatilityPercentile = 50;
    else if (volatilityPercent < 0.8) volatilityPercentile = 70;
    else if (volatilityPercent < 1.0) volatilityPercentile = 85;
    else volatilityPercentile = 95;
  }

  const now = new Date();

  return {
    marketState,
    trendDirection,
    volatilityPercent,
    volatilityPercentile,
    hourOfDay: now.getUTCHours(),
    dayOfWeek: now.getUTCDay(),
    tradabilityValues: {
      atrPercent: tradability.checks.volatility.value,
      adx: tradability.checks.trendStrength.value,
      bbWidth: tradability.checks.rangeCompression.value,
    },
    regimeShiftedAfterEntry: null,
    regimeAtExit: null,
  };
}

// ============================================================================
// QUERY FUNCTIONS
// ============================================================================

/**
 * Get tracker for an active trade
 */
export function getActiveTracker(tradeId: string): ActiveTradeTracker | null {
  return activeTrackers.get(tradeId) ?? null;
}

/**
 * Get all active trackers
 */
export function getAllActiveTrackers(): ActiveTradeTracker[] {
  return Array.from(activeTrackers.values());
}

/**
 * Get completed diagnostics for a trade
 */
export function getCompletedDiagnostics(
  tradeId: string
): TradeDiagnostics | null {
  return completedDiagnostics.get(tradeId) ?? null;
}

/**
 * Get all completed diagnostics
 */
export function getAllCompletedDiagnostics(): TradeDiagnostics[] {
  return Array.from(completedDiagnostics.values());
}

/**
 * Clear all diagnostics (for testing)
 */
export function clearAllDiagnostics(): void {
  activeTrackers.clear();
  completedDiagnostics.clear();
}

/**
 * Import diagnostics from DB (call on startup)
 */
export function importDiagnostics(diagnostics: TradeDiagnostics[]): void {
  for (const diag of diagnostics) {
    completedDiagnostics.set(diag.tradeId, diag);
  }
}
