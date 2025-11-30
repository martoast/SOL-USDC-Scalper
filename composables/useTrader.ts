/**
 * SOL/USDC Scalper
 *
 * Simple momentum scalping strategy:
 * - Entry: +0.3% in 30s with volume
 * - Take Profit: +0.8%
 * - Stop Loss: -0.4%
 */

// composables/useTrader.ts

import { ref, computed } from 'vue';

// === TYPES ===
interface Position {
  entryPrice: number;
  entryTime: number;
  targetProfit: number; // +0.8%
  stopLoss: number; // -0.4%
  solAmount: number;
  usdAmount: number;
}

interface PriceData {
  price: number;
  change30s: number;
  volume30s: number;
  timestamp: number;
}

interface TradeLog {
  timestamp: number;
  type: 'ENTRY' | 'EXIT';
  price: number;
  pnl?: number;
  pnlPercent?: number;
  reason?: string;
}

interface Stats {
  totalTrades: number;
  wins: number;
  losses: number;
  totalPnL: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
}

// === STATE ===
const isAutoTrading = ref(false);
const currentPosition = ref<Position | null>(null);
const currentPrice = ref<PriceData>({
  price: 0,
  change30s: 0,
  volume30s: 0,
  timestamp: 0,
});

const streamConnected = ref(false);
const logs = ref<TradeLog[]>([]);
const stats = ref<Stats>({
  totalTrades: 0,
  wins: 0,
  losses: 0,
  totalPnL: 0,
  winRate: 0,
  avgWin: 0,
  avgLoss: 0,
});

// === SETTINGS ===
const ENTRY_THRESHOLD = 0.3; // +0.3% in 30s
const MIN_VOLUME_30S = 1000; // $1000 minimum volume
const TAKE_PROFIT_PERCENT = 0.8; // +0.8%
const STOP_LOSS_PERCENT = -0.4; // -0.4%
const POSITION_SIZE_SOL = 0.1; // Trade 0.1 SOL per position

// === TIMERS ===
let priceCheckTimer: ReturnType<typeof setInterval> | null = null;
let streamCheckTimer: ReturnType<typeof setInterval> | null = null;

