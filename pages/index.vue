<!-- pages/index.vue -->
<script setup lang="ts">
/**
 * SOL/USDC Scalper - Long & Short Trading
 * Real-time WebSocket price engine with trend detection
 */

import { Buffer } from 'buffer';
if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = Buffer;
}

import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { initWallet } from 'solana-wallets-vue';
import 'solana-wallets-vue/styles.css';

initWallet({
  wallets: [new PhantomWalletAdapter()],
  autoConnect: true,
});

import { ref, computed, onMounted, onUnmounted } from 'vue';

// === TYPES ===
interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trades: number;
  timestamp: number;
}

interface Position {
  id: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  entryTime: number;
  targetProfit: number;
  stopLoss: number;
  solAmount: number;
  usdAmount: number;
}

interface TradeLog {
  id: string;
  timestamp: number;
  type: 'ENTRY' | 'EXIT';
  direction: 'LONG' | 'SHORT';
  price: number;
  pnl?: number;
  pnlPercent?: number;
  reason?: string;
}

interface StrategySignal {
  // Tradability gate status
  tradability: {
    isTradable: boolean;
    reason: string | null;
    checks: {
      volatility: { passed: boolean; value: number | null };
      trendStrength: { passed: boolean; value: number | null };
      rangeCompression: { passed: boolean; value: number | null };
    };
  };
  // Throttle status
  throttle: {
    canTrade: boolean;
    reason: string | null;
    cooldownRemaining: number;
    tradesThisHour: number;
    maxTradesPerHour: number;
    consecutiveLosses: number;
  };
  // Entry confirmation status
  entryConfirmation: {
    confirmed: boolean;
    reason: string | null;
    checks: {
      rangeCheck: { passed: boolean };
      momentumCheck: { passed: boolean };
      exhaustionCheck: { passed: boolean };
    };
  } | null;
  regime: {
    regime: string;
    confidence: number;
    recommendation: string;
  };
  entry: {
    shouldEnter: boolean;
    direction: 'LONG' | 'SHORT' | 'NONE';
    confidence: number;
    score: number;
    suggestedStopLoss: number;
    suggestedTakeProfit: number;
    reasons: string[];
    warnings: string[];
  };
  exit: {
    shouldExit: boolean;
    reason: string;
    urgency: string;
    trailingStopPrice: number | null;
    currentPnLPercent: number;
    explanation: string;
  } | null;
}

// === STATE ===
const isAutoTrading = ref(false);
const currentPosition = ref<Position | null>(null);
const streamConnected = ref(false);
const streamMode = ref<'websocket' | 'fallback'>('websocket');
const avgLatency = ref(0);
const detectedTrend = ref<'BULLISH' | 'BEARISH' | 'NEUTRAL'>('NEUTRAL');

// Frontend trend hysteresis (prevent flickering)
let confirmedTrend: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
let pendingTrend: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
let pendingTrendCount = 0;
const TREND_STABILITY_REQUIRED = 3; // Need 3 consecutive signals to switch

// Strategy state
const strategySignal = ref<StrategySignal | null>(null);

const priceData = ref({
  current: 0,
  change30s: 0,
  volume30s: 0,
});

const candleData = ref<{
  stats: { totalCandles: number; totalTrades: number };
  priceChanges: Record<string, number>;
  current: Record<string, Candle | null>;
}>({
  stats: { totalCandles: 0, totalTrades: 0 },
  priceChanges: {},
  current: {},
});

const streamStats = ref({
  uptime: 0,
  websocket: { connected: false, messagesReceived: 0, reconnects: 0 },
  pool: { updatesReceived: 0, priceChanges: 0, avgLatency: 0 },
});

const tradeLogs = ref<TradeLog[]>([]);
const consoleLogs = ref<Array<{ message: string; type: string; time: number }>>([]);

const stats = ref({
  totalTrades: 0,
  wins: 0,
  losses: 0,
  totalPnL: 0, // Net (after fees)
  totalGrossPnL: 0, // Before fees
  totalFees: 0,
  winRate: 0,
  profitFactor: 0,
  longs: 0,
  shorts: 0,
  longWinRate: 0,
  shortWinRate: 0,
  longPnL: 0,
  shortPnL: 0,
});

const costModel = ref({
  dexFeePercent: 0.25,
  roundTripCostPercent: 0.6,
  breakEvenMovePercent: 0.6,
});

// === SETTINGS ===
// NOTE: With realistic fees (~0.6% round-trip), TP must be > 1% to profit!
const settings = ref({
  // Entry settings
  trendThreshold: 0.3, // % change to detect trend (higher = fewer trades)
  trendTimeframe: '1m' as string,

  // Exit settings - REALISTIC for fees!
  // Round-trip fees are ~0.6%, so TP must be > 1% to profit
  takeProfitPercent: 1.5, // 1.5% TP (leaves ~0.9% after fees)
  stopLossPercent: 0.8, // 0.8% SL (reasonable risk:reward)
  positionSizeSol: 0.1,

  // Mode
  testMode: false, // Start in real mode to see realistic results
  testEntryChance: 15,
  testExitAfterSeconds: 15,

  // Strategy
  allowLongs: true,
  allowShorts: true,

  // Smart Strategy Mode
  smartMode: true, // Use AI-powered signals by default
  minConfidence: 25, // Minimum confidence to enter (aggressive for testing)
});

const showSettings = ref(false);
const activeTab = ref<'candles' | 'trades' | 'logs'>('candles');
const activeTimeframe = ref('1m');

// === TIMERS ===
let dataTimer: ReturnType<typeof setInterval> | null = null;
let tradingTimer: ReturnType<typeof setInterval> | null = null;

// === COMPUTED ===
const hasPosition = computed(() => currentPosition.value !== null);

const currentPnL = computed(() => {
  if (!currentPosition.value) return { usd: 0, percent: 0 };
  
  const pos = currentPosition.value;
  const currentPrice = priceData.value.current;
  
  let pnlUsd: number;
  let pnlPercent: number;
  
  if (pos.direction === 'LONG') {
    // LONG: profit when price goes UP
    pnlUsd = (currentPrice - pos.entryPrice) * pos.solAmount;
    pnlPercent = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
  } else {
    // SHORT: profit when price goes DOWN
    pnlUsd = (pos.entryPrice - currentPrice) * pos.solAmount;
    pnlPercent = ((pos.entryPrice - currentPrice) / pos.entryPrice) * 100;
  }
  
  return { usd: pnlUsd, percent: pnlPercent };
});

