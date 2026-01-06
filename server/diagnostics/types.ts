// server/diagnostics/types.ts

/**
 * Trade Diagnostics Types
 *
 * Phase 5: Performance Truth - Measurement, not features.
 * This is READ-ONLY instrumentation to understand signal quality,
 * execution quality, and regime dependency.
 */

// ============================================================================
// EXCURSION DATA (MFE/MAE)
// ============================================================================

/**
 * Price excursion at a specific time horizon
 */
export interface ExcursionPoint {
  timestamp: number;
  price: number;
  excursionPercent: number; // Positive = favorable, Negative = adverse
  timeFromEntry: number; // Milliseconds since entry
}

/**
 * MFE/MAE tracking for a single trade
 */
export interface ExcursionData {
  // Max Favorable Excursion at different horizons
  mfe1m: number | null; // MFE after 1 minute
  mfe3m: number | null; // MFE after 3 minutes
  mfe5m: number | null; // MFE after 5 minutes
  mfe10m: number | null; // MFE after 10 minutes
  mfeMax: number; // Maximum MFE during entire trade
  mfeMaxTime: number | null; // Time to max MFE (ms from entry)

  // Max Adverse Excursion
  maeMax: number; // Maximum MAE during trade (before exit)
  maeMaxTime: number | null; // Time to max MAE (ms from entry)

  // First favorable tick
  timeToFirstFavorable: number | null; // ms to first positive excursion
  firstFavorablePercent: number | null; // % of first favorable move

  // MFE-before-MAE ordering (critical!)
  mfeBeforeMae: boolean | null; // Did price go favorable BEFORE adverse?
  firstSignificantMove: 'favorable' | 'adverse' | null; // Which came first (>0.1%)?

  // Price path for analysis
  pricePath: ExcursionPoint[];
}

// ============================================================================
// EXECUTION QUALITY
// ============================================================================

/**
 * Shadow PnL vs Ideal PnL - execution quality metrics
 */
export interface ExecutionQuality {
  // Entry execution
  theoreticalEntryPrice: number; // Signal candle close
  actualEntryPrice: number; // Actual fill price
  entrySlippageBps: number; // Slippage in basis points
  entrySlippageUsd: number; // Slippage in USD

  // Exit execution
  theoreticalExitPrice: number | null;
  actualExitPrice: number | null;
  exitSlippageBps: number | null;
  exitSlippageUsd: number | null;

  // Total execution drag
  totalSlippageBps: number;
  totalSlippageUsd: number;
  totalFeesUsd: number;

  // Shadow PnL comparison
  idealPnlPercent: number | null; // What PnL would have been with perfect execution
  actualPnlPercent: number | null; // Actual PnL after slippage + fees
  executionDragPercent: number | null; // How much execution cost us
}

// ============================================================================
// REGIME TAGGING
// ============================================================================

/**
 * Market regime at time of trade (silent observation, no decisions)
 */
export interface RegimeTag {
  // Market state
  marketState: 'trending' | 'ranging' | 'volatile' | 'breakout' | 'unknown';
  trendDirection: 'bullish' | 'bearish' | 'neutral';

  // Volatility context
  volatilityPercent: number; // ATR as % of price
  volatilityPercentile: number; // Where is vol vs recent history (0-100)

  // Time context
  hourOfDay: number; // 0-23 UTC
  dayOfWeek: number; // 0-6 (Sunday = 0)

  // Tradability gate values at entry
  tradabilityValues: {
    atrPercent: number | null;
    adx: number | null;
    bbWidth: number | null;
  };

  // Post-entry regime shift
  regimeShiftedAfterEntry: boolean | null; // Did regime change after entry?
  regimeAtExit: string | null; // Regime at exit time
}

// ============================================================================
// COMPLETE TRADE SNAPSHOT
// ============================================================================

/**
 * Complete diagnostic snapshot for a trade
 */
