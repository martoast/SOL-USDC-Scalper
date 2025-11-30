// server/api/stream/candles.get.ts

/**
 * GET /api/stream/candles
 * 
 * Get candle data for SOL/USDC
 * 
 * Query params:
 * - timeframe: '1s' | '1m' | '2m' | '5m' | '10m' | '30m' | '1h' (default: '1m')
 * - limit: number (default: 50)
 */

import { defineEventHandler, getQuery } from 'h3';
import { 
  getCandles, 
  getAllCurrentCandles, 
  getCandleStats, 
  getAllPriceChanges,
  getLastPrice,
  type Timeframe 
} from '../../utils/sol-candles';

export default defineEventHandler((event) => {
  try {
    const query = getQuery(event);
    const timeframe = (query.timeframe as Timeframe) || '1m';
    const limit = parseInt(query.limit as string) || 50;

    // Validate timeframe
    const validTimeframes: Timeframe[] = ['1s', '1m', '2m', '5m', '10m', '30m', '1h'];
    if (!validTimeframes.includes(timeframe)) {
      return {
        success: false,
        error: `Invalid timeframe. Must be one of: ${validTimeframes.join(', ')}`,
      };
    }

    const candles = getCandles(timeframe, limit);
    const currentCandles = getAllCurrentCandles();
    const stats = getCandleStats();
    const priceChanges = getAllPriceChanges();
    const lastPrice = getLastPrice();

    return {
      success: true,
      data: {
        timeframe,
        candles,
        current: currentCandles[timeframe],
        stats,
        priceChanges,
        lastPrice,
      },
    };
  } catch (e: any) {
    console.error('[CandlesAPI] Error:', e);
    return {
      success: false,
      error: e.message,
    };
  }
});