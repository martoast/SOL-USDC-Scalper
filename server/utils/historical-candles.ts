// server/utils/historical-candles.ts

/**
 * Historical Candle Fetcher
 *
 * Fetches historical OHLCV data on startup so the bot has historical context.
 *
 * Priority:
 * 1. Birdeye API (if API key available) - Best data, real OHLCV with volume
 * 2. CoinGecko (free) - 30m candles as fallback
 * 3. DexScreener (free) - Synthetic candles as last resort
 */

import type { Candle, Timeframe } from './sol-candles';

// SOL token address
const SOL_ADDRESS = 'So11111111111111111111111111111111111111112';

// Birdeye OHLCV response format
interface BirdeyeCandle {
  o: number;  // open
  h: number;  // high
  l: number;  // low
  c: number;  // close
  v: number;  // volume
  unixTime: number;
}

// CoinGecko OHLC response format: [timestamp, open, high, low, close]
type CoinGeckoOHLC = [number, number, number, number, number];

/**
 * Fetch historical candles from Birdeye API (requires API key)
 * Returns up to 1000 candles at specified timeframe
 */
export async function fetchFromBirdeye(
  timeframe: '1m' | '5m' | '15m' | '30m' | '1H',
  apiKey: string
): Promise<Candle[]> {
  const now = Math.floor(Date.now() / 1000);
  const timeframeSeconds: Record<string, number> = {
    '1m': 60,
    '5m': 300,
    '15m': 900,
    '30m': 1800,
    '1H': 3600,
  };
  const secondsPerCandle = timeframeSeconds[timeframe] || 60;
  // Request enough time to get ~200 candles
  const timeFrom = now - (200 * secondsPerCandle);

  const url = `https://public-api.birdeye.so/defi/ohlcv?address=${SOL_ADDRESS}&type=${timeframe}&time_from=${timeFrom}&time_to=${now}`;

  try {
    console.log(`[Historical] Fetching ${timeframe} candles from Birdeye...`);

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'X-API-KEY': apiKey,
      },
    });

    if (!response.ok) {
      console.error(`[Historical] Birdeye API error: ${response.status} ${response.statusText}`);
      return [];
    }

    const data = await response.json();
    const items: BirdeyeCandle[] = data.data?.items || [];

    if (items.length === 0) {
      console.error('[Historical] No data from Birdeye');
      return [];
    }

    const candles: Candle[] = items.map((item) => ({
      open: item.o,
      high: item.h,
      low: item.l,
      close: item.c,
      volume: item.v,
      trades: 0,
      timestamp: item.unixTime * 1000, // Convert to milliseconds
    }));

    // Sort by timestamp descending (newest first)
    candles.sort((a, b) => b.timestamp - a.timestamp);

    console.log(`[Historical] ✅ Loaded ${candles.length} ${timeframe} candles from Birdeye`);
    return candles;

  } catch (error) {
    console.error('[Historical] Birdeye fetch failed:', error);
    return [];
  }
}

/**
 * Fetch historical candles from CoinGecko API (free, no API key needed)
 */
export async function fetchHistoricalCandles(
  timeframe: '1m' | '5m' | '15m' | '30m' | '1h',
  count: number = 100,
  apiKey?: string
): Promise<Candle[]> {
  // CoinGecko free tier gives us 30m candles for 1-2 days
  const days = timeframe === '1h' ? 2 : 1;

  const url = `https://api.coingecko.com/api/v3/coins/solana/ohlc?vs_currency=usd&days=${days}`;

  try {
    console.log(`[Historical] Fetching ${timeframe} candles from CoinGecko...`);

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      console.error(`[Historical] CoinGecko API error: ${response.status} ${response.statusText}`);
      return [];
    }

    const data: CoinGeckoOHLC[] = await response.json();

    if (!Array.isArray(data) || data.length === 0) {
      console.error('[Historical] Invalid response from CoinGecko');
      return [];
    }

    const candles: Candle[] = data.map((item) => ({
      open: item[1],
      high: item[2],
      low: item[3],
      close: item[4],
      volume: 0,
      trades: 0,
      timestamp: item[0],
    }));

    // Sort by timestamp descending (newest first)
    candles.sort((a, b) => b.timestamp - a.timestamp);
    const result = candles.slice(0, count);

    console.log(`[Historical] ✅ Loaded ${result.length} candles (30m granularity from CoinGecko)`);
    return result;

  } catch (error) {
    console.error('[Historical] CoinGecko fetch failed:', error);
    return [];
  }
}

/**
 * Fetch from DexScreener as backup (also free)
 */
