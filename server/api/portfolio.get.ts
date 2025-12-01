// server/api/portfolio.get.ts

import { defineEventHandler } from 'h3';
import { getDb } from '../utils/db';

export default defineEventHandler(() => {
  const db = getDb();

  const history = db.history || [];
  const wins = history.filter((t) => (t.pnl || 0) > 0);
  const losses = history.filter((t) => (t.pnl || 0) <= 0);
  const totalPnL = history.reduce((sum, t) => sum + (t.pnl || 0), 0);

  // Direction stats
  const longs = history.filter(t => t.direction === 'LONG');
  const shorts = history.filter(t => t.direction === 'SHORT');
  const longWins = longs.filter(t => (t.pnl || 0) > 0).length;
  const shortWins = shorts.filter(t => (t.pnl || 0) > 0).length;
  const longPnL = longs.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const shortPnL = shorts.reduce((sum, t) => sum + (t.pnl || 0), 0);

  return {
    success: true,
    activeTrades: db.activeTrades,
    history: db.history,
    stats: {
      totalTrades: history.length,
      wins: wins.length,
      losses: losses.length,
      winRate: history.length > 0 ? (wins.length / history.length) * 100 : 0,
      totalPnL,
      avgWin: wins.length > 0 ? wins.reduce((s, t) => s + (t.pnl || 0), 0) / wins.length : 0,
      avgLoss: losses.length > 0 ? losses.reduce((s, t) => s + (t.pnl || 0), 0) / losses.length : 0,
      // Direction stats
      longs: longs.length,
      shorts: shorts.length,
      longWinRate: longs.length > 0 ? (longWins / longs.length) * 100 : 0,
      shortWinRate: shorts.length > 0 ? (shortWins / shorts.length) * 100 : 0,
      longPnL,
      shortPnL,
    },
  };
});