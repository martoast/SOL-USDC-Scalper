// server/api/trade.post.ts

import { defineEventHandler, readBody } from 'h3';
import { getDb, saveDb, type Trade } from '../utils/db';

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const { action, trade: tradeData, tradeId, exitPrice, pnl, pnlPercent, reason } = body;

  const db = getDb();

  if (action === 'OPEN') {
    const direction = tradeData.direction || 'LONG';
    
    const newTrade: Trade = {
      id: Math.random().toString(36).substring(2, 9),
      address: tradeData.address || 'SOL',
      symbol: tradeData.symbol || 'SOL/USDC',
      name: tradeData.name || 'Solana',
      direction,
      entryPrice: tradeData.entryPrice,
      amount: tradeData.amount,
      size: tradeData.size || tradeData.amount / tradeData.entryPrice,
      timestamp: tradeData.timestamp || Date.now(),
      status: 'OPEN',
    };

    db.activeTrades.push(newTrade);
    saveDb(db);

    const emoji = direction === 'LONG' ? '🟢' : '🔴';
    console.log(`[Trade] ${emoji} Opened ${direction}: ${newTrade.symbol} @ $${newTrade.entryPrice.toFixed(4)}`);

    return {
      success: true,
      trade: newTrade,
      message: `Opened ${direction} position: ${newTrade.size.toFixed(4)} SOL @ $${newTrade.entryPrice.toFixed(4)}`,
    };
  }

  if (action === 'CLOSE') {
    const tradeIndex = db.activeTrades.findIndex((t) => t.id === tradeId);

    if (tradeIndex === -1) {
      return { success: false, error: 'Trade not found' };
    }

    const trade = db.activeTrades[tradeIndex];

    // Calculate P&L based on direction
    let calculatedPnl = pnl;
    let calculatedPnlPercent = pnlPercent;
    
    if (calculatedPnl === undefined) {
      if (trade.direction === 'LONG') {
        // LONG: profit when price goes UP
        calculatedPnl = (exitPrice - trade.entryPrice) * trade.size;
        calculatedPnlPercent = ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100;
      } else {
        // SHORT: profit when price goes DOWN
        calculatedPnl = (trade.entryPrice - exitPrice) * trade.size;
        calculatedPnlPercent = ((trade.entryPrice - exitPrice) / trade.entryPrice) * 100;
      }
    }

    trade.exitPrice = exitPrice;
    trade.pnl = calculatedPnl;
    trade.pnlPercent = calculatedPnlPercent;
    trade.status = 'CLOSED';
    trade.closedAt = Date.now();
    trade.exitReason = reason;

    db.activeTrades.splice(tradeIndex, 1);
    db.history.unshift(trade);

    saveDb(db);

    const emoji = calculatedPnl >= 0 ? '🟢' : '🔴';
    const dirEmoji = trade.direction === 'LONG' ? '📈' : '📉';
    console.log(
      `[Trade] ${emoji} Closed ${trade.direction} ${dirEmoji}: ${trade.symbol} | ` +
      `PnL: $${calculatedPnl.toFixed(4)} (${calculatedPnlPercent >= 0 ? '+' : ''}${calculatedPnlPercent.toFixed(2)}%) | ` +
      `${reason}`
    );

    return {
      success: true,
      trade,
      pnl: calculatedPnl,
      pnlPercent: calculatedPnlPercent,
      message: `Closed ${trade.direction}. PnL: $${calculatedPnl.toFixed(4)}`,
    };
  }

  return { success: false, error: 'Invalid action' };
});