const statusText = computed(() => {
  if (!isAutoTrading.value) return 'Stopped';
  if (!streamConnected.value) return 'Disconnected';
  if (hasPosition.value) {
    return currentPosition.value?.direction === 'LONG' ? 'LONG 📈' : 'SHORT 📉';
  }
  return 'Monitoring';
});

const statusClass = computed(() => {
  if (statusText.value.includes('LONG')) return 'text-green-400';
  if (statusText.value.includes('SHORT')) return 'text-red-400';
  if (statusText.value === 'Monitoring') return 'text-blue-400';
  if (statusText.value === 'Disconnected') return 'text-yellow-400';
  return 'text-gray-400';
});

const trendClass = computed(() => {
  if (detectedTrend.value === 'BULLISH') return 'text-green-400';
  if (detectedTrend.value === 'BEARISH') return 'text-red-400';
  return 'text-gray-400';
});

const trendEmoji = computed(() => {
  if (detectedTrend.value === 'BULLISH') return '📈';
  if (detectedTrend.value === 'BEARISH') return '📉';
  return '➡️';
});

const currentCandle = computed(() => {
  return candleData.value.current[activeTimeframe.value] || null;
});

const timeframes = ['1s', '1m', '2m', '5m', '10m', '30m', '1h'];

// === TREND DETECTION ===
const detectTrend = (): 'BULLISH' | 'BEARISH' | 'NEUTRAL' => {
  const { trendThreshold, trendTimeframe } = settings.value;
  const priceChange = candleData.value.priceChanges[trendTimeframe] || 0;

  if (priceChange >= trendThreshold) {
    return 'BULLISH';
  } else if (priceChange <= -trendThreshold) {
    return 'BEARISH';
  }
  return 'NEUTRAL';
};

// Set trend with hysteresis to prevent flickering
const setTrendWithHysteresis = (rawTrend: 'BULLISH' | 'BEARISH' | 'NEUTRAL') => {
  // Same as confirmed - stay stable
  if (rawTrend === confirmedTrend) {
    pendingTrend = rawTrend;
    pendingTrendCount = 0;
    return; // No change needed
  }

  // Different trend - track it
  if (rawTrend === pendingTrend) {
    pendingTrendCount++;
    if (pendingTrendCount >= TREND_STABILITY_REQUIRED) {
      // Seen new trend enough times - switch
      confirmedTrend = rawTrend;
      pendingTrendCount = 0;
      detectedTrend.value = rawTrend;
    }
    // else: not stable enough, keep current detectedTrend
  } else {
    // New pending trend - start fresh
    pendingTrend = rawTrend;
    pendingTrendCount = 1;
    // Keep current detectedTrend
  }
};

// === DATA FETCHING ===
const fetchData = async () => {
  try {
    const res = await fetch('/api/stream/status');
    const json = await res.json();

    if (json.success && json.data) {
      streamConnected.value = json.data.stream.connected;
      streamMode.value = json.data.stream.mode || 'websocket';
      avgLatency.value = json.data.price.avgLatency || 0;

      streamStats.value = {
        uptime: json.data.stream.uptime,
        websocket: json.data.stream.websocket || {},
        pool: json.data.stream.pool || {},
      };

      priceData.value = {
        current: json.data.price.current,
        change30s: json.data.price.change30s,
        volume30s: 0,
      };

      if (json.data.candles) {
        candleData.value = json.data.candles;
      }

      // Update trend detection (only if we have candle data)
      if (candleData.value.stats.totalCandles > 0) {
        if (settings.value.smartMode) {
          fetchStrategy();
        } else {
          setTrendWithHysteresis(detectTrend());
        }
      }
    }
  } catch (e) {
    console.error('Fetch error:', e);
  }
};