// === COMPOSABLE ===
export function useTrader() {
  // === COMPUTED ===
  const hasPosition = computed(() => currentPosition.value !== null);

  const currentPnL = computed(() => {
    if (!currentPosition.value) return { usd: 0, percent: 0 };

    const pos = currentPosition.value;
    const currentValue = pos.solAmount * currentPrice.value.price;
    const pnlUsd = currentValue - pos.usdAmount;
    const pnlPercent = (pnlUsd / pos.usdAmount) * 100;

    return { usd: pnlUsd, percent: pnlPercent };
  });

  const statusText = computed(() => {
    if (!isAutoTrading.value) return 'Stopped';
    if (!streamConnected.value) return 'Stream Disconnected';
    if (hasPosition.value) return 'In Position';
    return 'Monitoring';
  });

  // === PRICE MONITORING ===
  const checkPrice = async () => {
    if (!isAutoTrading.value) return;

    try {
      const res = await fetch('/api/stream/status');
      const json = await res.json();

      if (json.success && json.data) {
        const { stream, price } = json.data;

        streamConnected.value = stream.connected;

        currentPrice.value = {
          price: price.current,
          change30s: price.change30s,
          volume30s: price.volume30s,
          timestamp: Date.now(),
        };

        // Check for entry or exit signals
        if (hasPosition.value) {
          checkExitSignal();
        } else {
          checkEntrySignal();
        }
      }
    } catch (e) {
      console.error('[Trader] Price check error:', e);
    }
  };

  // === ENTRY LOGIC ===
  const checkEntrySignal = () => {
    const { price, change30s, volume30s } = currentPrice.value;

    // Entry conditions:
    // 1. Price up +0.3% in 30s
    // 2. Volume > $1000 in 30s
    if (change30s >= ENTRY_THRESHOLD && volume30s >= MIN_VOLUME_30S) {
      enterPosition(price);
    }
  };

  const enterPosition = async (entryPrice: number) => {
    log(`🟢 ENTRY SIGNAL: Price +${currentPrice.value.change30s.toFixed(2)}% in 30s`, 'success');

    const usdAmount = POSITION_SIZE_SOL * entryPrice;

    currentPosition.value = {
      entryPrice,
      entryTime: Date.now(),
      targetProfit: entryPrice * (1 + TAKE_PROFIT_PERCENT / 100),
      stopLoss: entryPrice * (1 + STOP_LOSS_PERCENT / 100),
      solAmount: POSITION_SIZE_SOL,
      usdAmount,
    };

    // Execute trade via API
    try {
      await fetch('/api/trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'BUY',
          tokenAddress: 'So11111111111111111111111111111111111111112',
          solAmount: POSITION_SIZE_SOL,
        }),
      });

      logs.value.unshift({
        timestamp: Date.now(),
        type: 'ENTRY',
        price: entryPrice,
      });

      log(`💰 Position opened: ${POSITION_SIZE_SOL} SOL @ $${entryPrice.toFixed(2)}`, 'info');
      log(`🎯 Target: $${currentPosition.value.targetProfit.toFixed(2)} | Stop: $${currentPosition.value.stopLoss.toFixed(2)}`, 'info');
    } catch (e: any) {
      log(`❌ Entry failed: ${e.message}`, 'error');
      currentPosition.value = null;
    }
  };

  // === EXIT LOGIC ===
  const checkExitSignal = () => {
    if (!currentPosition.value) return;

    const pos = currentPosition.value;
    const price = currentPrice.value.price;

    // Check stop loss
    if (price <= pos.stopLoss) {
      exitPosition(price, 'STOP_LOSS');
      return;
    }

    // Check take profit
    if (price >= pos.targetProfit) {
      exitPosition(price, 'TAKE_PROFIT');
      return;
    }
  };

  const exitPosition = async (exitPrice: number, reason: 'TAKE_PROFIT' | 'STOP_LOSS') => {
    if (!currentPosition.value) return;

    const pos = currentPosition.value;
    const exitValue = pos.solAmount * exitPrice;
    const pnl = exitValue - pos.usdAmount;
    const pnlPercent = (pnl / pos.usdAmount) * 100;

    const emoji = pnl > 0 ? '🟢' : '🔴';
    log(`${emoji} EXIT (${reason}): ${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%`, pnl > 0 ? 'success' : 'error');

    // Execute sell via API
    try {
      await fetch('/api/trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'SELL',
          tokenAddress: 'So11111111111111111111111111111111111111112',
          solAmount: pos.solAmount,
        }),
      });

      // Update stats
      stats.value.totalTrades++;
      stats.value.totalPnL += pnl;

      if (pnl > 0) {
        stats.value.wins++;
        const totalWins = logs.value.filter(l => l.pnl && l.pnl > 0).length + 1;
        stats.value.avgWin = (stats.value.avgWin * (totalWins - 1) + pnl) / totalWins;
      } else {
        stats.value.losses++;
        const totalLosses = logs.value.filter(l => l.pnl && l.pnl < 0).length + 1;
        stats.value.avgLoss = (stats.value.avgLoss * (totalLosses - 1) + pnl) / totalLosses;
      }

      stats.value.winRate = stats.value.totalTrades > 0
        ? (stats.value.wins / stats.value.totalTrades) * 100
        : 0;

      logs.value.unshift({
        timestamp: Date.now(),
        type: 'EXIT',
        price: exitPrice,
        pnl,
        pnlPercent,
        reason,
      });

      log(`📊 Stats: ${stats.value.wins}W/${stats.value.losses}L | Win Rate: ${stats.value.winRate.toFixed(0)}% | Total: ${stats.value.totalPnL >= 0 ? '+' : ''}$${stats.value.totalPnL.toFixed(2)}`, 'info');
    } catch (e: any) {
      log(`❌ Exit failed: ${e.message}`, 'error');
    } finally {
      currentPosition.value = null;
    }
  };

  // === BOT CONTROL ===
  const startBot = async () => {
    if (isAutoTrading.value) {
      log('⚠️ Bot already running', 'warn');
      return;
    }

    isAutoTrading.value = true;

    log('🤖 SOL/USDC SCALPER STARTED', 'success');
    log(`📊 Strategy: Entry +${ENTRY_THRESHOLD}% | TP +${TAKE_PROFIT_PERCENT}% | SL ${STOP_LOSS_PERCENT}%`, 'info');

    // Check stream status
    await checkStreamStatus();

    // Price check every 500ms
    priceCheckTimer = setInterval(checkPrice, 500);

    // Stream status check every 10s
    streamCheckTimer = setInterval(checkStreamStatus, 10000);
  };

  const stopBot = () => {
    if (!isAutoTrading.value) return;

    isAutoTrading.value = false;

    if (priceCheckTimer) clearInterval(priceCheckTimer);
    if (streamCheckTimer) clearInterval(streamCheckTimer);

    priceCheckTimer = null;
    streamCheckTimer = null;

    log('🛑 SCALPER STOPPED', 'warn');

    if (currentPosition.value) {
      log('⚠️ Warning: Position still open!', 'warn');
    }
  };

  const checkStreamStatus = async () => {
    try {
      const res = await fetch('/api/stream/status');
      const json = await res.json();

      if (json.success && json.data) {
        streamConnected.value = json.data.stream.connected;

        if (!streamConnected.value) {
          log('⚠️ Stream disconnected - using fallback pricing', 'warn');
        }
      }
    } catch (e) {
      streamConnected.value = false;
    }
  };

  // === LOGGING ===
  const consoleLogs = ref<Array<{ message: string; type: string; time: number }>>([]);

  const log = (message: string, type: 'info' | 'success' | 'warn' | 'error' | 'stream' = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    consoleLogs.value.unshift({
      message: `[${timestamp}] ${message}`,
      type,
      time: Date.now(),
    });

    // Keep last 100 logs
    if (consoleLogs.value.length > 100) {
      consoleLogs.value = consoleLogs.value.slice(0, 100);
    }

    console.log(`[Trader] ${message}`);
  };

  // === MANUAL CLOSE ===
  const closePosition = async () => {
    if (!currentPosition.value) return;

    await exitPosition(currentPrice.value.price, 'STOP_LOSS');
  };

  return {
    // State
    isAutoTrading,
    currentPosition,
    currentPrice,
    streamConnected,
    hasPosition,
    currentPnL,
    statusText,
    logs,
    consoleLogs,
    stats,

    // Controls
    startBot,
    stopBot,
    closePosition,
    checkStreamStatus,
  };
}
