// server/engine/pool-subscriber.ts

/**
 * Pool Subscriber
 * 
 * Subscribes to SOL/USDC pool account changes
 * Parses updates and emits price events
 */

import { WSConnection } from './ws-connection';
import { parseClmmPool, validatePrice, SOL_USDC_POOL } from './raydium-clmm-parser';
import { eventBus, EVENTS, type PriceUpdate } from './event-bus';

// Constants
const MAX_PRICE_HISTORY = 100; // Only keep 100 price points for 30s calc

export class PoolSubscriber {
  private wsConnection: WSConnection;
  private lastPrice = 0;
  private lastUpdateTime = 0;
  private priceHistory: { price: number; time: number }[] = [];
  
  private stats = {
    updatesReceived: 0,
    priceChanges: 0,
    parseErrors: 0,
    lastPrice: 0,
    lastUpdateTime: 0,
    avgLatency: 0,
  };

  constructor(wsConnection: WSConnection) {
    this.wsConnection = wsConnection;
    this.setupListeners();
  }

  private setupListeners(): void {
    eventBus.on('account:update', (data) => {
      this.handleAccountUpdate(data);
    });

    eventBus.on(EVENTS.CONNECTION_STATUS, ({ connected }) => {
      if (connected) {
        this.subscribe();
      }
    });
  }

  async subscribe(): Promise<boolean> {
    console.log(`[PoolSubscriber] Subscribing to pool: ${SOL_USDC_POOL.slice(0, 8)}...`);
    return this.wsConnection.subscribeToAccount(SOL_USDC_POOL);
  }

  private handleAccountUpdate(update: { data: Buffer; slot: number; timestamp: number }): void {
    this.stats.updatesReceived++;
    const receiveTime = Date.now();

    const poolState = parseClmmPool(update.data);
    
    if (!poolState) {
      this.stats.parseErrors++;
      return;
    }

    if (!validatePrice(poolState.price)) {
      console.warn(`[PoolSubscriber] Invalid price: ${poolState.price}`);
      return;
    }

    const latency = receiveTime - update.timestamp;

    const priceChanged = this.lastPrice > 0 && 
      Math.abs(poolState.price - this.lastPrice) / this.lastPrice > 0.000001;

    if (priceChanged) {
      this.stats.priceChanges++;
      
      const priceChangePercent = ((poolState.price - this.lastPrice) / this.lastPrice) * 100;
      const direction = poolState.price > this.lastPrice ? '📈' : '📉';
      
      console.log(
        `[PoolSubscriber] ${direction} $${poolState.price.toFixed(4)} | ` +
        `Δ${priceChangePercent >= 0 ? '+' : ''}${priceChangePercent.toFixed(4)}% | ` +
        `${latency}ms`
      );
    }

    this.lastPrice = poolState.price;
    this.lastUpdateTime = receiveTime;
    this.stats.lastPrice = poolState.price;
    this.stats.lastUpdateTime = receiveTime;
    this.stats.avgLatency = this.stats.avgLatency * 0.9 + latency * 0.1;

    // Track price history - WITH TRIMMING
    const now = receiveTime;
    this.priceHistory.push({ price: poolState.price, time: now });
    
    // Remove old entries (older than 60 seconds)
    const cutoff = now - 60000;
    this.priceHistory = this.priceHistory.filter(p => p.time > cutoff);
    
    // Also enforce max length as safety
    if (this.priceHistory.length > MAX_PRICE_HISTORY) {
      this.priceHistory = this.priceHistory.slice(-MAX_PRICE_HISTORY);
    }

    const priceUpdate: PriceUpdate = {
      price: poolState.price,
      timestamp: receiveTime,
      source: 'websocket',
      latency,
    };

    eventBus.emit(EVENTS.PRICE_UPDATE, priceUpdate);
  }

  getPriceChange30s(): number {
    if (this.priceHistory.length < 2) return 0;
    
    const now = Date.now();
    const thirtySecondsAgo = now - 30000;
    
    // Find oldest price within 30s window
    const oldPrices = this.priceHistory.filter(p => p.time <= thirtySecondsAgo + 5000);
    if (oldPrices.length === 0) {
      // Use oldest available
      const oldest = this.priceHistory[0];
      const newest = this.priceHistory[this.priceHistory.length - 1];
      return ((newest.price - oldest.price) / oldest.price) * 100;
    }
    
    const oldest = oldPrices[oldPrices.length - 1];
    const newest = this.priceHistory[this.priceHistory.length - 1];
    
    return ((newest.price - oldest.price) / oldest.price) * 100;
  }

  getCurrentPrice(): number {
    return this.lastPrice;
  }

  getStats() {
    return {
      ...this.stats,
      priceChange30s: this.getPriceChange30s(),
      historyLength: this.priceHistory.length,
    };
  }
}