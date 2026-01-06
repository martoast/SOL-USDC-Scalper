// server/diagnostics/expectancy.ts

/**
 * Expectancy Calculator
 *
 * Calculates aggregate performance metrics from trade diagnostics.
 * This answers the question: "Does this system have edge?"
 */

import type {
  TradeDiagnostics,
  ExpectancyMetrics,
  ScoreBucket,
} from './types';
import { getScoreBucket } from './types';

// ============================================================================
// MAIN CALCULATION
// ============================================================================

/**
 * Calculate expectancy metrics from a set of trade diagnostics
 */
export function calculateExpectancy(
  trades: TradeDiagnostics[]
): ExpectancyMetrics {
  if (trades.length === 0) {
    return createEmptyMetrics();
  }

  // Filter to closed trades only
  const closedTrades = trades.filter((t) => t.outcome !== 'open');
  if (closedTrades.length === 0) {
    return createEmptyMetrics();
  }

  // Basic stats
  const wins = closedTrades.filter((t) => t.outcome === 'win');
  const losses = closedTrades.filter((t) => t.outcome === 'loss');
  const winRate = wins.length / closedTrades.length;
  const lossRate = losses.length / closedTrades.length;

  // PnL stats
  const winPnls = wins.map((t) => t.finalPnlPercent ?? 0);
  const lossPnls = losses.map((t) => t.finalPnlPercent ?? 0);
  const allPnls = closedTrades.map((t) => t.finalPnlPercent ?? 0);

  const avgWinPercent = average(winPnls) || 0;
  const avgLossPercent = average(lossPnls) || 0;
  const avgPnlPercent = average(allPnls) || 0;
  const totalPnlPercent = sum(allPnls);

  // Expectancy
  const expectancy = winRate * avgWinPercent + lossRate * avgLossPercent;

  // Fees impact
  const avgFees = average(
    closedTrades.map((t) => t.execution.totalFeesUsd)
  );
  const avgTradeSize = average(
    closedTrades.map((t) => {
      // Estimate trade size from entry price (simplified)
      return t.execution.theoreticalEntryPrice * 0.1; // Assume 0.1 SOL average
    })
  );
  const avgFeesPercent =
    avgTradeSize > 0 ? (avgFees / avgTradeSize) * 100 : 0;
  const expectancyAfterFees = expectancy - avgFeesPercent;

  // MFE/MAE stats
  const mfes = closedTrades.map((t) => t.excursion.mfeMax);
  const maes = closedTrades.map((t) => Math.abs(t.excursion.maeMax));
  const avgMfe = average(mfes) || 0;
  const avgMae = average(maes) || 0;
  const mfeToMaeRatio = avgMae > 0 ? avgMfe / avgMae : 0;

  // R-multiple stats
  const rMultiples = closedTrades
    .filter((t) => t.rMultiple !== null)
    .map((t) => t.rMultiple as number);
  const avgRMultiple = average(rMultiples) || 0;

  // Critical metric: % trades where MFE >= 2R
  const tradesWithTwoR = closedTrades.filter((t) => t.mfeReachedTwoR);
  const percentTradesMfeReachedTwoR =
    (tradesWithTwoR.length / closedTrades.length) * 100;

  // Score bucket analysis
  const byScoreBucket = calculateScoreBucketStats(closedTrades);

  // Slippage stats
  const slippages = closedTrades.map((t) => t.execution.totalSlippageBps);
  const sortedSlippages = [...slippages].sort((a, b) => a - b);
  const avgSlippageBps = average(slippages) || 0;
  const medianSlippageBps = median(sortedSlippages) || 0;
  const p90SlippageBps = percentile(sortedSlippages, 90) || 0;
  const worstSlippageBps = Math.max(...slippages, 0);

  // Time stats
  const timesToMfe = closedTrades
    .filter((t) => t.excursion.mfeMaxTime !== null)
    .map((t) => t.excursion.mfeMaxTime as number);
  const holdDurations = closedTrades
    .filter((t) => t.holdDuration !== null)
    .map((t) => t.holdDuration as number);
  const avgTimeToMfe = average(timesToMfe) || 0;
  const avgHoldDuration = average(holdDurations) || 0;

  // Minimum viable position size
  // If fees are X% and expectancy is Y%, break-even is when X = Y
  // So minimum size is where fee% equals expectancy%
  // This is a rough estimate - real calculation would need cost model
  const breakEvenPositionSize = calculateBreakEvenSize(
    expectancy,
    avgFeesPercent,
    closedTrades
  );

  return {
    totalTrades: closedTrades.length,
    winCount: wins.length,
    lossCount: losses.length,
    winRate,
    avgWinPercent,
    avgLossPercent,
    avgPnlPercent,
    totalPnlPercent,
    expectancy,
    expectancyAfterFees,
    avgMfe,
    avgMae,
    mfeToMaeRatio,
    avgRMultiple,
    percentTradesMfeReachedTwoR,
    byScoreBucket,
    avgSlippageBps,
    medianSlippageBps,
    p90SlippageBps,
    worstSlippageBps,
    avgFeesPercent,
    avgTimeToMfe,
    avgHoldDuration,
    breakEvenPositionSize,
  };
}

