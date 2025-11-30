/**
 * Helius WebSocket Stream Manager
 * Tracks Raydium SOL/USDC pool - price from pool reserves, no external APIs
 */

import WebSocket from 'ws';

// === CONSTANTS ===
const SOL_USDC_POOL = '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2';
const SOL_VAULT = '8BnEgHoWFysVcuFFX7QztDmzuH8r5ZFvyP3sYwn1XTh6';
const USDC_VAULT = '8HoQnePLqPj4M7PUDzfw8e3Ymdwgc7NLGnaTUapubyvu';

// === STATE ===
let ws: WebSocket | null = null;
let apiKey: string | null = null;
let isRunning = false;
let reconnectTimer: NodeJS.Timeout | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let priceTimer: NodeJS.Timeout | null = null;

const stats = {
  connected: false,
  lastMessage: 0,
  messagesReceived: 0,
  swapsProcessed: 0,
  errors: 0,
  reconnects: 0,
  startedAt: 0,
};

let currentPrice = 0;
let priceHistory: { price: number; time: number }[] = [];
let priceChange30s = 0;
let volume30s = 0;
let recentSwapCount = 0;

// === INIT ===

export function initializeStream(key: string): void {
  apiKey = key;
  console.log('[HeliusStream] Initialized for SOL/USDC tracking');
}

export function startStream(): void {
  if (!apiKey || isRunning) return;

  isRunning = true;
  stats.startedAt = Date.now();
  stats.swapsProcessed = 0;
  stats.errors = 0;
  stats.reconnects = 0;

  fetchPriceFromPool();
  connect();

  // Fetch price from pool every 2s (Helius has high limits)
  priceTimer = setInterval(fetchPriceFromPool, 2000);

  console.log('[HeliusStream] 🎯 Tracking SOL/USDC pool');
}

export function stopStream(): void {
  isRunning = false;
  if (ws) { ws.close(); ws = null; }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  if (priceTimer) { clearInterval(priceTimer); priceTimer = null; }
  stats.connected = false;
}

// === PRICE FROM POOL RESERVES ===

async function fetchPriceFromPool(): Promise<void> {
  if (!apiKey) return;

  try {
    // Batch request for both vaults
    const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'getTokenAccountBalance',
          params: [SOL_VAULT]
        },
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'getTokenAccountBalance',
          params: [USDC_VAULT]
        }
      ])
    });

    if (!res.ok) {
      console.error('[HeliusStream] RPC error:', res.status);
      return;
    }

    const data = await res.json();
    
    const solAmount = parseFloat(data[0]?.result?.value?.uiAmountString || '0');
    const usdcAmount = parseFloat(data[1]?.result?.value?.uiAmountString || '0');

    if (solAmount > 0 && usdcAmount > 0) {
      const price = usdcAmount / solAmount;
      currentPrice = price;

      // Track price history for 30s change
      const now = Date.now();
      priceHistory.push({ price, time: now });
      
      // Keep only last 30s of history
      const cutoff = now - 30000;
      priceHistory = priceHistory.filter(p => p.time > cutoff);

      // Calculate 30s change
      if (priceHistory.length >= 2) {
        const oldest = priceHistory[0].price;
        priceChange30s = ((price - oldest) / oldest) * 100;
      }

      // Log every 5th update to reduce noise
      if (stats.messagesReceived % 5 === 0) {
        console.log(
          `[HeliusStream] 💰 $${price.toFixed(2)} | ` +
          `30s: ${priceChange30s >= 0 ? '+' : ''}${priceChange30s.toFixed(3)}% | ` +
          `Swaps: ${stats.swapsProcessed}`
        );
      }
    }
  } catch (e: any) {
    console.error('[HeliusStream] Price fetch error:', e.message);
  }
}

// === WEBSOCKET ===

function connect(): void {
  if (!apiKey || !isRunning) return;

  try {
    ws = new WebSocket(`wss://mainnet.helius-rpc.com/?api-key=${apiKey}`);

    ws.on('open', () => {
      console.log('[HeliusStream] ✅ Connected');
      stats.connected = true;
      stats.lastMessage = Date.now();
      stats.reconnects = 0;
      subscribe();
      startHeartbeat();
    });

    ws.on('message', handleMessage);

    ws.on('error', (err) => {
      console.error('[HeliusStream] WS Error:', err.message);
      stats.errors++;
    });

    ws.on('close', () => {
      console.log('[HeliusStream] Disconnected');
      stats.connected = false;
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
      if (isRunning) scheduleReconnect();
    });
  } catch (e: any) {
    console.error('[HeliusStream] Connect failed:', e.message);
    scheduleReconnect();
  }
}

function subscribe(): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  const msg = {
    jsonrpc: '2.0',
    id: 1,
    method: 'logsSubscribe',
    params: [
      { mentions: [SOL_USDC_POOL] },
      { commitment: 'confirmed' }
    ]
  };

  ws.send(JSON.stringify(msg));
  console.log('[HeliusStream] 📡 Subscribed to SOL/USDC pool');
}

function scheduleReconnect(): void {
  if (reconnectTimer || !isRunning) return;
  stats.reconnects++;
  const delay = Math.min(3000 * stats.reconnects, 30000);
  console.log(`[HeliusStream] Reconnecting in ${delay}ms...`);
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, delay);
}

function startHeartbeat(): void {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  
  heartbeatTimer = setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) ws.ping();
    
    if (Date.now() - stats.lastMessage > 60000 && ws) {
      console.log('[HeliusStream] Stale, reconnecting...');
      ws.close();
    }

    // Update volume estimate from recent swaps
    volume30s = recentSwapCount * 500;
    recentSwapCount = 0;
  }, 1000);
}

// === MESSAGE HANDLING ===

function handleMessage(data: WebSocket.Data): void {
  stats.messagesReceived++;
  stats.lastMessage = Date.now();

  try {
    const msg = JSON.parse(data.toString());

    if (msg.result !== undefined && msg.id) {
      console.log('[HeliusStream] Subscription ID:', msg.result);
      return;
    }

    if (msg.method === 'logsNotification') {
      const value = msg.params?.result?.value;
      if (!value || value.err) return;

      const logs: string[] = value.logs || [];
      const signature = value.signature;

      const isSwap = logs.some((log: string) =>
        log.includes('ray_log') ||
        log.includes('Swap') ||
        log.includes('swap')
      );

      if (isSwap && signature) {
        stats.swapsProcessed++;
        recentSwapCount++;
        
        // Fetch fresh price after each swap
        fetchPriceFromPool();
        
        console.log(`[HeliusStream] 🔄 Swap #${stats.swapsProcessed}: ${signature.slice(0, 16)}...`);
      }
    }
  } catch (e) {
    // Ignore
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