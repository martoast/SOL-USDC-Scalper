// server/api/stream/status.get.ts

import { defineEventHandler } from 'h3';
import { getPriceEngine } from '../../engine';
import {
  getCandleStats,
  getAllPriceChanges,
  getAllCurrentCandles
} from '../../utils/sol-candles';
import {
  quickRSICheck,
  quickTrendCheck,
  quickVolatilityCheck,
  getTradeRecommendation,
} from '../../indicators';
import {
  updateTracker,
  getAllActiveTrackers,
} from '../../diagnostics/trade-tracker';

export default defineEventHandler(() => {
  const engine = getPriceEngine();

  if (!engine) {
    return {
      success: false,
      error: 'Price engine not initialized',
      data: null,
    };
  }

  const status = engine.getStatus();
  const priceData = engine.getCurrentPrice();

  // Phase 5: Update all active trade trackers with current price
  if (priceData.price > 0) {
    const activeTrackers = getAllActiveTrackers();
    for (const tracker of activeTrackers) {
      updateTracker(tracker.tradeId, priceData.price);
    }
  }
  const candleStats = getCandleStats();
  const priceChanges = getAllPriceChanges();
  const currentCandles = getAllCurrentCandles();

  // Quick indicator checks for primary timeframe (1m)
  const rsi = quickRSICheck('1m');
  const trend = quickTrendCheck('5m');
  const volatility = quickVolatilityCheck('5m');
  const recommendation = getTradeRecommendation('1m');

  return {
    success: true,
    data: {
      stream: {
        connected: status.connected,
        mode: 'websocket', // Always websocket now!
        uptime: status.uptime,
        websocket: status.websocket,
        pool: status.pool,
      },
      price: {
        current: priceData.price,
        change30s: priceData.change30s,
        avgLatency: status.pool.avgLatency,
        lastUpdateAgo: status.price.lastUpdateAgo,
      },
      candles: {
        stats: candleStats,
        priceChanges,
        current: currentCandles,
      },
      // Quick indicator snapshot
      indicators: {
        rsi: rsi ? { value: Math.round(rsi.value * 10) / 10, zone: rsi.zone } : null,
        trend: trend ? { trend: trend.trend, ema9Above21: trend.ema9Above21 } : null,
        volatility: volatility
          ? { atrPercent: Math.round(volatility.atrPercent * 100) / 100, level: volatility.level }
          : null,
        recommendation: recommendation
          ? {
              action: recommendation.action,
              confidence: Math.round(recommendation.confidence),
              score: Math.round(recommendation.score),
            }
          : null,
      },
    },
  };
});