// ============================================================================
// SCORE BUCKET ANALYSIS
// ============================================================================

/**
 * Calculate stats grouped by signal score bucket
 */
function calculateScoreBucketStats(
  trades: TradeDiagnostics[]
): ExpectancyMetrics['byScoreBucket'] {
  // Group trades by score bucket
  const buckets = new Map<
    ScoreBucket,
    { trades: TradeDiagnostics[]; pnls: number[]; mfes: number[] }
  >();

  for (const trade of trades) {
    const bucket = getScoreBucket(trade.signalScore);
    if (!buckets.has(bucket)) {
      buckets.set(bucket, { trades: [], pnls: [], mfes: [] });
    }
    const data = buckets.get(bucket)!;
    data.trades.push(trade);
    data.pnls.push(trade.finalPnlPercent ?? 0);
    data.mfes.push(trade.excursion.mfeMax);
  }

  // Calculate stats per bucket
  const result: ExpectancyMetrics['byScoreBucket'] = [];

  for (const [bucket, data] of buckets.entries()) {
    const wins = data.trades.filter((t) => t.outcome === 'win');
    result.push({
      bucket,
      trades: data.trades.length,
      winRate: data.trades.length > 0 ? wins.length / data.trades.length : 0,
      avgPnl: average(data.pnls) || 0,
      avgMfe: average(data.mfes) || 0,
    });
  }

  // Sort by bucket name
  result.sort((a, b) => {
    const aNum = parseInt(a.bucket.split('-')[0]);
    const bNum = parseInt(b.bucket.split('-')[0]);
    return aNum - bNum;
  });

  return result;
}

// ============================================================================
// BREAK-EVEN CALCULATION
// ============================================================================

/**
 * Calculate minimum position size where fees don't kill edge
 *
 * This is a simplified model. Real break-even depends on:
 * - Fixed costs (network fees)
 * - Variable costs (DEX fees as % of trade)
 * - Slippage (scales with size and volatility)
 */
function calculateBreakEvenSize(
  expectancyPercent: number,
  avgFeesPercent: number,
  trades: TradeDiagnostics[]
): number | null {
  if (trades.length < 10) {
    return null; // Not enough data
  }

  // If expectancy is already negative, no position size helps
  if (expectancyPercent <= 0) {
    return null;
  }

  // Get average trade size and fees
  const avgFees = average(trades.map((t) => t.execution.totalFeesUsd));

  // Rough model: fees have fixed component (~$0.01) + variable (~0.5%)
  // At larger sizes, variable dominates
  // At smaller sizes, fixed dominates

  // If avg fees are $X for avg expectancy of Y%,
  // break-even is where fee% = expectancy%

  // Estimate: if current avg fees are F% and expectancy is E%,
  // and fees scale roughly linearly,
  // break-even is around current_size * (1 - E/F)

  // Simplified: return null if we can't calculate meaningfully
  if (avgFeesPercent <= 0 || expectancyPercent <= avgFeesPercent) {
    // Fees exceed expectancy - no viable position size
    return null;
  }

  // Estimate based on fixed fee component (~$0.01 per trade)
  const FIXED_FEE_USD = 0.01;
  const breakEven = FIXED_FEE_USD / (expectancyPercent / 100);

  // This gives the minimum USD position size
  // For SOL, divide by typical SOL price (~200)
  return breakEven / 200;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}

function average(arr: number[]): number | null {
  if (arr.length === 0) return null;
  return sum(arr) / arr.length;
}

function median(sortedArr: number[]): number | null {
  if (sortedArr.length === 0) return null;
  const mid = Math.floor(sortedArr.length / 2);
  if (sortedArr.length % 2 === 0) {
    return (sortedArr[mid - 1] + sortedArr[mid]) / 2;
  }
  return sortedArr[mid];
}

function percentile(sortedArr: number[], p: number): number | null {
  if (sortedArr.length === 0) return null;
  const index = Math.ceil((p / 100) * sortedArr.length) - 1;
  return sortedArr[Math.max(0, Math.min(index, sortedArr.length - 1))];
}

function createEmptyMetrics(): ExpectancyMetrics {
  return {
    totalTrades: 0,
    winCount: 0,
    lossCount: 0,
    winRate: 0,
    avgWinPercent: 0,
    avgLossPercent: 0,
    avgPnlPercent: 0,
    totalPnlPercent: 0,
    expectancy: 0,
    expectancyAfterFees: 0,
    avgMfe: 0,
    avgMae: 0,
    mfeToMaeRatio: 0,
    avgRMultiple: 0,
    percentTradesMfeReachedTwoR: 0,
    byScoreBucket: [],
    avgSlippageBps: 0,
    medianSlippageBps: 0,
    p90SlippageBps: 0,
    worstSlippageBps: 0,
    avgFeesPercent: 0,
    avgTimeToMfe: 0,
    avgHoldDuration: 0,
    breakEvenPositionSize: null,
  };
}

// ============================================================================
// ANALYSIS HELPERS
// ============================================================================

