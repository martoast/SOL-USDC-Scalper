// server/api/trade.post.ts

import { defineEventHandler, readBody } from 'h3'
import { getDb, saveDb, type Trade } from '../utils/db'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { action, trade: tradeData } = body

  const db = getDb()

  if (action === 'OPEN') {
    const newTrade: Trade = {
      id: Math.random().toString(36).substring(7),
      address: tradeData.address || 'SOL',
      symbol: tradeData.symbol || 'SOL/USDC',
      name: tradeData.name || 'Solana',
      entryPrice: tradeData.entryPrice,
      amount: tradeData.amount,
      timestamp: tradeData.timestamp || Date.now(),
      status: 'OPEN',
    }

    db.activeTrades.push(newTrade)
    saveDb(db)

    console.log(`[Trade] Opened: ${newTrade.symbol} @ $${newTrade.entryPrice}`)

    return {
      success: true,
      trade: newTrade,
      message: `Opened position: $${newTrade.amount} on ${newTrade.symbol}`,
    }
  }

  if (action === 'CLOSE') {
    const { tradeId, exitPrice, pnl, pnlPercent, reason } = body

    const tradeIndex = db.activeTrades.findIndex((t) => t.id === tradeId)

    if (tradeIndex === -1) {
      return { success: false, error: 'Trade not found' }
    }

    const trade = db.activeTrades[tradeIndex]

    // Update trade with exit info
    trade.exitPrice = exitPrice
    trade.pnl = pnl
    trade.status = 'CLOSED'
    trade.closedAt = Date.now()

    // Move from active to history
    db.activeTrades.splice(tradeIndex, 1)
    db.history.unshift(trade)

    saveDb(db)

    console.log(`[Trade] Closed: ${trade.symbol} | PnL: $${pnl?.toFixed(4)} (${reason})`)

    return {
      success: true,
      trade,
      pnl,
      message: `Closed ${trade.symbol}. PnL: $${pnl?.toFixed(4)}`,
    }
  }

  return { success: false, error: 'Invalid action' }
})