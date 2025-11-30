// server/api/stream/status.get.ts

/**
 * GET /api/stream/status
 *
 * Get current stream status, price data, and candle info
 */

import { defineEventHandler } from 'h3';
import {
  getStreamStats,
  getCurrentPrice,
  getPriceChange30s,
  getVolume30s
} from '../../utils/helius-stream';
import {
  getCandleStats,
  getAllPriceChanges,
  getAllCurrentCandles
} from '../../utils/sol-candles';

export default defineEventHandler(() => {
  try {
    const streamStats = getStreamStats();
    const priceSnapshot = getCurrentPrice();
    const change30s = getPriceChange30s();
    const volume30s = getVolume30s();
    const candleStats = getCandleStats();
    const priceChanges = getAllPriceChanges();
    const currentCandles = getAllCurrentCandles();

    return {
      success: true,
      data: {
        stream: {
          connected: streamStats.connected,
          swapsProcessed: streamStats.swapsProcessed,
          messagesReceived: streamStats.messagesReceived,
          errors: streamStats.errors,
          reconnects: streamStats.reconnects,
          uptime: streamStats.uptime,
          pollCount: streamStats.pollCount,
          lastMessageAgo: streamStats.lastMessage ? Date.now() - streamStats.lastMessage : 0,
        },
        price: {
          current: priceSnapshot.price,
          change30s: change30s,
          volume30s: volume30s,
          timestamp: priceSnapshot.timestamp,
        },
        candles: {
          stats: candleStats,
          priceChanges,
          current: currentCandles,
        },
      },
    };
  } catch (e: any) {
    console.error('[StatusAPI] Error:', e);
    return {
      success: false,
      error: e.message,
      data: null,
    };
  }
});