export async function fetchFromDexScreener(): Promise<Candle[]> {
  // SOL/USDC Raydium pool
  const pairAddress = '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2';
  const url = `https://api.dexscreener.com/latest/dex/pairs/solana/${pairAddress}`;

  try {
    console.log('[Historical] Fetching current price from DexScreener...');

    const response = await fetch(url);
    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    const pair = data.pair;

    if (!pair || !pair.priceUsd) {
      return [];
    }

    // DexScreener gives us current price and 24h price change
    // We can construct a simple candle from this
    const currentPrice = parseFloat(pair.priceUsd);
    const priceChange24h = parseFloat(pair.priceChange?.h24 || '0') / 100;
    const price24hAgo = currentPrice / (1 + priceChange24h);

    const now = Date.now();
    const dayAgo = now - 24 * 60 * 60 * 1000;

    // Create synthetic hourly candles from the price change
    const candles: Candle[] = [];
    const steps = 24;
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const price = price24hAgo + (currentPrice - price24hAgo) * t;
      candles.push({
        open: price,
        high: price * 1.002,
        low: price * 0.998,
        close: price,
        volume: 0,
        trades: 0,
        timestamp: dayAgo + (i * 60 * 60 * 1000),
      });
    }

    // Add current candle
    candles.push({
      open: currentPrice,
      high: currentPrice,
      low: currentPrice,
      close: currentPrice,
      volume: 0,
      trades: 0,
      timestamp: now,
    });

    candles.sort((a, b) => b.timestamp - a.timestamp);
    console.log(`[Historical] ✅ Built ${candles.length} synthetic candles from DexScreener`);

    return candles;

  } catch (error) {
    console.error('[Historical] DexScreener fetch failed:', error);
    return [];
  }
}

/**
 * Fetch all historical candles we need for indicators
 *
 * Priority: Birdeye (with API key) > CoinGecko > DexScreener
 */
export async function fetchAllHistoricalCandles(apiKey?: string): Promise<Map<string, Candle[]>> {
  const result = new Map<string, Candle[]>();

  // Get Birdeye API key from runtime config or environment
  const birdeyeKey = apiKey || process.env.NUXT_BIRDEYE_API_KEY;

  // Try Birdeye first if we have an API key (best data!)
  if (birdeyeKey) {
    console.log('[Historical] Using Birdeye API (best quality data)...');

    // Fetch 1m candles - most important for scalping
    const oneMinCandles = await fetchFromBirdeye('1m', birdeyeKey);
    if (oneMinCandles.length > 0) {
      result.set('1m', oneMinCandles.slice(0, 100)); // Keep 100 most recent

      // Build other timeframes from 1m data
      const fiveMinCandles = buildLargerTimeframe(oneMinCandles, 5);
      const thirtyMinCandles = buildLargerTimeframe(oneMinCandles, 30);
      const hourlyCandles = buildLargerTimeframe(oneMinCandles, 60);

      if (fiveMinCandles.length > 0) result.set('5m', fiveMinCandles);
      if (thirtyMinCandles.length > 0) result.set('30m', thirtyMinCandles);
      if (hourlyCandles.length > 0) result.set('1h', hourlyCandles);

      // Also build 2m and 10m
      const twoMinCandles = buildLargerTimeframe(oneMinCandles, 2);
      const tenMinCandles = buildLargerTimeframe(oneMinCandles, 10);
      if (twoMinCandles.length > 0) result.set('2m', twoMinCandles);
      if (tenMinCandles.length > 0) result.set('10m', tenMinCandles);

      console.log(`[Historical] ✅ Birdeye: 1m=${oneMinCandles.length}, 5m=${fiveMinCandles.length}, 30m=${thirtyMinCandles.length}, 1h=${hourlyCandles.length}`);
      return result;
    }
  }

  // Fallback to CoinGecko (30m candles)
  console.log('[Historical] Falling back to CoinGecko...');
  let baseCandles = await fetchHistoricalCandles('30m', 48);

  // If CoinGecko fails, try DexScreener
  if (baseCandles.length === 0) {
    console.log('[Historical] CoinGecko failed, trying DexScreener...');
    baseCandles = await fetchFromDexScreener();
  }

  if (baseCandles.length === 0) {
    console.error('[Historical] All sources failed - no historical data available');
    return result;
  }

  // Store 30m candles directly
  result.set('30m', baseCandles);

  // Build 1h candles by combining pairs of 30m candles
  const hourlyCandles = buildHourlyFromHalfHourly(baseCandles);
  if (hourlyCandles.length > 0) {
    result.set('1h', hourlyCandles);
  }

  // For shorter timeframes, use 30m data as baseline
  result.set('5m', baseCandles.slice(0, 60));
  result.set('1m', baseCandles.slice(0, 60));

  console.log(`[Historical] Loaded candles: 30m=${result.get('30m')?.length || 0}, 1h=${result.get('1h')?.length || 0}`);

  return result;
}

