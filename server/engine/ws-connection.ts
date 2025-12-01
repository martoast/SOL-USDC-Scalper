// server/engine/ws-connection.ts

/**
 * Helius WebSocket Connection Manager
 * 
 * Maintains persistent WebSocket connection to Helius
 * Handles reconnection, heartbeat, cleanup, and message routing
 * 
 * Designed for 24/7 operation
 */

import WebSocket from 'ws';
import { eventBus, EVENTS } from './event-bus';

export interface WSConnectionConfig {
  heliusApiKey: string;
  maxReconnectAttempts?: number;
  reconnectDelayMs?: number;
  heartbeatIntervalMs?: number;
}

export class WSConnection {
  private ws: WebSocket | null = null;
  private config: Required<WSConnectionConfig>;
  private reconnectAttempts = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private isConnecting = false;
  private shouldReconnect = true;
  private subscriptionId: number | null = null;
  private messageId = 1;
  private pendingRequests: Map<number, (result: any) => void> = new Map();

  // Stats
  private stats = {
    connected: false,
    lastMessageAt: 0,
    messagesReceived: 0,
    reconnects: 0,
    errors: 0,
    startedAt: 0,
  };

  constructor(config: WSConnectionConfig) {
    this.config = {
      heliusApiKey: config.heliusApiKey,
      maxReconnectAttempts: config.maxReconnectAttempts ?? 100,
      reconnectDelayMs: config.reconnectDelayMs ?? 5000,
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? 30000,
    };
  }

  /**
   * Connect to Helius WebSocket
   */
  async connect(): Promise<boolean> {
    if (this.isConnecting || this.ws?.readyState === WebSocket.OPEN) {
      console.log('[WSConnection] Already connected or connecting');
      return true;
    }

    this.isConnecting = true;
    this.shouldReconnect = true;
    this.stats.startedAt = Date.now();

    return new Promise((resolve) => {
      try {
        const url = `wss://mainnet.helius-rpc.com/?api-key=${this.config.heliusApiKey}`;
        
        console.log('[WSConnection] Connecting to Helius WebSocket...');
        
        this.ws = new WebSocket(url);

        this.ws.on('open', () => {
          console.log('[WSConnection] ✅ Connected to Helius WebSocket');
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          this.stats.connected = true;
          this.startHeartbeat();
          this.startCleanup();
          eventBus.emit(EVENTS.CONNECTION_STATUS, { connected: true });
          resolve(true);
        });

        this.ws.on('message', (data) => {
          this.handleMessage(data);
        });

        this.ws.on('close', (code, reason) => {
          console.log(`[WSConnection] Disconnected: ${code} - ${reason || 'No reason'}`);
          this.handleDisconnect();
        });

        this.ws.on('error', (error) => {
          console.error('[WSConnection] WebSocket error:', error.message);
          this.stats.errors++;
          this.isConnecting = false;
          eventBus.emit(EVENTS.ENGINE_ERROR, { type: 'websocket', error });
          resolve(false);
        });

        // Timeout for connection
        setTimeout(() => {
          if (this.isConnecting) {
            console.error('[WSConnection] Connection timeout');
            this.ws?.close();
            this.isConnecting = false;
            resolve(false);
          }
        }, 10000);

      } catch (e: any) {
        console.error('[WSConnection] Connection error:', e.message);
        this.isConnecting = false;
        resolve(false);
      }
    });
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect(): void {
    console.log('[WSConnection] Disconnecting...');
    this.shouldReconnect = false;
    this.stopHeartbeat();
    this.stopCleanup();
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.stats.connected = false;
    this.subscriptionId = null;
    this.pendingRequests.clear();
    eventBus.emit(EVENTS.CONNECTION_STATUS, { connected: false });
  }

  /**
   * Subscribe to account changes
   */
  async subscribeToAccount(address: string): Promise<boolean> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('[WSConnection] Cannot subscribe - not connected');
      return false;
    }