const fetchStrategy = async () => {
  try {
    const body: any = {};

    // If we have a position, send it for exit signal calculation
    if (currentPosition.value) {
      body.activePosition = {
        direction: currentPosition.value.direction,
        entryPrice: currentPosition.value.entryPrice,
        entryTime: currentPosition.value.entryTime,
        size: currentPosition.value.solAmount,
        initialStopLoss: currentPosition.value.stopLoss,
        currentStopLoss: currentPosition.value.stopLoss,
        takeProfit: currentPosition.value.targetProfit,
        maxPrice: Math.max(currentPosition.value.entryPrice, priceData.value.current),
        minPrice: Math.min(currentPosition.value.entryPrice, priceData.value.current),
        maxPnLPercent: Math.max(0, currentPnL.value.percent),
      };
    }

    const res = await fetch('/api/strategy?timeframe=' + settings.value.trendTimeframe, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const json = await res.json();

    if (json.success && json.data) {
      strategySignal.value = json.data;

      // Update trend based on composite SCORE (not just regime)
      // This way we show directional bias even in ranging markets
      // Score > 10 = bullish bias, Score < -10 = bearish bias
      let rawTrend: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
      const score = json.data.entry.score;

      if (score >= 10) {
        rawTrend = 'BULLISH';
      } else if (score <= -10) {
        rawTrend = 'BEARISH';
      }
      // else: score between -10 and 10 = NEUTRAL (no clear bias)

      setTrendWithHysteresis(rawTrend);
    }
    // Don't log "insufficient data" errors - that's normal during startup
  } catch (e: any) {
    log(`❌ Strategy fetch error: ${e.message}`, 'error');
  }
};

const fetchPortfolio = async () => {
  try {
    const res = await fetch('/api/portfolio');
    const json = await res.json();

    if (json.success) {
      stats.value = {
        totalTrades: json.stats.totalTrades,
        wins: json.stats.wins,
        losses: json.stats.losses,
        totalPnL: json.stats.totalPnL, // Net (after fees)
        totalGrossPnL: json.stats.totalGrossPnL || json.stats.totalPnL,
        totalFees: json.stats.totalFees || 0,
        winRate: json.stats.winRate,
        profitFactor: json.stats.profitFactor || 0,
        longs: json.stats.longs || 0,
        shorts: json.stats.shorts || 0,
        longWinRate: json.stats.longWinRate || 0,
        shortWinRate: json.stats.shortWinRate || 0,
        longPnL: json.stats.longPnL || 0,
        shortPnL: json.stats.shortPnL || 0,
      };

      // Update cost model info
      if (json.costModel) {
        costModel.value = json.costModel;
      }

      if (json.activeTrades && json.activeTrades.length > 0) {
        const active = json.activeTrades[0];
        currentPosition.value = {
          id: active.id,
          direction: active.direction || 'LONG',
          entryPrice: active.entryPrice,
          entryTime: active.timestamp,
          targetProfit: active.direction === 'LONG'
            ? active.entryPrice * (1 + settings.value.takeProfitPercent / 100)
            : active.entryPrice * (1 - settings.value.takeProfitPercent / 100),
          stopLoss: active.direction === 'LONG'
            ? active.entryPrice * (1 - settings.value.stopLossPercent / 100)
            : active.entryPrice * (1 + settings.value.stopLossPercent / 100),
          solAmount: active.size || active.amount / active.entryPrice,
          usdAmount: active.amount,
        };
      } else {
        currentPosition.value = null;
      }

      if (json.history) {
        tradeLogs.value = json.history.slice(0, 50).map((t: any) => ({
          id: t.id,
          timestamp: t.closedAt || t.timestamp,
          type: 'EXIT' as const,
          direction: t.direction || 'LONG',
          price: t.exitPrice || t.entryPrice,
          pnl: t.pnl,
          pnlPercent: t.pnlPercent,
          reason: t.exitReason,
        }));
      }
    }
  } catch (e) {
    console.error('Portfolio fetch error:', e);
  }
};

// === TRADING LOGIC ===
const checkTradeSignals = async () => {
  if (!isAutoTrading.value) {
    return;
  }
  if (!streamConnected.value) {
    return;
  }
  if (priceData.value.current <= 0) {
    return;
  }

  // Fetch strategy signals if in smart mode
  if (settings.value.smartMode && !settings.value.testMode) {
    await fetchStrategy();
  } else {
    // Update trend with simple detection (with hysteresis)
    setTrendWithHysteresis(detectTrend());
  }

  if (hasPosition.value) {
    checkExitSignal();
  } else {
    checkEntrySignal();
  }
};

const checkEntrySignal = () => {
  const { testMode, testEntryChance, allowLongs, allowShorts, smartMode, minConfidence } = settings.value;

  // Debug: Log what mode we're in
  if (!strategySignal.value && smartMode && !testMode) {
    // Log once every 5 seconds if no signal
    if (Date.now() % 5000 < 1000) {
      log(`⏳ Waiting for strategy signal...`, 'info');
    }
  }

  if (testMode) {
    // Random entry for testing
    const roll = Math.random() * 100;
    if (roll < testEntryChance) {
      // Random direction based on current trend or 50/50
      let direction: 'LONG' | 'SHORT';

      if (detectedTrend.value === 'BULLISH' && allowLongs) {
        direction = 'LONG';
      } else if (detectedTrend.value === 'BEARISH' && allowShorts) {
        direction = 'SHORT';
      } else {
        // Random if neutral or restricted
        const randomDir = Math.random() > 0.5;
        if (randomDir && allowLongs) {
          direction = 'LONG';
        } else if (!randomDir && allowShorts) {
          direction = 'SHORT';
        } else if (allowLongs) {
          direction = 'LONG';
        } else if (allowShorts) {
          direction = 'SHORT';
        } else {
          return; // Neither allowed
        }
      }

      log(`🎲 Test: ${direction} entry (trend: ${detectedTrend.value})`, 'info');
      enterPosition(direction);
    }
    return;
  }

  // === SMART MODE: Use strategy signals ===
  if (smartMode && strategySignal.value) {
    const signal = strategySignal.value;
    const entry = signal.entry;

    // Log signal status every 10 seconds
    if (Date.now() % 10000 < 1000) {
      log(`📊 Signal: ${entry.direction} | Score: ${entry.score.toFixed(1)} | Conf: ${entry.confidence.toFixed(0)}% | Enter: ${entry.shouldEnter}`, 'info');
    }

    // Check if we have a valid entry signal
    if (!entry.shouldEnter || entry.direction === 'NONE') {
      return;
    }

    // Check confidence threshold
    if (entry.confidence < minConfidence) {
      log(`⚠️ Confidence ${entry.confidence.toFixed(0)}% below ${minConfidence}%`, 'warn');
      return;
    }

    // Check direction is allowed
    if (entry.direction === 'LONG' && !allowLongs) {
      log(`❌ LONG blocked - longs disabled`, 'warn');
      return;
    }
    if (entry.direction === 'SHORT' && !allowShorts) {
      log(`❌ SHORT blocked - shorts disabled`, 'warn');
      return;
    }

    // Log the smart entry
    const regime = signal.regime.regime;
    const score = entry.score.toFixed(0);
    const conf = entry.confidence.toFixed(0);
    log(`🚀 ENTERING ${entry.direction}: Score ${score}, Conf ${conf}%, Regime: ${regime}`, 'success');

    if (entry.reasons.length > 0) {
      log(`   Reasons: ${entry.reasons.slice(0, 2).join(', ')}`, 'info');
    }

    // Enter with strategy-suggested levels
    enterPositionSmart(entry.direction, entry.suggestedStopLoss, entry.suggestedTakeProfit);
    return;
  }

  // === SIMPLE MODE: Follow the trend ===
  if (detectedTrend.value === 'BULLISH' && allowLongs) {
    log(`📈 Bullish trend detected - entering LONG`, 'info');
    enterPosition('LONG');
  } else if (detectedTrend.value === 'BEARISH' && allowShorts) {
    log(`📉 Bearish trend detected - entering SHORT`, 'info');
    enterPosition('SHORT');
  }
};

const checkExitSignal = () => {
  if (!currentPosition.value) return;

  const { takeProfitPercent, stopLossPercent, testMode, testExitAfterSeconds, smartMode } = settings.value;
  const pnlPercent = currentPnL.value.percent;
  const holdTime = (Date.now() - currentPosition.value.entryTime) / 1000;

  // Test mode: auto-exit after time
  if (testMode && holdTime >= testExitAfterSeconds) {
    const reason = pnlPercent >= 0 ? 'TEST_TP' : 'TEST_SL';
    log(`🎲 Test: Auto-exit after ${holdTime.toFixed(1)}s`, 'info');
    exitPosition(reason);
    return;
  }

  // === SMART MODE: Use strategy exit signals ===
  if (smartMode && strategySignal.value?.exit) {
    const exit = strategySignal.value.exit;

    if (exit.shouldExit) {
      const urgencyEmoji = exit.urgency === 'critical' ? '🚨' : exit.urgency === 'high' ? '⚠️' : '📊';
      log(`${urgencyEmoji} SMART EXIT: ${exit.reason} (${exit.urgency})`, 'info');
      log(`   ${exit.explanation}`, 'info');

      // Show trailing stop info if active
      if (exit.trailingStopPrice) {
        log(`   Trailing stop was at: $${exit.trailingStopPrice.toFixed(4)}`, 'info');
      }

      exitPosition(exit.reason);
      return;
    }

    // If smart mode but no exit signal, still check basic stops as safety
    // (Strategy already checked these, but double-check for safety)
  }

  // === BASIC EXIT CHECKS (always run as safety net) ===

  // Take profit
  if (pnlPercent >= takeProfitPercent) {
    exitPosition('TAKE_PROFIT');
    return;
  }

  // Stop loss
  if (pnlPercent <= -stopLossPercent) {
    exitPosition('STOP_LOSS');
    return;
  }
};

const enterPosition = async (direction: 'LONG' | 'SHORT') => {
  const price = priceData.value.current;
  if (price <= 0) return;

  const { positionSizeSol, takeProfitPercent, stopLossPercent } = settings.value;
  const usdAmount = positionSizeSol * price;

  try {
    const res = await fetch('/api/trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'OPEN',
        trade: {
          symbol: 'SOL/USDC',
          address: 'SOL',
          direction,
          entryPrice: price,
          amount: usdAmount,
          size: positionSizeSol,
          timestamp: Date.now(),
          // Phase 5: Pass signal data for diagnostics
          signalScore: 0,
          signalConfidence: 0,
          stopLossPercent,
          takeProfitPercent,
        },
      }),
    });

    const json = await res.json();

    if (json.success) {
      const tp = direction === 'LONG'
        ? price * (1 + takeProfitPercent / 100)
        : price * (1 - takeProfitPercent / 100);
      const sl = direction === 'LONG'
        ? price * (1 - stopLossPercent / 100)
        : price * (1 + stopLossPercent / 100);

      currentPosition.value = {
        id: json.trade.id,
        direction,
        entryPrice: price,
        entryTime: Date.now(),
        targetProfit: tp,
        stopLoss: sl,
        solAmount: positionSizeSol,
        usdAmount,
      };

      const emoji = direction === 'LONG' ? '🟢📈' : '🔴📉';
      log(`${emoji} ${direction} @ $${price.toFixed(4)} | Size: ${positionSizeSol} SOL`, 'success');
      log(`🎯 TP: $${tp.toFixed(4)} | 🛑 SL: $${sl.toFixed(4)}`, 'info');
    } else {
      log(`❌ Entry failed: ${json.error}`, 'error');
    }
  } catch (e: any) {
    log(`❌ Entry error: ${e.message}`, 'error');
  }
};

