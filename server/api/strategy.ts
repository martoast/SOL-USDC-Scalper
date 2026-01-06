// server/api/strategy.ts

/**
 * Strategy Analysis API Endpoint
 *
 * Returns intelligent trading signals including:
 * - Market regime detection
 * - Entry signals with confidence scores
 * - Exit signals with trailing stop management
 *
 * Query params:
 *   - timeframe: '1m' | '5m' | etc (default: '1m')
 *   - multi: 'true' for multi-timeframe confirmation
 *
 * POST body (optional, for exit signals):
 *   - activePosition: ActivePosition object
 */

import type { Timeframe } from '../indicators/types';
import type { ActivePosition, StrategyConfig } from '../strategy/types';
import { DEFAULT_STRATEGY_CONFIG } from '../strategy/types';
import { getStrategyAnalysis, getMultiTimeframeStrategy, formatStrategyLog } from '../strategy';

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const timeframe = (query.timeframe as Timeframe) || '1m';
  const useMultiTimeframe = query.multi === 'true';

  // Check for POST body with active position
  let activePosition: ActivePosition | null = null;
  let config: StrategyConfig = DEFAULT_STRATEGY_CONFIG;

  if (event.method === 'POST') {
    try {
      const body = await readBody(event);
      if (body?.activePosition) {
        activePosition = body.activePosition;
      }
      if (body?.config) {
        config = { ...DEFAULT_STRATEGY_CONFIG, ...body.config };
      }
    } catch {
      // No body or invalid body - that's fine
    }
  }

  // Get strategy analysis
  let analysis;

  if (useMultiTimeframe) {
    analysis = getMultiTimeframeStrategy(timeframe, ['5m'], activePosition, config);
  } else {
    analysis = getStrategyAnalysis(timeframe, activePosition, config);
  }

  if (!analysis) {
    return {
      success: false,
      error: 'Insufficient data for strategy analysis',
      data: null,
    };
  }

  return {
    success: true,
    data: {
      // Tradability gate (top-level check)
      tradability: analysis.tradability,

      // Throttle status (cooldowns & limits)
      throttle: analysis.throttle,

      // Entry confirmation (1m execution check)
      entryConfirmation: analysis.entryConfirmation,

      // Market context
      regime: analysis.regime,

      // Entry signal
      entry: {
        shouldEnter: analysis.entry.shouldEnter,
        direction: analysis.entry.direction,
        confidence: analysis.entry.confidence,
        score: analysis.entry.score,
        suggestedStopLoss: analysis.entry.suggestedStopLoss,
        suggestedTakeProfit: analysis.entry.suggestedTakeProfit,
        stopLossPercent: analysis.entry.stopLossPercent,
        takeProfitPercent: analysis.entry.takeProfitPercent,
        suggestedSizeMultiplier: analysis.entry.suggestedSizeMultiplier,
        reasons: analysis.entry.reasons,
        warnings: analysis.entry.warnings,
        indicators: analysis.entry.indicators,
      },

      // Exit signal (if position provided)
      exit: analysis.exit
        ? {
            shouldExit: analysis.exit.shouldExit,
            reason: analysis.exit.reason,
            urgency: analysis.exit.urgency,
            trailingStopPrice: analysis.exit.trailingStopPrice,
            trailingStopTriggered: analysis.exit.trailingStopTriggered,
            currentPnLPercent: analysis.exit.currentPnLPercent,
            maxPnLPercent: analysis.exit.maxPnLPercent,
            explanation: analysis.exit.explanation,
          }
        : null,

      // Current state
      currentPrice: analysis.currentPrice,
      timestamp: analysis.timestamp,

      // Debug log (useful for development)
      log: formatStrategyLog(analysis),
    },
  };
});
