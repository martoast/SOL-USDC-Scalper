// server/engine/price-engine.ts

/**
 * Price Engine
 *
 * Real-time SOL/USDC price tracking via Helius WebSocket
 */

import { WSConnection } from './ws-connection';
import { PoolSubscriber } from './pool-subscriber';
import { eventBus, EVENTS, type PriceUpdate } from './event-bus';
import { updatePrice, resetCandles, loadHistoricalCandles, loadAllHistoricalCandles } from '../utils/sol-candles';
import { fetchAllHistoricalCandles, buildDerivedCandles } from '../utils/historical-candles';

export class PriceEngine {
  private wsConnection: WSConnection | null = null;
  private poolSubscriber: PoolSubscriber | null = null;
  private isRunning = false;
  private heliusApiKey: string;

  private stats = {
    startedAt: 0,
    priceUpdates: 0,
    lastPrice: 0,
    lastUpdateTime: 0,
  };

  constructor(heliusApiKey: string) {
    this.heliusApiKey = heliusApiKey;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('[PriceEngine] Already running');
      return;
    }

    console.log('[PriceEngine] 🚀 Starting...');
    this.isRunning = true;
    this.stats.startedAt = Date.now();

    // Reset candles on start
    resetCandles();

    // Setup price update listener
    this.setupPriceListener();

    // Connect WebSocket first (so server is responsive)
    await this.connect();

    // Load historical candles in background (non-blocking)
    this.loadHistoricalData().catch(err => {
      console.error('[PriceEngine] Historical data error:', err);
    });
  }

  /**
   * Fetch and load historical candle data from Birdeye
   */
  private async loadHistoricalData(): Promise<void> {
    try {
      console.log('[PriceEngine] 📊 Loading historical candles...');

      // Fetch historical candles from Birdeye (no API key needed for basic access)
      const candleMap = await fetchAllHistoricalCandles();

      if (candleMap.size === 0) {
        console.log('[PriceEngine] ⚠️ No historical data available - starting fresh');
        return;
      }

      // Build derived timeframes (2m, 10m) from 1m data
      const oneMinCandles = candleMap.get('1m');
      if (oneMinCandles && oneMinCandles.length > 0) {
        const { twoMin, tenMin } = buildDerivedCandles(oneMinCandles);
        if (twoMin.length > 0) candleMap.set('2m', twoMin);
        if (tenMin.length > 0) candleMap.set('10m', tenMin);
      }

      // Load all candles into storage
      loadAllHistoricalCandles(candleMap);

      console.log('[PriceEngine] ✅ Historical data loaded - indicators ready!');

    } catch (error) {
      console.error('[PriceEngine] ⚠️ Failed to load historical data:', error);
      console.log('[PriceEngine] Continuing without historical data...');
    }
  }

  private async connect(): Promise<void> {
    this.wsConnection = new WSConnection({
      heliusApiKey: this.heliusApiKey,
      maxReconnectAttempts: 100, // Keep trying
      reconnectDelayMs: 3000,
    });

    const connected = await this.wsConnection.connect();

    if (!connected) {
      console.error('[PriceEngine] ❌ Failed to connect - retrying in 5s...');
      setTimeout(() => this.connect(), 5000);
      return;
    }

    // Create pool subscriber
    this.poolSubscriber = new PoolSubscriber(this.wsConnection);
    await this.poolSubscriber.subscribe();

    console.log('[PriceEngine] ✅ Running');
  }

  private setupPriceListener(): void {
    eventBus.on(EVENTS.PRICE_UPDATE, (update: PriceUpdate) => {
      this.stats.priceUpdates++;
      this.stats.lastPrice = update.price;
      this.stats.lastUpdateTime = update.timestamp;

      // Feed price into candle engine
      updatePrice(update.price, update.timestamp);
    });

    // Handle connection issues
    eventBus.on(EVENTS.CONNECTION_STATUS, ({ connected }) => {
      if (!connected && this.isRunning) {
        console.log('[PriceEngine] ⚠️ Disconnected - WSConnection will auto-reconnect');
      }
    });
  }

  stop(): void {
    console.log('[PriceEngine] Stopping...');
    this.isRunning = false;

    if (this.wsConnection) {
      this.wsConnection.disconnect();
      this.wsConnection = null;
    }

    this.poolSubscriber = null;
    eventBus.clear();
  }

  getCurrentPrice() {
    return {
      price: this.poolSubscriber?.getCurrentPrice() || 0,
      change30s: this.poolSubscriber?.getPriceChange30s() || 0,
      timestamp: Date.now(),
    };
  }

  getStatus() {
    const wsStats = this.wsConnection?.getStats() || { connected: false };
    const poolStats = this.poolSubscriber?.getStats() || {};

    return {
      running: this.isRunning,
      uptime: this.stats.startedAt ? Date.now() - this.stats.startedAt : 0,
      connected: wsStats.connected,
      websocket: {
        connected: wsStats.connected,
        messagesReceived: wsStats.messagesReceived || 0,
        reconnects: wsStats.reconnects || 0,
        errors: wsStats.errors || 0,
      },
      pool: {
        updatesReceived: poolStats.updatesReceived || 0,
        priceChanges: poolStats.priceChanges || 0,
        avgLatency: Math.round(poolStats.avgLatency || 0),
      },
      price: {
        current: this.stats.lastPrice,
        change30s: poolStats.priceChange30s || 0,
        lastUpdateAgo: this.stats.lastUpdateTime ? Date.now() - this.stats.lastUpdateTime : 0,
      },
    };
  }

  isConnected(): boolean {
    return this.wsConnection?.isConnected() || false;
  }
}

// Singleton
let engineInstance: PriceEngine | null = null;

export function getPriceEngine(): PriceEngine | null {
  return engineInstance;
}

export function createPriceEngine(heliusApiKey: string): PriceEngine {
  if (engineInstance) {
    return engineInstance;
  }
  engineInstance = new PriceEngine(heliusApiKey);
  return engineInstance;
}

export function destroyPriceEngine(): void {
  if (engineInstance) {
    engineInstance.stop();
    engineInstance = null;
  }
}