    const id = this.messageId++;

    const request = {
      jsonrpc: '2.0',
      id,
      method: 'accountSubscribe',
      params: [
        address,
        {
          encoding: 'base64',
          commitment: 'processed', // Fastest confirmation level
        },
      ],
    };

    return new Promise((resolve) => {
      // Timeout for subscription
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        console.error('[WSConnection] Subscribe timeout');
        resolve(false);
      }, 10000);

      this.pendingRequests.set(id, (result) => {
        clearTimeout(timeout);
        if (result.error) {
          console.error('[WSConnection] Subscribe error:', result.error);
          resolve(false);
        } else {
          this.subscriptionId = result;
          console.log(`[WSConnection] ✅ Subscribed to ${address.slice(0, 8)}... (sub ID: ${result})`);
          resolve(true);
        }
      });

      this.ws!.send(JSON.stringify(request));
    });
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString());
      this.stats.lastMessageAt = Date.now();
      this.stats.messagesReceived++;

      // Response to a request (subscribe confirmation)
      if (message.id && this.pendingRequests.has(message.id)) {
        const callback = this.pendingRequests.get(message.id)!;
        this.pendingRequests.delete(message.id);
        callback(message.result ?? { error: message.error });
        return;
      }

      // Subscription notification (account update)
      if (message.method === 'accountNotification') {
        const accountData = message.params?.result?.value?.data;
        if (accountData && Array.isArray(accountData) && accountData[0]) {
          // Emit raw account data for parsing
          eventBus.emit('account:update', {
            data: Buffer.from(accountData[0], 'base64'),
            slot: message.params?.result?.context?.slot,
            timestamp: Date.now(),
          });
        }
      }

    } catch (e: any) {
      console.error('[WSConnection] Message parse error:', e.message);
    }
  }

  /**
   * Handle disconnect and attempt reconnection
   */
  private handleDisconnect(): void {
    this.stats.connected = false;
    this.stopHeartbeat();
    this.stopCleanup();
    this.subscriptionId = null;
    eventBus.emit(EVENTS.CONNECTION_STATUS, { connected: false });

    if (this.shouldReconnect && this.reconnectAttempts < this.config.maxReconnectAttempts) {
      this.reconnectAttempts++;
      this.stats.reconnects++;
      
      // Exponential backoff with max of 30 seconds
      const delay = Math.min(
        this.config.reconnectDelayMs * Math.pow(1.5, this.reconnectAttempts - 1),
        30000
      );
      
      console.log(`[WSConnection] Reconnecting in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts})...`);

      this.reconnectTimer = setTimeout(() => {
        this.connect();
      }, delay);
    } else if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.error('[WSConnection] Max reconnect attempts reached - giving up');
      eventBus.emit(EVENTS.ENGINE_ERROR, { type: 'max_reconnects' });
    }
  }

  /**
   * Send periodic heartbeat to keep connection alive
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        const id = this.messageId++;
        
        // Send getHealth as heartbeat
        this.ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id,
          method: 'getHealth',
        }));

        // Clean up this request after 5 seconds if no response
        setTimeout(() => {
          this.pendingRequests.delete(id);
        }, 5000);
      }
    }, this.config.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Periodic cleanup of stale pending requests
   */
  private startCleanup(): void {
    this.stopCleanup();
    
    // Every 5 minutes, clean up old pending requests
    this.cleanupTimer = setInterval(() => {
      if (this.pendingRequests.size > 50) {
        console.warn(`[WSConnection] Clearing ${this.pendingRequests.size} stale pending requests`);
        this.pendingRequests.clear();
      }
    }, 5 * 60 * 1000);
  }

  private stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Get connection stats
   */
  getStats() {
    return {
      ...this.stats,
      uptime: this.stats.startedAt ? Date.now() - this.stats.startedAt : 0,
      subscriptionActive: this.subscriptionId !== null,
      pendingRequests: this.pendingRequests.size,
    };
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.stats.connected;
  }
}