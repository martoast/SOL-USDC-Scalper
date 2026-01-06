// server/api/debug/signals.get.ts

/**
 * Debug endpoint to see current strategy signals
 *
 * GET /api/debug/signals
 *
 * Shows what the strategy is calculating and why it may not be trading
 */

import { defineEventHandler } from 'h3';
import { getStrategyAnalysis } from '../../strategy';
import { getIndicatorSnapshot } from '../../indicators';
import { getLastPrice, getCandleStats } from '../../utils/sol-candles';

export default defineEventHandler(async () => {
  const currentPrice = getLastPrice();
  const candleStats = getCandleStats();

  // Get indicator snapshot
  const snapshot = getIndicatorSnapshot('1m', 60);

  // Get strategy analysis
  const analysis = getStrategyAnalysis('1m', null);

  if (!analysis) {
    return {
      success: false,
      error: 'No analysis available - need more candle data',
      currentPrice,
      candleStats,
      indicatorsAvailable: !!snapshot,
    };
  }

  return {
    success: true,
    timestamp: new Date().toISOString(),
    currentPrice,
    candleStats,

    // Key decision factors
    decision: {
      shouldEnter: analysis.entry.shouldEnter,
      direction: analysis.entry.direction,
      confidence: analysis.entry.confidence,
      score: analysis.entry.score,
      regime: analysis.regime.regime,
    },

    // Why it's not trading (if not)
    blockers: {
      scoreTooLow: analysis.entry.score < 8 && analysis.entry.score > -8,
      confidenceTooLow: analysis.entry.confidence < 25,
      tooManyWarnings: analysis.entry.warnings.length > 4,
      noDirection: analysis.entry.direction === 'NONE',
    },

    // Entry signal details
    entry: {
      shouldEnter: analysis.entry.shouldEnter,
      direction: analysis.entry.direction,
      score: analysis.entry.score,
      confidence: analysis.entry.confidence,
      reasons: analysis.entry.reasons,
      warnings: analysis.entry.warnings,
      suggestedTP: analysis.entry.suggestedTakeProfit,
      suggestedSL: analysis.entry.suggestedStopLoss,
      tpPercent: analysis.entry.takeProfitPercent,
      slPercent: analysis.entry.stopLossPercent,
    },

    // Regime info
    regime: {
      current: analysis.regime.regime,
      confidence: analysis.regime.confidence,
      recommendation: analysis.regime.recommendation,
    },

    // Raw indicator values (if available)
    indicators: snapshot ? {
      rsi: snapshot.rsi?.value,
      rsiZone: snapshot.rsi?.zone,
      macdHistogram: snapshot.macd?.histogram,
      macdCrossover: snapshot.macd?.crossover,
      emaTrend: snapshot.ema?.trend,
      adx: snapshot.adx?.adx,
      adxTrendStrength: snapshot.adx?.trendStrength,
      atrPercent: snapshot.atr?.valuePercent,
      compositeScore: snapshot.signals?.compositeScore,
      signalConfidence: snapshot.signals?.confidence,
    } : null,
  };
});
