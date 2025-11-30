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

export class PoolSubscriber {
  private wsConnection: WSConnection;
  private lastPrice = 0;
  private lastUpdateTime = 0;
  private priceHistory: { price: number; time: number }[] = [];
  
  // Stats
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

  /**
   * Setup event listeners
   */
  private setupListeners(): void {
    // Listen for account updates from WebSocket
    eventBus.on('account:update', (data) => {
      this.handleAccountUpdate(data);
    });

    // Listen for connection status changes
    eventBus.on(EVENTS.CONNECTION_STATUS, ({ connected }) => {
      if (connected) {
        this.subscribe();
      }
    });
  }

  /**
   * Subscribe to pool account
   */
  async subscribe(): Promise<boolean> {
    console.log(`[PoolSubscriber] Subscribing to pool: ${SOL_USDC_POOL.slice(0, 8)}...`);
    return this.wsConnection.subscribeToAccount(SOL_USDC_POOL);
  }

  /**
   * Handle incoming account update
   */
  private handleAccountUpdate(update: { data: Buffer; slot: number; timestamp: number }): void {
    this.stats.updatesReceived++;
    const receiveTime = Date.now();

    // Parse pool data
    const poolState = parseClmmPool(update.data);
    
    if (!poolState) {
      this.stats.parseErrors++;
      return;
    }

    // Validate price
    if (!validatePrice(poolState.price)) {
      console.warn(`[PoolSubscriber] Invalid price: ${poolState.price}`);
      return;
    }

    // Calculate latency (time from slot to now is approximate)
    const latency = receiveTime - update.timestamp;

    // Check if price actually changed
    const priceChanged = this.lastPrice > 0 && 
      Math.abs(poolState.price - this.lastPrice) / this.lastPrice > 0.000001; // 0.0001% threshold

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

    // Update tracking
    this.lastPrice = poolState.price;
    this.lastUpdateTime = receiveTime;
    this.stats.lastPrice = poolState.price;
    this.stats.lastUpdateTime = receiveTime;
    
    // Track latency average
    this.stats.avgLatency = this.stats.avgLatency * 0.9 + latency * 0.1;

    // Track price history for 30s change calculation
    this.priceHistory.push({ price: poolState.price, time: receiveTime });
    this.priceHistory = this.priceHistory.filter(p => p.time > receiveTime - 30000);

    // Emit price update event
    const priceUpdate: PriceUpdate = {
      price: poolState.price,
      timestamp: receiveTime,
      source: 'websocket',
      latency,
    };

    eventBus.emit(EVENTS.PRICE_UPDATE, priceUpdate);
  }

  /**
   * Get 30-second price change
   */
  getPriceChange30s(): number {
    if (this.priceHistory.length < 2) return 0;
    
    const oldest = this.priceHistory[0];
    const newest = this.priceHistory[this.priceHistory.length - 1];
    
    return ((newest.price - oldest.price) / oldest.price) * 100;
  }

  /**
   * Get current price
   */
  getCurrentPrice(): number {
    return this.lastPrice;
  }

  /**
   * Get stats
   */
  getStats() {
    return {
      ...this.stats,
      priceChange30s: this.getPriceChange30s(),
      historyLength: this.priceHistory.length,
    };
  }
}