// Smart entry with strategy-suggested levels
const enterPositionSmart = async (direction: 'LONG' | 'SHORT', suggestedSL: number, suggestedTP: number) => {
  const price = priceData.value.current;
  if (price <= 0) return;

  const { positionSizeSol } = settings.value;
  const usdAmount = positionSizeSol * price;

  // Get signal data for diagnostics
  const signalScore = strategySignal.value?.entry.score ?? 0;
  const signalConfidence = strategySignal.value?.entry.confidence ?? 0;
  const slPercent = Math.abs((suggestedSL - price) / price * 100);
  const tpPercent = Math.abs((suggestedTP - price) / price * 100);

  try {
    const res = await fetch('/api/trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'OPEN',
        trade: {
          symbol: 'SOL/USDC',
          address: 'SOL',
          direction,
          entryPrice: price,
          amount: usdAmount,
          size: positionSizeSol,
          timestamp: Date.now(),
          // Phase 5: Pass signal data for diagnostics
          signalScore,
          signalConfidence,
          stopLossPercent: slPercent,
          takeProfitPercent: tpPercent,
        },
      }),
    });

    const json = await res.json();

    if (json.success) {
      currentPosition.value = {
        id: json.trade.id,
        direction,
        entryPrice: price,
        entryTime: Date.now(),
        targetProfit: suggestedTP,
        stopLoss: suggestedSL,
        solAmount: positionSizeSol,
        usdAmount,
      };

      const emoji = direction === 'LONG' ? '🟢📈' : '🔴📉';

      log(`${emoji} ${direction} @ $${price.toFixed(4)} | Size: ${positionSizeSol} SOL`, 'success');
      log(`🎯 TP: $${suggestedTP.toFixed(4)} (+${tpPercent.toFixed(3)}%) | 🛑 SL: $${suggestedSL.toFixed(4)} (-${slPercent.toFixed(3)}%)`, 'info');
    } else {
      log(`❌ Entry failed: ${json.error}`, 'error');
    }
  } catch (e: any) {
    log(`❌ Entry error: ${e.message}`, 'error');
  }
};