/**
 * Build larger timeframe candles from smaller ones
 */
function buildLargerTimeframe(candles: Candle[], minutesPerCandle: number): Candle[] {
  if (candles.length === 0) return [];

  // Sort oldest first for processing
  const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
  const result: Candle[] = [];

  const msPerCandle = minutesPerCandle * 60 * 1000;

  for (let i = 0; i < sorted.length; i += minutesPerCandle) {
    const batch = sorted.slice(i, i + minutesPerCandle);
    if (batch.length === 0) continue;

    // Align to timeframe boundary
    const timestamp = Math.floor(batch[0].timestamp / msPerCandle) * msPerCandle;

    result.push({
      open: batch[0].open,
      high: Math.max(...batch.map(c => c.high)),
      low: Math.min(...batch.map(c => c.low)),
      close: batch[batch.length - 1].close,
      volume: batch.reduce((sum, c) => sum + c.volume, 0),
      trades: batch.reduce((sum, c) => sum + c.trades, 0),
      timestamp,
    });
  }

  // Sort newest first
  result.sort((a, b) => b.timestamp - a.timestamp);
  return result;
}

/**
 * Build hourly candles from 30-minute candles
 */
function buildHourlyFromHalfHourly(halfHourlyCandles: Candle[]): Candle[] {
  const hourlyCandles: Candle[] = [];

  // Sort oldest first for processing
  const sorted = [...halfHourlyCandles].sort((a, b) => a.timestamp - b.timestamp);

  for (let i = 0; i < sorted.length - 1; i += 2) {
    const first = sorted[i];
    const second = sorted[i + 1];
    if (!first || !second) continue;

    // Align to hour boundary
    const hourTimestamp = Math.floor(first.timestamp / (60 * 60 * 1000)) * (60 * 60 * 1000);

    hourlyCandles.push({
      open: first.open,
      high: Math.max(first.high, second.high),
      low: Math.min(first.low, second.low),
      close: second.close,
      volume: first.volume + second.volume,
      trades: first.trades + second.trades,
      timestamp: hourTimestamp,
    });
  }

  // Sort newest first
  hourlyCandles.sort((a, b) => b.timestamp - a.timestamp);
  return hourlyCandles;
}

/**
 * Build 2m and 10m candles from 1m candles
 * (Birdeye doesn't have these timeframes directly)
 */
export function buildDerivedCandles(oneMinCandles: Candle[]): {
  twoMin: Candle[];
  tenMin: Candle[];
} {
  const twoMin: Candle[] = [];
  const tenMin: Candle[] = [];

  // Build 2m candles (aggregate every 2 1m candles)
  for (let i = 0; i < oneMinCandles.length - 1; i += 2) {
    const candle1 = oneMinCandles[i];
    const candle2 = oneMinCandles[i + 1];
    if (!candle1 || !candle2) continue;

    // Align to 2-minute boundary
    const timestamp = Math.floor(candle2.timestamp / (2 * 60 * 1000)) * (2 * 60 * 1000);

    twoMin.push({
      open: candle2.open, // Earlier candle's open
      high: Math.max(candle1.high, candle2.high),
      low: Math.min(candle1.low, candle2.low),
      close: candle1.close, // Later candle's close
      volume: candle1.volume + candle2.volume,
      trades: candle1.trades + candle2.trades,
      timestamp,
    });
  }

  // Build 10m candles (aggregate every 10 1m candles)
  for (let i = 0; i < oneMinCandles.length - 9; i += 10) {
    const batch = oneMinCandles.slice(i, i + 10);
    if (batch.length < 10) continue;

    // Align to 10-minute boundary
    const timestamp = Math.floor(batch[9].timestamp / (10 * 60 * 1000)) * (10 * 60 * 1000);

    tenMin.push({
      open: batch[9].open, // Earliest candle's open
      high: Math.max(...batch.map(c => c.high)),
      low: Math.min(...batch.map(c => c.low)),
      close: batch[0].close, // Latest candle's close
      volume: batch.reduce((sum, c) => sum + c.volume, 0),
      trades: batch.reduce((sum, c) => sum + c.trades, 0),
      timestamp,
    });
  }

  return { twoMin, tenMin };
}
