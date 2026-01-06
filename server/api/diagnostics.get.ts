// server/api/diagnostics.get.ts

/**
 * Diagnostics API Endpoint
 *
 * Returns performance truth metrics:
 * - Expectancy calculation
 * - MFE/MAE analysis
 * - Execution quality
 * - Regime analysis
 *
 * Query params:
 *   - regime: 'trending' | 'ranging' | 'volatile' (filter by regime)
 *   - hours: number (filter to last N hours)
 *   - mfeFirst: 'true' (only trades where MFE came before MAE)
 */

import { defineEventHandler, getQuery } from 'h3';
import { getDb } from '../utils/db';
import {
  getAllCompletedDiagnostics,
  getAllActiveTrackers,
} from '../diagnostics/trade-tracker';
import {
  calculateExpectancy,
  filterByRegime,
  filterByHour,
  filterMfeFirst,
  filterRegimeShifted,
  formatExpectancyReport,
} from '../diagnostics/expectancy';
import type { TradeDiagnostics, ExpectancyMetrics } from '../diagnostics/types';

export default defineEventHandler(async (event) => {
  const query = getQuery(event);

  // Get all diagnostics from memory cache
  let diagnostics = getAllCompletedDiagnostics();

  // Also load from DB history (for trades before this session)
  const db = getDb();
  const dbDiagnostics = db.history
    .filter((t) => t.diagnostics)
    .map((t) => t.diagnostics as TradeDiagnostics);

  // Merge (prefer in-memory for recent trades)
  const diagMap = new Map<string, TradeDiagnostics>();
  for (const d of dbDiagnostics) {
    diagMap.set(d.tradeId, d);
  }
  for (const d of diagnostics) {
    diagMap.set(d.tradeId, d); // In-memory overwrites DB
  }
  diagnostics = Array.from(diagMap.values());

  // Apply filters
  if (query.regime) {
    const regime = query.regime as 'trending' | 'ranging' | 'volatile';
    diagnostics = filterByRegime(diagnostics, regime);
  }

  if (query.hours) {
    const hours = parseInt(query.hours as string);
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    diagnostics = diagnostics.filter((d) => d.entryTime >= cutoff);
  }

  if (query.mfeFirst === 'true') {
    diagnostics = filterMfeFirst(diagnostics);
  }

  if (query.regimeShifted === 'true') {
    diagnostics = filterRegimeShifted(diagnostics);
  }

  // Calculate expectancy metrics
  const metrics = calculateExpectancy(diagnostics);

  // Get active trackers
  const activeTrackers = getAllActiveTrackers().map((t) => ({
    tradeId: t.tradeId,
    direction: t.direction,
    entryPrice: t.entryPrice,
    signalScore: t.signalScore,
    currentMfe: t.currentMfe,
    currentMae: t.currentMae,
    holdTime: Date.now() - t.entryTime,
    regime: t.regimeAtEntry.marketState,
  }));

  // Generate report
  const report = formatExpectancyReport(metrics);

  // Regime breakdown
  const trendingMetrics = calculateExpectancy(
    filterByRegime(diagnostics, 'trending')
  );
  const rangingMetrics = calculateExpectancy(
    filterByRegime(diagnostics, 'ranging')
  );
  const volatileMetrics = calculateExpectancy(
    filterByRegime(diagnostics, 'volatile')
  );

  // MFE-first analysis
  const mfeFirstTrades = filterMfeFirst(diagnostics);
  const maeFirstTrades = diagnostics.filter(
    (d) => d.excursion.mfeBeforeMae === false
  );
  const mfeFirstMetrics = calculateExpectancy(mfeFirstTrades);
  const maeFirstMetrics = calculateExpectancy(maeFirstTrades);

  // Time of day analysis (simplified: market hours vs off-hours)
  // SOL typically more active during US market hours (14:00-21:00 UTC)
  const marketHoursMetrics = calculateExpectancy(
    filterByHour(diagnostics, 14, 21)
  );
  const offHoursMetrics = calculateExpectancy(
    filterByHour(diagnostics, 21, 14)
  );

  return {
    success: true,
    data: {
      // Summary
      totalDiagnostics: diagnostics.length,
      activeTrackerCount: activeTrackers.length,

      // Main metrics
      metrics,

      // Report (human readable)
      report,

      // Breakdown by regime
      byRegime: {
        trending: {
          trades: trendingMetrics.totalTrades,
          winRate: trendingMetrics.winRate,
          expectancy: trendingMetrics.expectancy,
          avgMfe: trendingMetrics.avgMfe,
        },
        ranging: {
          trades: rangingMetrics.totalTrades,
          winRate: rangingMetrics.winRate,
          expectancy: rangingMetrics.expectancy,
          avgMfe: rangingMetrics.avgMfe,
        },
        volatile: {
          trades: volatileMetrics.totalTrades,
          winRate: volatileMetrics.winRate,
          expectancy: volatileMetrics.expectancy,
          avgMfe: volatileMetrics.avgMfe,
        },
      },

      // MFE-first vs MAE-first comparison
      mfeOrdering: {
        mfeFirst: {
          trades: mfeFirstMetrics.totalTrades,
          winRate: mfeFirstMetrics.winRate,
          expectancy: mfeFirstMetrics.expectancy,
          avgPnl: mfeFirstMetrics.avgPnlPercent,
        },
        maeFirst: {
          trades: maeFirstMetrics.totalTrades,
          winRate: maeFirstMetrics.winRate,
          expectancy: maeFirstMetrics.expectancy,
          avgPnl: maeFirstMetrics.avgPnlPercent,
        },
      },

      // Time of day
      byTimeOfDay: {
        marketHours: {
          trades: marketHoursMetrics.totalTrades,
          winRate: marketHoursMetrics.winRate,
          expectancy: marketHoursMetrics.expectancy,
        },
        offHours: {
          trades: offHoursMetrics.totalTrades,
          winRate: offHoursMetrics.winRate,
          expectancy: offHoursMetrics.expectancy,
        },
      },

      // Active trades being tracked
      activeTrackers,

      // Critical questions answered
      criticalMetrics: {
        // Does this system have edge?
        hasEdge: metrics.expectancyAfterFees > 0,
        expectancyAfterFees: metrics.expectancyAfterFees,

        // Are signals actually good?
        mfeToMaeRatio: metrics.mfeToMaeRatio,
        signalQuality: metrics.mfeToMaeRatio > 1 ? 'good' : 'poor',

        // Are R-multiples realistic?
        percentReaching2R: metrics.percentTradesMfeReachedTwoR,
        trailingStopsViable: metrics.percentTradesMfeReachedTwoR > 30,

        // Execution drag
        avgExecutionDrag: metrics.avgSlippageBps + metrics.avgFeesPercent * 100,

        // Minimum viable size
        breakEvenPositionSize: metrics.breakEvenPositionSize,
      },
    },
  };
});