export interface TradeDiagnostics {
  tradeId: string;
  direction: 'LONG' | 'SHORT';

  // Signal quality
  signalScore: number; // Score at entry
  signalConfidence: number; // Confidence at entry

  // Excursion data
  excursion: ExcursionData;

  // Execution quality
  execution: ExecutionQuality;

  // Regime context
  regime: RegimeTag;

  // Timing
  entryTime: number;
  exitTime: number | null;
  holdDuration: number | null; // ms

  // Outcome
  outcome: 'win' | 'loss' | 'breakeven' | 'open';
  exitReason: string | null;
  finalPnlPercent: number | null;

  // R-multiple analysis
  stopLossPercent: number; // SL % at entry
  takeProfitPercent: number; // TP % at entry
  rMultiple: number | null; // Actual R achieved (PnL / SL)
  mfeReachedTwoR: boolean; // Did MFE reach 2x SL?
}

// ============================================================================
// EXPECTANCY METRICS
// ============================================================================

/**
 * Aggregated expectancy metrics across trades
 */
export interface ExpectancyMetrics {
  // Sample info
  totalTrades: number;
  winCount: number;
  lossCount: number;
  winRate: number;

  // PnL stats
  avgWinPercent: number;
  avgLossPercent: number;
  avgPnlPercent: number;
  totalPnlPercent: number;

  // Expectancy
  expectancy: number; // (winRate * avgWin) - (lossRate * avgLoss)
  expectancyAfterFees: number; // Expectancy minus avg fees

  // MFE/MAE stats
  avgMfe: number;
  avgMae: number;
  mfeToMaeRatio: number; // avgMfe / avgMae (higher = better signals)

  // R-multiple analysis
  avgRMultiple: number;
  percentTradesMfeReachedTwoR: number; // Critical metric

  // Signal score analysis (bucketed)
  byScoreBucket: {
    bucket: string; // e.g., "20-30", "30-40"
    trades: number;
    winRate: number;
    avgPnl: number;
    avgMfe: number;
  }[];

  // Execution quality
  avgSlippageBps: number;
  medianSlippageBps: number;
  p90SlippageBps: number; // 90th percentile
  worstSlippageBps: number;
  avgFeesPercent: number;

  // Time analysis
  avgTimeToMfe: number; // ms
  avgHoldDuration: number; // ms

  // Minimum viable position
  breakEvenPositionSize: number | null; // Below this, fees kill edge
}

// ============================================================================
// LIVE TRACKING STATE
// ============================================================================

/**
 * State for tracking an active trade's diagnostics
 */
export interface ActiveTradeTracker {
  tradeId: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  entryTime: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  signalScore: number;
  signalConfidence: number;

  // Live tracking
  currentMfe: number;
  currentMae: number;
  mfeTime: number | null;
  maeTime: number | null;
  timeToFirstFavorable: number | null;
  firstFavorablePercent: number | null;
  firstSignificantMove: 'favorable' | 'adverse' | null;

  // Price samples for MFE at horizons
  priceSamples: { timestamp: number; price: number }[];

  // Regime at entry
  regimeAtEntry: RegimeTag;
}

// ============================================================================
// HELPER TYPES
// ============================================================================

export type ScoreBucket =
  | '0-10'
  | '10-20'
  | '20-30'
  | '30-40'
  | '40-50'
  | '50-60'
  | '60-70'
  | '70-80'
  | '80-90'
  | '90-100';

export function getScoreBucket(score: number): ScoreBucket {
  const absScore = Math.abs(score);
  if (absScore < 10) return '0-10';
  if (absScore < 20) return '10-20';
  if (absScore < 30) return '20-30';
  if (absScore < 40) return '30-40';
  if (absScore < 50) return '40-50';
  if (absScore < 60) return '50-60';
  if (absScore < 70) return '60-70';
  if (absScore < 80) return '70-80';
  if (absScore < 90) return '80-90';
  return '90-100';
}
