// server/api/portfolio.get.ts

import { defineEventHandler } from 'h3';
import { getDb } from '../utils/db';
import { calculateRoundTripCosts, DEFAULT_COST_CONFIG } from '../utils/costs';

export default defineEventHandler(() => {
  const db = getDb();

  const history = db.history || [];

  // Net P&L (after fees) - this is the real number
  const wins = history.filter((t) => (t.pnl || 0) > 0);
  const losses = history.filter((t) => (t.pnl || 0) <= 0);
  const totalNetPnL = history.reduce((sum, t) => sum + (t.pnl || 0), 0);

  // Gross P&L (before fees)
  const totalGrossPnL = history.reduce((sum, t) => sum + (t.grossPnl || t.pnl || 0), 0);

  // Total fees paid
  const totalFees = history.reduce((sum, t) => sum + (t.totalCostsUsd || 0), 0);

  // Direction stats
  const longs = history.filter((t) => t.direction === 'LONG');
  const shorts = history.filter((t) => t.direction === 'SHORT');
  const longWins = longs.filter((t) => (t.pnl || 0) > 0).length;
  const shortWins = shorts.filter((t) => (t.pnl || 0) > 0).length;
  const longPnL = longs.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const shortPnL = shorts.reduce((sum, t) => sum + (t.pnl || 0), 0);

  // Calculate profit factor (gross wins / gross losses)
  const grossWins = history
    .filter((t) => (t.grossPnl || t.pnl || 0) > 0)
    .reduce((sum, t) => sum + (t.grossPnl || t.pnl || 0), 0);
  const grossLosses = Math.abs(
    history
      .filter((t) => (t.grossPnl || t.pnl || 0) < 0)
      .reduce((sum, t) => sum + (t.grossPnl || t.pnl || 0), 0)
  );
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? 999 : 0;

  // Get current cost model info
  const costInfo = calculateRoundTripCosts(140, 0.1, 1, DEFAULT_COST_CONFIG);

  return {
    success: true,
    activeTrades: db.activeTrades,
    history: db.history,
    stats: {
      totalTrades: history.length,
      wins: wins.length,
      losses: losses.length,
      winRate: history.length > 0 ? (wins.length / history.length) * 100 : 0,

      // P&L breakdown
      totalPnL: totalNetPnL, // Net (after fees) - this is the REAL number
      totalGrossPnL, // Before fees
      totalFees, // Total fees paid
      feesPercentOfGross: totalGrossPnL !== 0 ? (totalFees / Math.abs(totalGrossPnL)) * 100 : 0,

      // Averages (net)
      avgWin: wins.length > 0 ? wins.reduce((s, t) => s + (t.pnl || 0), 0) / wins.length : 0,
      avgLoss: losses.length > 0 ? losses.reduce((s, t) => s + (t.pnl || 0), 0) / losses.length : 0,
      avgFeePerTrade: history.length > 0 ? totalFees / history.length : 0,

      // Quality metrics
      profitFactor,

      // Direction stats
      longs: longs.length,
      shorts: shorts.length,
      longWinRate: longs.length > 0 ? (longWins / longs.length) * 100 : 0,
      shortWinRate: shorts.length > 0 ? (shortWins / shorts.length) * 100 : 0,
      longPnL,
      shortPnL,
    },

    // Cost model info for display
    costModel: {
      dexFeePercent: DEFAULT_COST_CONFIG.dexFeePercent,
      estimatedSlippagePercent: DEFAULT_COST_CONFIG.baseSlippagePercent,
      roundTripCostPercent: costInfo.totalCostPercent,
      breakEvenMovePercent: costInfo.breakEvenMovePercent,
    },
  };
});