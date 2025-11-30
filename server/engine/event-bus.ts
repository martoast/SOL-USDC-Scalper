// server/engine/event-bus.ts

/**
 * Simple event emitter for internal communication
 * Allows different parts of the engine to communicate
 */

type EventCallback = (...args: any[]) => void;

class EventBus {
  private events: Map<string, EventCallback[]> = new Map();

  on(event: string, callback: EventCallback): void {
    if (!this.events.has(event)) {
      this.events.set(event, []);
    }
    this.events.get(event)!.push(callback);
  }

  off(event: string, callback: EventCallback): void {
    const callbacks = this.events.get(event);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  emit(event: string, ...args: any[]): void {
    const callbacks = this.events.get(event);
    if (callbacks) {
      callbacks.forEach((cb) => {
        try {
          cb(...args);
        } catch (e) {
          console.error(`[EventBus] Error in ${event} handler:`, e);
        }
      });
    }
  }

  clear(): void {
    this.events.clear();
  }
}

// Singleton instance
export const eventBus = new EventBus();

// Event types
export interface PriceUpdate {
  price: number;
  timestamp: number;
  source: 'websocket' | 'fallback';
  latency?: number;
}

export interface SwapDetected {
  direction: 'BUY' | 'SELL';
  priceImpact: number;
  timestamp: number;
}

// Event names
export const EVENTS = {
  PRICE_UPDATE: 'price:update',
  SWAP_DETECTED: 'swap:detected',
  CANDLE_CLOSE: 'candle:close',
  CONNECTION_STATUS: 'connection:status',
  ENGINE_ERROR: 'engine:error',
} as const;