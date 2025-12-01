// server/utils/db.ts

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

const DB_PATH = join(process.cwd(), 'data', 'trades.json');

// Limits
const MAX_ACTIVE_TRADES = 10;
const MAX_HISTORY_TRADES = 1000;

export interface Trade {
  id: string;
  address: string;
  symbol: string;
  name: string;
  direction: 'LONG' | 'SHORT'; // NEW: Trade direction
  entryPrice: number;
  exitPrice?: number;
  amount: number;
  size: number; // SOL amount
  pnl?: number;
  pnlPercent?: number;
  timestamp: number;
  closedAt?: number;
  status: 'OPEN' | 'CLOSED';
  exitReason?: string;
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
      return defaultDb;
    }
    const data = readFileSync(DB_PATH, 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    console.error('[DB] Error reading database:', e);
    return defaultDb;
  }
}

export function saveDb(db: Database): void {
  try {
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