// server/api/health.get.ts

import { defineEventHandler } from 'h3';
import { getPriceEngine } from '../engine';
import { getDbStats } from '../utils/db';
import { getCandleStats } from '../utils/sol-candles';

export default defineEventHandler(() => {
  const engine = getPriceEngine();
  const dbStats = getDbStats();
  const candleStats = getCandleStats();
  
  const memoryUsage = process.memoryUsage();
  
  return {
    status: 'ok',
    uptime: process.uptime(),
    memory: {
      heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024) + ' MB',
      heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024) + ' MB',
      rss: Math.round(memoryUsage.rss / 1024 / 1024) + ' MB',
    },
    engine: {
      connected: engine?.isConnected() || false,
      status: engine?.getStatus() || null,
    },
    database: dbStats,
    candles: candleStats,
    timestamp: Date.now(),
  };
});