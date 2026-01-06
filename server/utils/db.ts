// server/utils/db.ts

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import type { TradeDiagnostics } from '../diagnostics/types';

const DB_PATH = join(process.cwd(), 'data', 'trades.json');

// Limits
const MAX_ACTIVE_TRADES = 10;
const MAX_HISTORY_TRADES = 1000;

export interface TradeCosts {
  dexFeeUsd: number;
  slippageUsd: number;
  networkFeeUsd: number;
  totalCostUsd: number;
  totalCostPercent: number;
}

export interface Trade {
  id: string;
  address: string;
  symbol: string;
  name: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number; // Signal price
  entryPriceActual?: number; // Actual execution price after slippage
  exitPrice?: number; // Signal price
  exitPriceActual?: number; // Actual execution price after slippage
  amount: number;
  size: number; // SOL amount

  // P&L tracking (gross = before fees, net = after fees)
  grossPnl?: number;
  grossPnlPercent?: number;
  pnl?: number; // Net P&L (after all costs)
  pnlPercent?: number; // Net P&L percent

  // Cost tracking
  entryCosts?: TradeCosts;
  exitCosts?: TradeCosts;
  totalCostsUsd?: number;

  timestamp: number;
  closedAt?: number;
  status: 'OPEN' | 'CLOSED';
  exitReason?: string;

  // Phase 5: Diagnostics (signal quality at entry)
  signalScore?: number;
  signalConfidence?: number;
  stopLossPercent?: number;
  takeProfitPercent?: number;

  // Phase 5: Complete diagnostics (populated on close)
  diagnostics?: TradeDiagnostics;
}

export interface Database {
  activeTrades: Trade[];
  history: Trade[];
}

const defaultDb: Database = {
  activeTrades: [],
  history: [],
};

export function getDb(): Database {
  try {
    if (!existsSync(DB_PATH)) {
      const dir = dirname(DB_PATH);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      saveDb(defaultDb);
      return { ...defaultDb };
    }
    const data = readFileSync(DB_PATH, 'utf-8');
    const parsed = JSON.parse(data);

    // Ensure arrays exist (fix corrupted db)
    return {
      activeTrades: parsed.activeTrades || [],
      history: parsed.history || [],
    };
  } catch (e) {
    console.error('[DB] Error reading database:', e);
    return { ...defaultDb };
  }
}

export function saveDb(db: Database): void {
  try {
    // Ensure arrays exist before slicing
    if (!db.activeTrades) db.activeTrades = [];
    if (!db.history) db.history = [];

    db.activeTrades = db.activeTrades.slice(0, MAX_ACTIVE_TRADES);
    db.history = db.history.slice(0, MAX_HISTORY_TRADES);

    const dir = dirname(DB_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
  } catch (e) {
    console.error('[DB] Error saving database:', e);
  }
}

export function getDbStats() {
  const db = getDb();
  
  const longs = db.history.filter(t => t.direction === 'LONG');
  const shorts = db.history.filter(t => t.direction === 'SHORT');
  
  return {
    activeTrades: db.activeTrades.length,
    historyTrades: db.history.length,
    maxHistory: MAX_HISTORY_TRADES,
    longs: longs.length,
    shorts: shorts.length,
    longWins: longs.filter(t => (t.pnl || 0) > 0).length,
    shortWins: shorts.filter(t => (t.pnl || 0) > 0).length,
  };
}