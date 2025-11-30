// server/api/stream/status.get.ts

import { defineEventHandler } from 'h3';
import { getPriceEngine } from '../../engine';
import {
  getCandleStats,
  getAllPriceChanges,
  getAllCurrentCandles
} from '../../utils/sol-candles';

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
  const candleStats = getCandleStats();
  const priceChanges = getAllPriceChanges();
  const currentCandles = getAllCurrentCandles();

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
    },
  };
});