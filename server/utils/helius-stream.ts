// server/utils/helius-stream.ts

/**
 * Helius Stream Manager
 * Real-time SOL price from Jupiter Quote API
 * Now with candle building!
 */

import { updatePrice, getCandleStats, getAllPriceChanges, resetCandles } from './sol-candles';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const ONE_SOL = '1000000000';

// === STATE ===
let isRunning = false;
let pollTimer: NodeJS.Timeout | null = null;

const stats = {
  connected: false,
  lastMessage: 0,
  messagesReceived: 0,
  swapsProcessed: 0,
  errors: 0,
  reconnects: 0,
  startedAt: 0,
  pollCount: 0,
};

let currentPrice = 0;
let lastPrice = 0;
let priceHistory: { price: number; time: number }[] = [];
let priceChange30s = 0;
let volume30s = 0;

let rateLimitedUntil = 0;

// === INIT ===

export function initializeStream(heliusKey: string, jupiterKey?: string): void {
  console.log('[HeliusStream] Initialized with candle engine');
}

export function startStream(): void {
  if (isRunning) return;

  isRunning = true;
  stats.startedAt = Date.now();
  stats.swapsProcessed = 0;
  stats.errors = 0;
  stats.reconnects = 0;
  stats.messagesReceived = 0;
  stats.pollCount = 0;
  rateLimitedUntil = 0;

  // Reset candles on start
  resetCandles();

  pollLoop();

  console.log('[HeliusStream] 🎯 Started - Jupiter Quote API + Candles');
}

export function stopStream(): void {
  isRunning = false;
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  stats.connected = false;
}

// === POLL LOOP ===

async function pollLoop(): Promise<void> {
  if (!isRunning) return;

  const now = Date.now();

  if (now < rateLimitedUntil) {
    const waitTime = rateLimitedUntil - now;
    pollTimer = setTimeout(pollLoop, Math.min(waitTime + 100, 5000));
    return;
  }

  await fetchPrice();

  if (isRunning) {
    pollTimer = setTimeout(pollLoop, 2000);
  }
}

// === FETCH PRICE ===

async function fetchPrice(): Promise<void> {
  stats.pollCount++;
  const now = Date.now();

  try {
    const res = await fetch(
      `https://lite-api.jup.ag/swap/v1/quote?inputMint=${SOL_MINT}&outputMint=${USDC_MINT}&amount=${ONE_SOL}&slippageBps=50`
    );

    if (res.status === 429) {
      stats.errors++;
      rateLimitedUntil = Date.now() + 60000;
      console.error(`[HeliusStream] Rate limited - pausing for 60s`);
      return;
    }

    if (!res.ok) {
      stats.errors++;
      return;
    }

    const data = await res.json();
    const outAmount = parseInt(data?.outAmount || '0');
    if (outAmount <= 0) return;

    const newPrice = outAmount / 1_000_000;

    // Update candle engine with every price
    updatePrice(newPrice, now);

    // Detect price change for logging
    const priceChangePercent = lastPrice > 0 ? ((newPrice - lastPrice) / lastPrice) * 100 : 0;

    if (lastPrice > 0 && Math.abs(priceChangePercent) > 0.001) {
      stats.swapsProcessed++;
      stats.messagesReceived++;

      const direction = newPrice > lastPrice ? '📈' : '📉';
      console.log(
        `[HeliusStream] ${direction} #${stats.swapsProcessed} | ` +
        `$${newPrice.toFixed(4)} | Δ${priceChangePercent >= 0 ? '+' : ''}${priceChangePercent.toFixed(4)}%`
      );
    }

    lastPrice = currentPrice || newPrice;
    currentPrice = newPrice;

    // Track history for 30s change
    priceHistory.push({ price: newPrice, time: now });
    priceHistory = priceHistory.filter(p => p.time > now - 30000);

    if (priceHistory.length >= 2) {
      const oldest = priceHistory[0].price;
      priceChange30s = ((newPrice - oldest) / oldest) * 100;
    }

    // Log with candle stats periodically
    if (stats.pollCount % 15 === 0) {
      const candleStats = getCandleStats();
      const changes = getAllPriceChanges();
      console.log(
        `[HeliusStream] 💰 $${newPrice.toFixed(4)} | ` +
        `30s: ${priceChange30s >= 0 ? '+' : ''}${priceChange30s.toFixed(3)}% | ` +
        `1m: ${changes['1m'] >= 0 ? '+' : ''}${changes['1m'].toFixed(3)}% | ` +
        `5m: ${changes['5m'] >= 0 ? '+' : ''}${changes['5m'].toFixed(3)}% | ` +
        `Candles: ${candleStats.totalCandles}`
      );
    }

    stats.lastMessage = now;
    stats.connected = true;
  } catch (e: any) {
    stats.errors++;
  }
}

// === PUBLIC API ===

export function getStreamStats() {
  return {
    ...stats,
    uptime: stats.startedAt ? Date.now() - stats.startedAt : 0,
  };
}

export function getCurrentPrice() {
  return { price: currentPrice, timestamp: Date.now(), volume30s };
}

export function getPriceChange30s(): number {
  return priceChange30s;
}

export function getVolume30s(): number {
  return volume30s;
}

export function isStreamConnected(): boolean {
  return stats.connected;
}

export function isStreamRunning(): boolean {
  return isRunning;
}