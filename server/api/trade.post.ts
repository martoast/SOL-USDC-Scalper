// server/api/trade.post.ts

import { defineEventHandler, readBody } from 'h3';
import { getDb, saveDb, type Trade, type TradeCosts } from '../utils/db';
import {
  calculateEntryExecution,
  calculateExitExecution,
  DEFAULT_COST_CONFIG,
} from '../utils/costs';
import { getIndicatorSnapshot } from '../indicators';
import {
  startTrackingTrade,
  stopTrackingTrade,
} from '../diagnostics/trade-tracker';
import { recordTrade } from '../strategy/throttle';

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const { action, trade: tradeData, tradeId, exitPrice, pnl, pnlPercent, reason } = body;

  const db = getDb();

  // Get current ATR for volatility-based slippage
  const snapshot = getIndicatorSnapshot('1m', 30);
  const atrPercent = snapshot?.atr?.valuePercent ?? 1;

  if (action === 'OPEN') {
    const direction = tradeData.direction || 'LONG';
    const signalPrice = tradeData.entryPrice;
    const size = tradeData.size || tradeData.amount / tradeData.entryPrice;

    // Get signal score and confidence from request (if provided)
    const signalScore = tradeData.signalScore ?? 0;
    const signalConfidence = tradeData.signalConfidence ?? 0;
    const stopLossPercent = tradeData.stopLossPercent ?? 1;
    const takeProfitPercent = tradeData.takeProfitPercent ?? 2;

    // Calculate realistic entry execution with costs
    const entryExecution = calculateEntryExecution(
      signalPrice,
      direction,
      size,
      atrPercent,
      DEFAULT_COST_CONFIG
    );

    const entryCosts: TradeCosts = {
      dexFeeUsd: entryExecution.costs.dexFeeUsd,
      slippageUsd: entryExecution.costs.slippageUsd,
      networkFeeUsd: entryExecution.costs.networkFeeUsd,
      totalCostUsd: entryExecution.costs.totalCostUsd,
      totalCostPercent: entryExecution.costs.totalCostPercent,
    };

    const newTrade: Trade = {
      id: Math.random().toString(36).substring(2, 9),
      address: tradeData.address || 'SOL',
      symbol: tradeData.symbol || 'SOL/USDC',
      name: tradeData.name || 'Solana',
      direction,
      entryPrice: signalPrice, // Signal price
      entryPriceActual: entryExecution.executionPrice, // Actual fill price
      amount: entryExecution.executionPrice * size, // Actual USD amount
      size,
      entryCosts,
      timestamp: tradeData.timestamp || Date.now(),
      status: 'OPEN',
      // Phase 5: Store signal quality at entry
      signalScore,
      signalConfidence,
      stopLossPercent,
      takeProfitPercent,
    };

    db.activeTrades.push(newTrade);
    saveDb(db);

    // Phase 5: Start tracking diagnostics
    startTrackingTrade({
      tradeId: newTrade.id,
      direction,
      entryPrice: entryExecution.executionPrice,
      signalScore,
      signalConfidence,
      stopLossPercent,
      takeProfitPercent,
    });

    const emoji = direction === 'LONG' ? '🟢' : '🔴';
    const slipBps = (entryExecution.priceImpactPercent * 100).toFixed(1);
    console.log(
      `[Trade] ${emoji} Opened ${direction}: ${newTrade.symbol} @ $${entryExecution.executionPrice.toFixed(4)} ` +
        `(signal: $${signalPrice.toFixed(4)}, slip: ${slipBps}bps, fees: $${entryCosts.totalCostUsd.toFixed(4)})`
    );

    return {
      success: true,
      trade: newTrade,
      execution: {
        signalPrice,
        fillPrice: entryExecution.executionPrice,
        slippagePercent: entryExecution.priceImpactPercent,
        costs: entryCosts,
      },
      message: `Opened ${direction}: ${size.toFixed(4)} SOL @ $${entryExecution.executionPrice.toFixed(4)}`,
    };
  }

  if (action === 'CLOSE') {
    const tradeIndex = db.activeTrades.findIndex((t) => t.id === tradeId);

    if (tradeIndex === -1) {
      return { success: false, error: 'Trade not found' };
    }

    const trade = db.activeTrades[tradeIndex];
    const signalExitPrice = exitPrice;

    // Calculate realistic exit execution with costs
    const exitExecution = calculateExitExecution(
      signalExitPrice,
      trade.direction,
      trade.size,
      atrPercent,
      DEFAULT_COST_CONFIG
    );

    const exitCosts: TradeCosts = {
      dexFeeUsd: exitExecution.costs.dexFeeUsd,
      slippageUsd: exitExecution.costs.slippageUsd,
      networkFeeUsd: exitExecution.costs.networkFeeUsd,
      totalCostUsd: exitExecution.costs.totalCostUsd,
      totalCostPercent: exitExecution.costs.totalCostPercent,
    };

    // Use actual execution prices for P&L calculation
    const actualEntryPrice = trade.entryPriceActual || trade.entryPrice;
    const actualExitPrice = exitExecution.executionPrice;

    // Calculate GROSS P&L (before fees, using actual prices)
    let grossPnl: number;
    let grossPnlPercent: number;

    if (trade.direction === 'LONG') {
      grossPnl = (actualExitPrice - actualEntryPrice) * trade.size;
      grossPnlPercent = ((actualExitPrice - actualEntryPrice) / actualEntryPrice) * 100;
    } else {
      grossPnl = (actualEntryPrice - actualExitPrice) * trade.size;
      grossPnlPercent = ((actualEntryPrice - actualExitPrice) / actualEntryPrice) * 100;
    }

    // Calculate total costs (entry + exit)
    const entryCostTotal = trade.entryCosts?.totalCostUsd || 0;
    const totalCostsUsd = entryCostTotal + exitCosts.totalCostUsd;

    // Calculate NET P&L (after all fees)
    const netPnl = grossPnl - totalCostsUsd;
    const netPnlPercent = (netPnl / (actualEntryPrice * trade.size)) * 100;

    // Phase 5: Stop tracking and get diagnostics
    const diagnostics = stopTrackingTrade(tradeId, {
      exitPrice: actualExitPrice,
      exitReason: reason,
      theoreticalExitPrice: signalExitPrice,
      actualExitPrice,
      exitSlippageBps: exitExecution.priceImpactPercent * 100,
      exitSlippageUsd: exitCosts.slippageUsd,
      totalFeesUsd: totalCostsUsd,
      finalPnlPercent: netPnlPercent,
    });

    // Phase 5: Record trade result for throttle system
    const tradeResult: 'win' | 'loss' | 'breakeven' =
      netPnlPercent > 0.05 ? 'win' : netPnlPercent < -0.05 ? 'loss' : 'breakeven';
    recordTrade(tradeResult, reason);

    // Update trade record
    trade.exitPrice = signalExitPrice;
    trade.exitPriceActual = actualExitPrice;
    trade.grossPnl = grossPnl;
    trade.grossPnlPercent = grossPnlPercent;
    trade.pnl = netPnl;
    trade.pnlPercent = netPnlPercent;
    trade.exitCosts = exitCosts;
    trade.totalCostsUsd = totalCostsUsd;
    trade.status = 'CLOSED';
    trade.closedAt = Date.now();
    trade.exitReason = reason;
    trade.diagnostics = diagnostics ?? undefined; // Store diagnostics

    db.activeTrades.splice(tradeIndex, 1);
    db.history.unshift(trade);

    saveDb(db);

    const emoji = netPnl >= 0 ? '🟢' : '🔴';
    const dirEmoji = trade.direction === 'LONG' ? '📈' : '📉';
    const feesInfo = `fees: $${totalCostsUsd.toFixed(4)}`;
    console.log(
      `[Trade] ${emoji} Closed ${trade.direction} ${dirEmoji}: ${trade.symbol} | ` +
        `Gross: $${grossPnl >= 0 ? '+' : ''}${grossPnl.toFixed(4)} | ` +
        `Net: $${netPnl >= 0 ? '+' : ''}${netPnl.toFixed(4)} (${netPnlPercent >= 0 ? '+' : ''}${netPnlPercent.toFixed(3)}%) | ` +
        `${feesInfo} | ${reason}`
    );

    return {
      success: true,
      trade,
      grossPnl,
      grossPnlPercent,
      netPnl,
      netPnlPercent,
      totalCosts: totalCostsUsd,
      execution: {
        signalPrice: signalExitPrice,
        fillPrice: actualExitPrice,
        slippagePercent: exitExecution.priceImpactPercent,
        costs: exitCosts,
      },
      diagnostics, // Include diagnostics in response
      message: `Closed ${trade.direction}. Net PnL: $${netPnl.toFixed(4)} (fees: $${totalCostsUsd.toFixed(4)})`,
    };
  }

  return { success: false, error: 'Invalid action' };
});