const exitPosition = async (reason: string) => {
  if (!currentPosition.value) return;

  const exitPrice = priceData.value.current;
  const pnl = currentPnL.value.usd;
  const pnlPercent = currentPnL.value.percent;
  const holdTime = (Date.now() - currentPosition.value.entryTime) / 1000;
  const direction = currentPosition.value.direction;

  try {
    const res = await fetch('/api/trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'CLOSE',
        tradeId: currentPosition.value.id,
        exitPrice,
        pnl,
        pnlPercent,
        reason,
      }),
    });

    const json = await res.json();

    if (json.success) {
      // Update local stats
      stats.value.totalTrades++;
      stats.value.totalPnL += pnl;
      if (pnl > 0) stats.value.wins++;
      else stats.value.losses++;
      stats.value.winRate = (stats.value.wins / stats.value.totalTrades) * 100;

      tradeLogs.value.unshift({
        id: currentPosition.value.id,
        timestamp: Date.now(),
        type: 'EXIT',
        direction,
        price: exitPrice,
        pnl,
        pnlPercent,
        reason,
      });

      const emoji = pnl > 0 ? '🟢' : '🔴';
      const dirEmoji = direction === 'LONG' ? '📈' : '📉';
      log(
        `${emoji} EXIT ${direction} ${dirEmoji} @ $${exitPrice.toFixed(4)} | ` +
        `${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(4)}% | ` +
        `$${pnl >= 0 ? '+' : ''}${pnl.toFixed(4)} | ` +
        `${holdTime.toFixed(1)}s | ${reason}`,
        pnl > 0 ? 'success' : 'error'
      );

      currentPosition.value = null;
      await fetchPortfolio();
    } else {
      log(`❌ Exit failed: ${json.error}`, 'error');
    }
  } catch (e: any) {
    log(`❌ Exit error: ${e.message}`, 'error');
  }
};

// === BOT CONTROL ===
const startBot = () => {
  if (isAutoTrading.value) return;

  isAutoTrading.value = true;
  tradingTimer = setInterval(checkTradeSignals, 1000);

  const mode = settings.value.testMode ? '🎲 TEST' : '📊 LIVE';
  log(`🤖 SCALPER STARTED - ${mode}`, 'success');
  log(`📈 Longs: ${settings.value.allowLongs ? 'ON' : 'OFF'} | 📉 Shorts: ${settings.value.allowShorts ? 'ON' : 'OFF'}`, 'info');
};

const stopBot = () => {
  isAutoTrading.value = false;
  if (tradingTimer) clearInterval(tradingTimer);
  tradingTimer = null;
  log('🛑 SCALPER STOPPED', 'warn');
};

const manualClose = () => {
  if (currentPosition.value) {
    exitPosition('MANUAL');
  }
};

// === LOGGING ===
const log = (message: string, type: 'info' | 'success' | 'warn' | 'error' = 'info') => {
  const time = new Date().toLocaleTimeString('en-US', { hour12: false });
  consoleLogs.value.unshift({
    message: `[${time}] ${message}`,
    type,
    time: Date.now(),
  });
  if (consoleLogs.value.length > 100) {
    consoleLogs.value = consoleLogs.value.slice(0, 100);
  }
};

// === HELPERS ===
const formatDuration = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
};

const formatTime = (ts: number) => {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false });
};

const getChangeClass = (change: number | undefined) => {
  if (!change || change === 0) return 'text-gray-400';
  return change > 0 ? 'text-green-400' : 'text-red-400';
};

// === LIFECYCLE ===
onMounted(async () => {
  await fetchData();
  await fetchPortfolio();
  dataTimer = setInterval(fetchData, 500);
});

onUnmounted(() => {
  if (dataTimer) clearInterval(dataTimer);
  if (tradingTimer) clearInterval(tradingTimer);
});
</script>