/**
 * Get trades filtered by regime
 */
export function filterByRegime(
  trades: TradeDiagnostics[],
  regime: 'trending' | 'ranging' | 'volatile'
): TradeDiagnostics[] {
  return trades.filter((t) => t.regime.marketState === regime);
}

/**
 * Get trades filtered by time of day
 */
export function filterByHour(
  trades: TradeDiagnostics[],
  startHour: number,
  endHour: number
): TradeDiagnostics[] {
  return trades.filter((t) => {
    const hour = t.regime.hourOfDay;
    if (startHour <= endHour) {
      return hour >= startHour && hour < endHour;
    }
    // Wrap around midnight
    return hour >= startHour || hour < endHour;
  });
}

/**
 * Get trades where MFE came before MAE
 */
export function filterMfeFirst(trades: TradeDiagnostics[]): TradeDiagnostics[] {
  return trades.filter((t) => t.excursion.mfeBeforeMae === true);
}

/**
 * Get trades where regime shifted after entry
 */
export function filterRegimeShifted(
  trades: TradeDiagnostics[]
): TradeDiagnostics[] {
  return trades.filter((t) => t.regime.regimeShiftedAfterEntry === true);
}

/**
 * Summary report (for logging)
 */
export function formatExpectancyReport(metrics: ExpectancyMetrics): string {
  const lines: string[] = [];

  lines.push('═══════════════════════════════════════════════════════════');
  lines.push('                    EXPECTANCY REPORT                       ');
  lines.push('═══════════════════════════════════════════════════════════');
  lines.push('');
  lines.push(`Total Trades: ${metrics.totalTrades}`);
  lines.push(
    `Win/Loss: ${metrics.winCount}/${metrics.lossCount} (${(metrics.winRate * 100).toFixed(1)}% win rate)`
  );
  lines.push('');
  lines.push('── PnL ──');
  lines.push(`  Avg Win:  +${metrics.avgWinPercent.toFixed(3)}%`);
  lines.push(`  Avg Loss: ${metrics.avgLossPercent.toFixed(3)}%`);
  lines.push(`  Total:    ${metrics.totalPnlPercent >= 0 ? '+' : ''}${metrics.totalPnlPercent.toFixed(3)}%`);
  lines.push('');
  lines.push('── Expectancy ──');
  lines.push(`  Gross:      ${metrics.expectancy >= 0 ? '+' : ''}${metrics.expectancy.toFixed(4)}%`);
  lines.push(`  After Fees: ${metrics.expectancyAfterFees >= 0 ? '+' : ''}${metrics.expectancyAfterFees.toFixed(4)}%`);
  lines.push('');
  lines.push('── MFE/MAE ──');
  lines.push(`  Avg MFE: +${metrics.avgMfe.toFixed(3)}%`);
  lines.push(`  Avg MAE: -${metrics.avgMae.toFixed(3)}%`);
  lines.push(`  MFE:MAE Ratio: ${metrics.mfeToMaeRatio.toFixed(2)}`);
  lines.push('');
  lines.push('── R-Multiple ──');
  lines.push(`  Avg R: ${metrics.avgRMultiple >= 0 ? '+' : ''}${metrics.avgRMultiple.toFixed(2)}`);
  lines.push(`  Trades reaching 2R: ${metrics.percentTradesMfeReachedTwoR.toFixed(1)}%`);
  lines.push('');
  lines.push('── Execution ──');
  lines.push(`  Avg Slippage: ${metrics.avgSlippageBps.toFixed(1)} bps`);
  lines.push(`  90th %ile:    ${metrics.p90SlippageBps.toFixed(1)} bps`);
  lines.push(`  Worst:        ${metrics.worstSlippageBps.toFixed(1)} bps`);
  lines.push(`  Avg Fees:     ${metrics.avgFeesPercent.toFixed(3)}%`);
  lines.push('');
  lines.push('── Timing ──');
  lines.push(`  Avg Time to MFE: ${(metrics.avgTimeToMfe / 1000).toFixed(1)}s`);
  lines.push(`  Avg Hold:        ${(metrics.avgHoldDuration / 1000).toFixed(1)}s`);
  lines.push('');

  if (metrics.byScoreBucket.length > 0) {
    lines.push('── By Score Bucket ──');
    for (const bucket of metrics.byScoreBucket) {
      lines.push(
        `  ${bucket.bucket}: ${bucket.trades} trades, ${(bucket.winRate * 100).toFixed(0)}% win, ${bucket.avgPnl >= 0 ? '+' : ''}${bucket.avgPnl.toFixed(3)}% avg`
      );
    }
    lines.push('');
  }

  if (metrics.breakEvenPositionSize !== null) {
    lines.push('── Minimum Viable Size ──');
    lines.push(`  Break-even: ~${metrics.breakEvenPositionSize.toFixed(4)} SOL`);
  } else {
    lines.push('── Minimum Viable Size ──');
    lines.push(`  Insufficient data or negative expectancy`);
  }

  lines.push('═══════════════════════════════════════════════════════════');

  return lines.join('\n');
}
