// server/utils/sol-candles.ts

/**
 * SOL/USDC Candle Engine
 * Builds OHLCV candles from price updates
 */

// === TYPES ===
export interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trades: number;
  timestamp: number;
}

export type Timeframe = '1s' | '1m' | '2m' | '5m' | '10m' | '15m' | '30m' | '1h';

// === CONFIGURATION ===
const TIMEFRAME_MS: Record<Timeframe, number> = {
  '1s': 1000,
  '1m': 60 * 1000,
  '2m': 2 * 60 * 1000,
  '5m': 5 * 60 * 1000,
  '10m': 10 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
};

const MAX_CANDLES: Record<Timeframe, number> = {
  '1s': 120,
  '1m': 100,
  '2m': 100,
  '5m': 100,
  '10m': 60,
  '15m': 48,
  '30m': 48,
  '1h': 48,
};

// === STATE ===
const candles: Record<Timeframe, Candle[]> = {
  '1s': [],
  '1m': [],
  '2m': [],
  '5m': [],
  '10m': [],
  '15m': [],
  '30m': [],
  '1h': [],
};

const currentCandle: Record<Timeframe, Candle | null> = {
  '1s': null,
  '1m': null,
  '2m': null,
  '5m': null,
  '10m': null,
  '15m': null,
  '30m': null,
  '1h': null,
};

let lastPrice = 0;
let totalTrades = 0;

// === MAIN UPDATE FUNCTION ===

export function updatePrice(price: number, timestamp: number = Date.now()): void {
  if (price <= 0) return;

  const isNewPrice = lastPrice > 0 && price !== lastPrice;
  if (isNewPrice) {
    totalTrades++;
  }

  lastPrice = price;

  const timeframes: Timeframe[] = ['1s', '1m', '2m', '5m', '10m', '15m', '30m', '1h'];

  for (const tf of timeframes) {
    updateTimeframe(tf, price, timestamp, isNewPrice);
  }
}

function updateTimeframe(
  timeframe: Timeframe,
  price: number,
  timestamp: number,
  isNewTrade: boolean
): void {
  const periodMs = TIMEFRAME_MS[timeframe];
  const periodStart = Math.floor(timestamp / periodMs) * periodMs;

  let current = currentCandle[timeframe];

  if (current && current.timestamp !== periodStart) {
    candles[timeframe].unshift(current);

    const maxCandles = MAX_CANDLES[timeframe];
    if (candles[timeframe].length > maxCandles) {
      candles[timeframe] = candles[timeframe].slice(0, maxCandles);
    }

    current = null;
  }

  if (!current) {
    current = {
      open: price,
      high: price,
      low: price,
      close: price,
      volume: 0,
      trades: 0,
      timestamp: periodStart,
    };
    currentCandle[timeframe] = current;
  }

  current.high = Math.max(current.high, price);
  current.low = Math.min(current.low, price);
  current.close = price;

  if (isNewTrade) {
    current.trades += 1;
    current.volume += 1;
  }
}

// === GETTERS ===

export function getCandles(timeframe: Timeframe, limit: number = 50): Candle[] {
  const result: Candle[] = [];

  const current = currentCandle[timeframe];
  if (current) {
    result.push(current);
  }

  const tfCandles = candles[timeframe];
  if (tfCandles && tfCandles.length > 0) {
    result.push(...tfCandles.slice(0, limit - 1));
  }

  return result;
}

export function getCurrentCandle(timeframe: Timeframe): Candle | null {
  return currentCandle[timeframe];
}

export function getAllCurrentCandles(): Record<Timeframe, Candle | null> {
  return { ...currentCandle };
}

export function getLastPrice(): number {
  return lastPrice;
}

export function getCandleStats(): {
  totalCandles: number;
  totalTrades: number;
  timeframes: Record<Timeframe, number>;
} {
  const timeframes: Record<Timeframe, number> = {
    '1s': candles['1s'].length + (currentCandle['1s'] ? 1 : 0),
    '1m': candles['1m'].length + (currentCandle['1m'] ? 1 : 0),
    '2m': candles['2m'].length + (currentCandle['2m'] ? 1 : 0),
    '5m': candles['5m'].length + (currentCandle['5m'] ? 1 : 0),
    '10m': candles['10m'].length + (currentCandle['10m'] ? 1 : 0),
    '30m': candles['30m'].length + (currentCandle['30m'] ? 1 : 0),
    '1h': candles['1h'].length + (currentCandle['1h'] ? 1 : 0),
  };

  const totalCandles = Object.values(timeframes).reduce((a, b) => a + b, 0);

  return { totalCandles, totalTrades, timeframes };
}

// === COMPUTED STATS ===

export function getPriceChange(timeframe: Timeframe): number {
  const candleList = getCandles(timeframe, 2);
  if (candleList.length < 2) {
    if (candleList.length === 1) {
      const c = candleList[0];
      return ((c.close - c.open) / c.open) * 100;
    }
    return 0;
  }

  const current = candleList[0];
  const previous = candleList[1];

  return ((current.close - previous.close) / previous.close) * 100;
}

export function getAllPriceChanges(): Record<Timeframe, number> {
  return {
    '1s': getPriceChange('1s'),
    '1m': getPriceChange('1m'),
    '2m': getPriceChange('2m'),
    '5m': getPriceChange('5m'),
    '10m': getPriceChange('10m'),
    '30m': getPriceChange('30m'),
    '1h': getPriceChange('1h'),
  };
}

// === CLEANUP ===

export function resetCandles(): void {
  const timeframes: Timeframe[] = ['1s', '1m', '2m', '5m', '10m', '15m', '30m', '1h'];

  for (const tf of timeframes) {
    candles[tf] = [];
    currentCandle[tf] = null;
  }

  lastPrice = 0;
  totalTrades = 0;

  console.log('[SolCandles] Reset all candle data');
}

// === HISTORICAL DATA LOADING ===

/**
 * Load historical candles into storage
 * Called on startup to provide historical context for indicators
 */
export function loadHistoricalCandles(
  timeframe: Timeframe,
  historicalCandles: Candle[]
): void {
  if (historicalCandles.length === 0) return;

  const maxCandles = MAX_CANDLES[timeframe];

  // Historical candles should already be sorted newest-first
  // Take up to maxCandles
  candles[timeframe] = historicalCandles.slice(0, maxCandles);

  // Set lastPrice from the most recent candle if we don't have one yet
  if (lastPrice === 0 && historicalCandles.length > 0) {
    lastPrice = historicalCandles[0].close;
  }

  console.log(`[SolCandles] Loaded ${candles[timeframe].length} historical ${timeframe} candles`);
}

/**
 * Load all historical candles from a map
 */
export function loadAllHistoricalCandles(
  candleMap: Map<string, Candle[]>
): void {
  const validTimeframes: Timeframe[] = ['1s', '1m', '2m', '5m', '10m', '15m', '30m', '1h'];

  for (const [tf, historicalCandles] of candleMap) {
    if (validTimeframes.includes(tf as Timeframe)) {
      loadHistoricalCandles(tf as Timeframe, historicalCandles);
    }
  }

  // Log summary
  const totalLoaded = validTimeframes.reduce(
    (sum, tf) => sum + candles[tf].length,
    0
  );
  console.log(`[SolCandles] ✅ Total historical candles loaded: ${totalLoaded}`);
}