<template>
  <div class="min-h-screen bg-black text-white">
    <!-- Header -->
    <div class="bg-gray-900/80 backdrop-blur-sm border-b border-gray-800 px-4 py-3 sticky top-0 z-20">
      <div class="max-w-4xl mx-auto flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div
            class="w-2 h-2 rounded-full"
            :class="streamConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'"
          />
          <span class="font-bold">SOL/USDC Scalper</span>
          <span class="px-2 py-0.5 text-xs rounded-full font-medium bg-green-500/20 text-green-400">
            ⚡ WS
          </span>
          <span v-if="settings.testMode" class="px-2 py-0.5 bg-yellow-500/20 text-yellow-400 text-xs rounded-full">
            TEST
          </span>
          <span v-if="settings.smartMode && !settings.testMode" class="px-2 py-0.5 bg-purple-500/20 text-purple-400 text-xs rounded-full">
            SMART
          </span>
        </div>
        <div class="flex items-center gap-4">
          <span class="text-xs" :class="trendClass">{{ trendEmoji }} {{ detectedTrend }}</span>
          <span v-if="avgLatency > 0" class="text-xs text-green-400">{{ avgLatency }}ms</span>
          <span class="text-xs text-gray-400">{{ formatDuration(streamStats.uptime) }}</span>
          <button
            @click="showSettings = !showSettings"
            class="p-2 hover:bg-gray-800 rounded-lg transition-colors"
          >
            ⚙️
          </button>
        </div>
      </div>
    </div>

    <div class="max-w-4xl mx-auto px-4 py-4 space-y-4">
      <!-- Price Card -->
      <div class="bg-gradient-to-br from-gray-900 to-gray-950 rounded-2xl p-5 border border-gray-800">
        <div class="flex items-start justify-between mb-3">
          <div>
            <div class="text-gray-400 text-sm">SOL/USDC</div>
            <div class="flex items-baseline gap-2">
              <span class="text-4xl font-bold">${{ Math.floor(priceData.current) }}</span>
              <span class="text-2xl text-gray-400">.{{ (priceData.current % 1).toFixed(4).slice(2) }}</span>
            </div>
          </div>
          <div class="text-right">
            <div
              class="px-3 py-1 rounded-full text-sm font-bold mb-2"
              :class="priceData.change30s >= 0 ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'"
            >
              {{ priceData.change30s >= 0 ? '↑' : '↓' }} {{ Math.abs(priceData.change30s).toFixed(3) }}%
            </div>
            <div class="text-xs" :class="trendClass">
              Trend: {{ trendEmoji }} {{ detectedTrend }}
            </div>
          </div>
        </div>

        <!-- Timeframe Changes -->
        <div class="grid grid-cols-4 gap-2 mb-4">
          <button
            v-for="tf in ['1m', '5m', '10m', '1h']"
            :key="tf"
            @click="activeTimeframe = tf"
            class="p-2 rounded-lg text-center transition-all"
            :class="activeTimeframe === tf ? 'bg-blue-600' : 'bg-gray-800/50 hover:bg-gray-800'"
          >
            <div class="text-xs text-gray-400">{{ tf }}</div>
            <div class="text-sm font-bold" :class="getChangeClass(candleData.priceChanges[tf])">
              {{ (candleData.priceChanges[tf] || 0) >= 0 ? '+' : '' }}{{ (candleData.priceChanges[tf] || 0).toFixed(3) }}%
            </div>
          </button>
        </div>

        <!-- Bot Controls -->
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="text-sm text-gray-400">Status:</span>
            <span class="font-medium" :class="statusClass">{{ statusText }}</span>
          </div>
          <div class="flex gap-2">
            <button
              v-if="!isAutoTrading"
              @click="startBot"
              class="px-6 py-2 bg-green-600 hover:bg-green-700 rounded-lg font-medium transition-colors"
            >
              ▶ Start Bot
            </button>
            <button
              v-if="isAutoTrading"
              @click="stopBot"
              class="px-6 py-2 bg-red-600 hover:bg-red-700 rounded-lg font-medium transition-colors"
            >
              ⏹ Stop Bot
            </button>
            <button
              v-if="hasPosition"
              @click="manualClose"
              class="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 rounded-lg font-medium text-sm transition-colors"
            >
              ✕ Close
            </button>
          </div>
        </div>
      </div>

      <!-- System Status Panel -->
      <div v-if="strategySignal && isAutoTrading" class="bg-gray-900/50 rounded-xl p-4 border border-gray-800">
        <div class="text-xs text-gray-500 mb-3">System Status</div>
        <div class="grid grid-cols-3 gap-3">
          <!-- Tradability -->
          <div class="p-3 rounded-lg" :class="strategySignal.tradability.isTradable ? 'bg-green-500/10 border border-green-500/30' : 'bg-red-500/10 border border-red-500/30'">
            <div class="flex items-center gap-2 mb-1">
              <span class="w-2 h-2 rounded-full" :class="strategySignal.tradability.isTradable ? 'bg-green-500' : 'bg-red-500'"></span>
              <span class="text-xs font-medium">Market</span>
            </div>
            <div class="text-xs" :class="strategySignal.tradability.isTradable ? 'text-green-400' : 'text-red-400'">
              {{ strategySignal.tradability.isTradable ? 'Tradable' : strategySignal.tradability.reason || 'Not tradable' }}
            </div>
          </div>

          <!-- Throttle -->
          <div class="p-3 rounded-lg" :class="strategySignal.throttle.canTrade ? 'bg-green-500/10 border border-green-500/30' : 'bg-yellow-500/10 border border-yellow-500/30'">
            <div class="flex items-center gap-2 mb-1">
              <span class="w-2 h-2 rounded-full" :class="strategySignal.throttle.canTrade ? 'bg-green-500' : 'bg-yellow-500'"></span>
              <span class="text-xs font-medium">Throttle</span>
            </div>
            <div class="text-xs" :class="strategySignal.throttle.canTrade ? 'text-green-400' : 'text-yellow-400'">
              <template v-if="strategySignal.throttle.canTrade">
                {{ strategySignal.throttle.tradesThisHour }}/{{ strategySignal.throttle.maxTradesPerHour }} trades
              </template>
              <template v-else>
                {{ strategySignal.throttle.reason }}
              </template>
            </div>
            <div v-if="strategySignal.throttle.cooldownRemaining > 0" class="text-xs text-yellow-400 mt-1">
              Cooldown: {{ Math.ceil(strategySignal.throttle.cooldownRemaining / 1000) }}s
            </div>
          </div>

          <!-- Entry Confirmation -->
          <div class="p-3 rounded-lg" :class="strategySignal.entryConfirmation?.confirmed ? 'bg-green-500/10 border border-green-500/30' : 'bg-gray-800 border border-gray-700'">
            <div class="flex items-center gap-2 mb-1">
              <span class="w-2 h-2 rounded-full" :class="strategySignal.entryConfirmation?.confirmed ? 'bg-green-500' : 'bg-gray-500'"></span>
              <span class="text-xs font-medium">Entry</span>
            </div>
            <div class="text-xs" :class="strategySignal.entryConfirmation?.confirmed ? 'text-green-400' : 'text-gray-400'">
              <template v-if="strategySignal.entryConfirmation">
                {{ strategySignal.entryConfirmation.confirmed ? 'Ready' : strategySignal.entryConfirmation.reason || 'Waiting' }}
              </template>
              <template v-else>
                Waiting for signal
              </template>
            </div>
          </div>
        </div>
      </div>

      <!-- Position Card -->
      <div
        v-if="hasPosition && currentPosition" 
        class="rounded-2xl p-4 border"
        :class="currentPosition.direction === 'LONG' 
          ? 'bg-green-900/20 border-green-800/50' 
          : 'bg-red-900/20 border-red-800/50'"
      >
        <div class="flex items-center justify-between mb-3">
          <span class="font-medium">
            {{ currentPosition.direction === 'LONG' ? '📈 LONG' : '📉 SHORT' }} Position
          </span>
          <span class="text-xs text-gray-400">{{ formatDuration(Date.now() - currentPosition.entryTime) }}</span>
        </div>
        <div class="grid grid-cols-4 gap-3 text-sm">
          <div class="text-center">
            <div class="text-gray-400 text-xs">Entry</div>
            <div class="font-mono">${{ currentPosition.entryPrice.toFixed(4) }}</div>
          </div>
          <div class="text-center">
            <div class="text-gray-400 text-xs">Current</div>
            <div class="font-mono">${{ priceData.current.toFixed(4) }}</div>
          </div>
          <div class="text-center">
            <div class="text-gray-400 text-xs">P&L %</div>
            <div class="font-bold text-lg" :class="currentPnL.percent >= 0 ? 'text-green-400' : 'text-red-400'">
              {{ currentPnL.percent >= 0 ? '+' : '' }}{{ currentPnL.percent.toFixed(4) }}%
            </div>
          </div>
          <div class="text-center">
            <div class="text-gray-400 text-xs">P&L $</div>
            <div class="font-bold text-lg" :class="currentPnL.usd >= 0 ? 'text-green-400' : 'text-red-400'">
              {{ currentPnL.usd >= 0 ? '+' : '' }}${{ currentPnL.usd.toFixed(4) }}
            </div>
          </div>
        </div>
        <div class="mt-3 flex items-center justify-between text-xs">
          <span class="text-green-400">🎯 TP: ${{ currentPosition.targetProfit.toFixed(4) }}</span>
          <span class="text-gray-400">{{ currentPosition.solAmount.toFixed(4) }} SOL</span>
          <span class="text-red-400">🛑 SL: ${{ currentPosition.stopLoss.toFixed(4) }}</span>
        </div>
      </div>

      <!-- Stats Grid -->
      <div class="grid grid-cols-2 gap-3">
        <!-- Overall Stats with Fees -->
        <div class="bg-gray-900/50 rounded-xl p-4 border border-gray-800">
          <div class="text-xs text-gray-500 mb-2">Performance (Net of Fees)</div>
          <div class="grid grid-cols-2 gap-2 text-center">
            <div>
              <div class="text-lg font-bold">{{ stats.totalTrades }}</div>
              <div class="text-xs text-gray-500">Trades</div>
            </div>
            <div>
              <div class="text-lg font-bold">{{ stats.winRate.toFixed(0) }}%</div>
              <div class="text-xs text-gray-500">Win Rate</div>
            </div>
            <div>
              <div class="text-lg font-bold" :class="stats.totalPnL >= 0 ? 'text-green-400' : 'text-red-400'">
                {{ stats.totalPnL >= 0 ? '+' : '' }}${{ stats.totalPnL.toFixed(4) }}
              </div>
              <div class="text-xs text-gray-500">Net P&L</div>
            </div>
            <div>
              <div class="text-lg font-bold text-yellow-400">
                -${{ stats.totalFees.toFixed(4) }}
              </div>
              <div class="text-xs text-gray-500">Fees Paid</div>
            </div>
          </div>
          <!-- Profit Factor -->
          <div class="mt-2 pt-2 border-t border-gray-800 flex justify-between text-xs">
            <span class="text-gray-500">Profit Factor:</span>
            <span :class="stats.profitFactor >= 1 ? 'text-green-400' : 'text-red-400'">
              {{ stats.profitFactor.toFixed(2) }}
            </span>
          </div>
        </div>

        <!-- Long/Short Stats -->
        <div class="bg-gray-900/50 rounded-xl p-4 border border-gray-800">
          <div class="text-xs text-gray-500 mb-2">By Direction</div>
          <div class="grid grid-cols-2 gap-2">
            <div class="text-center">
              <div class="text-xs text-green-400 mb-1">📈 LONGS</div>
              <div class="text-sm font-bold">{{ stats.longs }} trades</div>
              <div class="text-xs text-gray-500">{{ stats.longWinRate.toFixed(0) }}% win</div>
              <div class="text-xs" :class="stats.longPnL >= 0 ? 'text-green-400' : 'text-red-400'">
                {{ stats.longPnL >= 0 ? '+' : '' }}${{ stats.longPnL.toFixed(4) }}
              </div>
            </div>
            <div class="text-center">
              <div class="text-xs text-red-400 mb-1">📉 SHORTS</div>
              <div class="text-sm font-bold">{{ stats.shorts }} trades</div>
              <div class="text-xs text-gray-500">{{ stats.shortWinRate.toFixed(0) }}% win</div>
              <div class="text-xs" :class="stats.shortPnL >= 0 ? 'text-green-400' : 'text-red-400'">
                {{ stats.shortPnL >= 0 ? '+' : '' }}${{ stats.shortPnL.toFixed(4) }}
              </div>
            </div>
          </div>
          <!-- Cost Model Info -->
          <div class="mt-2 pt-2 border-t border-gray-800 text-xs text-gray-500">
            <div class="flex justify-between">
              <span>Round-trip cost:</span>
              <span class="text-yellow-400">~{{ costModel.roundTripCostPercent.toFixed(2) }}%</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Tabs -->
      <div class="bg-gray-900/50 rounded-2xl border border-gray-800 overflow-hidden">
        <div class="flex border-b border-gray-800">
          <button
            @click="activeTab = 'candles'"
            class="flex-1 px-4 py-3 text-sm font-medium transition-colors"
            :class="activeTab === 'candles' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white'"
          >
            📊 Candles
          </button>
          <button
            @click="activeTab = 'trades'"
            class="flex-1 px-4 py-3 text-sm font-medium transition-colors"
            :class="activeTab === 'trades' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white'"
          >
            💰 Trades ({{ tradeLogs.length }})
          </button>
          <button
            @click="activeTab = 'logs'"
            class="flex-1 px-4 py-3 text-sm font-medium transition-colors"
            :class="activeTab === 'logs' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white'"
          >
            📝 Logs
          </button>
        </div>

        <!-- Candles Tab -->
        <div v-if="activeTab === 'candles'" class="p-4">
          <div v-if="currentCandle" class="mb-4">
            <div class="text-sm text-gray-400 mb-2">Current {{ activeTimeframe }} Candle</div>
            <div class="grid grid-cols-4 gap-3">
              <div class="bg-black/30 rounded-lg p-3 text-center">
                <div class="text-xs text-gray-500">Open</div>
                <div class="font-mono">${{ currentCandle.open.toFixed(2) }}</div>
              </div>
              <div class="bg-black/30 rounded-lg p-3 text-center">
                <div class="text-xs text-gray-500">High</div>
                <div class="font-mono text-green-400">${{ currentCandle.high.toFixed(2) }}</div>
              </div>
              <div class="bg-black/30 rounded-lg p-3 text-center">
                <div class="text-xs text-gray-500">Low</div>
                <div class="font-mono text-red-400">${{ currentCandle.low.toFixed(2) }}</div>
              </div>
              <div class="bg-black/30 rounded-lg p-3 text-center">
                <div class="text-xs text-gray-500">Close</div>
                <div class="font-mono">${{ currentCandle.close.toFixed(2) }}</div>
              </div>
            </div>
          </div>

          <div class="text-sm text-gray-400 mb-2">All Timeframes</div>
          <div class="space-y-1">
            <div
              v-for="tf in timeframes"
              :key="tf"
              @click="activeTimeframe = tf"
              class="flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors"
              :class="activeTimeframe === tf ? 'bg-blue-900/30' : 'bg-black/20 hover:bg-black/30'"
            >
              <div class="flex items-center gap-3">
                <span class="w-10 font-medium">{{ tf }}</span>
                <span class="font-bold" :class="getChangeClass(candleData.priceChanges[tf])">
                  {{ (candleData.priceChanges[tf] || 0) >= 0 ? '+' : '' }}{{ (candleData.priceChanges[tf] || 0).toFixed(4) }}%
                </span>
              </div>
              <span class="text-xs text-gray-500">{{ candleData.current[tf]?.trades || 0 }} trades</span>
            </div>
          </div>
        </div>

        <!-- Trades Tab -->
        <div v-if="activeTab === 'trades'" class="max-h-80 overflow-y-auto">
          <div v-if="tradeLogs.length === 0" class="text-center py-12 text-gray-600">
            No trades yet
          </div>
          <div
            v-for="trade in tradeLogs"
            :key="trade.id"
            class="px-4 py-3 border-b border-gray-800/50 flex items-center justify-between"
          >
            <div class="flex items-center gap-3">
              <div
                class="w-8 h-8 rounded-full flex items-center justify-center text-sm"
                :class="trade.pnl && trade.pnl > 0 ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'"
              >
                {{ trade.direction === 'LONG' ? '📈' : '📉' }}
              </div>
              <div>
                <div class="flex items-center gap-2">
                  <span class="font-mono text-sm">${{ trade.price.toFixed(4) }}</span>
                  <span class="text-xs px-1.5 py-0.5 rounded" 
                    :class="trade.direction === 'LONG' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'">
                    {{ trade.direction }}
                  </span>
                </div>
                <div class="text-xs text-gray-500">{{ formatTime(trade.timestamp) }}</div>
              </div>
            </div>
            <div class="text-right">
              <div class="font-bold" :class="(trade.pnl || 0) >= 0 ? 'text-green-400' : 'text-red-400'">
                {{ (trade.pnl || 0) >= 0 ? '+' : '' }}${{ (trade.pnl || 0).toFixed(4) }}
              </div>
              <div class="text-xs text-gray-500">{{ trade.reason }}</div>
            </div>
          </div>
        </div>

        <!-- Logs Tab -->
        <div v-if="activeTab === 'logs'" class="max-h-80 overflow-y-auto p-2">
          <div v-if="consoleLogs.length === 0" class="text-center py-12 text-gray-600">
            No logs yet
          </div>
          <div
            v-for="logItem in consoleLogs"
            :key="logItem.time"
            class="px-2 py-1 text-xs font-mono rounded"
            :class="{
              'text-green-400': logItem.type === 'success',
              'text-red-400': logItem.type === 'error',
              'text-yellow-400': logItem.type === 'warn',
              'text-gray-300': logItem.type === 'info',
            }"
          >
            {{ logItem.message }}
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="flex items-center justify-center gap-4 text-xs text-gray-500 py-2 flex-wrap">
        <div class="flex items-center gap-1">
          <span class="w-1.5 h-1.5 rounded-full" :class="streamConnected ? 'bg-green-500' : 'bg-red-500'"></span>
          WebSocket
        </div>
        <div>{{ streamStats.pool.updatesReceived || 0 }} updates</div>
        <div>{{ candleData.stats.totalCandles }} candles</div>
        <div v-if="avgLatency > 0" class="text-green-400">~{{ avgLatency }}ms</div>
      </div>
    </div>

    <!-- Settings Modal -->
    <div v-if="showSettings" class="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" @click.self="showSettings = false">
      <div class="bg-gray-900 rounded-2xl p-6 w-full max-w-md border border-gray-800 max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between mb-6">
          <h2 class="text-lg font-bold">Settings</h2>
          <button @click="showSettings = false" class="text-gray-400 hover:text-white text-xl">x</button>
        </div>

        <!-- Position Size -->
        <div class="mb-6">
          <label class="text-sm text-gray-400">Position Size (SOL)</label>
          <input
            v-model.number="settings.positionSizeSol"
            type="number"
            step="0.01"
            min="0.01"
            class="w-full mt-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-lg font-medium"
          />
        </div>

        <!-- TP/SL Settings -->
        <div class="grid grid-cols-2 gap-4 mb-6">
          <div>
            <label class="text-sm text-gray-400">Take Profit (%)</label>
            <input
              v-model.number="settings.takeProfitPercent"
              type="number"
              step="0.1"
              min="0.1"
              class="w-full mt-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg"
            />
          </div>
          <div>
            <label class="text-sm text-gray-400">Stop Loss (%)</label>
            <input
              v-model.number="settings.stopLossPercent"
              type="number"
              step="0.1"
              min="0.1"
              class="w-full mt-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg"
            />
          </div>
        </div>

        <!-- Direction Toggles -->
        <div class="mb-6 grid grid-cols-2 gap-3">
          <div
            class="p-4 rounded-xl cursor-pointer transition-all"
            :class="settings.allowLongs ? 'bg-green-500/20 border border-green-500/50' : 'bg-gray-800 border border-gray-700'"
            @click="settings.allowLongs = !settings.allowLongs"
          >
            <div class="text-center">
              <div class="font-medium">Longs</div>
              <div class="text-xs" :class="settings.allowLongs ? 'text-green-400' : 'text-gray-500'">
                {{ settings.allowLongs ? 'Enabled' : 'Disabled' }}
              </div>
            </div>
          </div>
          <div
            class="p-4 rounded-xl cursor-pointer transition-all"
            :class="settings.allowShorts ? 'bg-red-500/20 border border-red-500/50' : 'bg-gray-800 border border-gray-700'"
            @click="settings.allowShorts = !settings.allowShorts"
          >
            <div class="text-center">
              <div class="font-medium">Shorts</div>
              <div class="text-xs" :class="settings.allowShorts ? 'text-red-400' : 'text-gray-500'">
                {{ settings.allowShorts ? 'Enabled' : 'Disabled' }}
              </div>
            </div>
          </div>
        </div>

        <!-- Cost Info -->
        <div class="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg mb-6">
          <div class="text-xs text-yellow-400">
            Round-trip cost: ~{{ costModel.roundTripCostPercent.toFixed(2) }}%
          </div>
          <div class="text-xs text-gray-400 mt-1">
            TP should be > {{ (costModel.roundTripCostPercent + 0.5).toFixed(1) }}% to profit after fees
          </div>
        </div>

        <div class="mt-6">
          <button
            @click="showSettings = false"
            class="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition-colors"
          >
            Save & Close
          </button>
        </div>
      </div>
    </div>
  </div>
</template>