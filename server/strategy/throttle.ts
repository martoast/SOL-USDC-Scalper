// server/strategy/throttle.ts

/**
 * Trade Throttle & Cooldown System
 *
 * Prevents revenge trading and overtrading with:
 * 1. Cooldown after stop-loss (5-10 minutes)
 * 2. Minimum gap between trades (2 minutes)
 * 3. Max trades per hour (3)
 * 4. Pause after consecutive losses (3)
 */

// ============================================================================
// TYPES
// ============================================================================

export interface ThrottleStatus {
  canTrade: boolean;
  reason: string | null;          // null if can trade, otherwise why blocked
  cooldownRemaining: number;      // ms remaining in cooldown (0 if none)
  tradesThisHour: number;
  maxTradesPerHour: number;
  consecutiveLosses: number;
  maxConsecutiveLosses: number;
  lastTradeTime: number | null;
  timestamp: number;
}

export interface ThrottleConfig {
  stopLossCooldownMs: number;     // Cooldown after stop-loss (default: 5 min)
  minTradingGapMs: number;        // Min gap between any trades (default: 2 min)
  maxTradesPerHour: number;       // Max trades in rolling hour (default: 3)
  maxConsecutiveLosses: number;   // Pause after N consecutive losses (default: 3)
}

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

export const DEFAULT_THROTTLE_CONFIG: ThrottleConfig = {
  stopLossCooldownMs: 5 * 60 * 1000,     // 5 minutes
  minTradingGapMs: 2 * 60 * 1000,         // 2 minutes
  maxTradesPerHour: 3,
  maxConsecutiveLosses: 3,
};

// ============================================================================
// STATE
// ============================================================================

interface TradeRecord {
  timestamp: number;
  result: 'win' | 'loss' | 'breakeven';
  exitReason: string;
}

// Throttle state
let tradeHistory: TradeRecord[] = [];
let consecutiveLosses = 0;
let lastStopLossTime: number | null = null;
let config: ThrottleConfig = { ...DEFAULT_THROTTLE_CONFIG };

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

/**
 * Check if trading is allowed right now
 */
export function checkThrottle(): ThrottleStatus {
  const now = Date.now();

  // Clean up old trades (older than 1 hour)
  const oneHourAgo = now - 60 * 60 * 1000;
  tradeHistory = tradeHistory.filter(t => t.timestamp > oneHourAgo);

  const tradesThisHour = tradeHistory.length;
  const lastTrade = tradeHistory[tradeHistory.length - 1];
  const lastTradeTime = lastTrade?.timestamp ?? null;

  // ============================================================================
  // CHECK 1: Stop-loss cooldown
  // ============================================================================

  if (lastStopLossTime !== null) {
    const timeSinceStopLoss = now - lastStopLossTime;
    if (timeSinceStopLoss < config.stopLossCooldownMs) {
      const remaining = config.stopLossCooldownMs - timeSinceStopLoss;
      return {
        canTrade: false,
        reason: `Stop-loss cooldown (${formatTime(remaining)} remaining)`,
        cooldownRemaining: remaining,
        tradesThisHour,
        maxTradesPerHour: config.maxTradesPerHour,
        consecutiveLosses,
        maxConsecutiveLosses: config.maxConsecutiveLosses,
        lastTradeTime,
        timestamp: now,
      };
    }
  }

  // ============================================================================
  // CHECK 2: Minimum gap between trades
  // ============================================================================

  if (lastTradeTime !== null) {
    const timeSinceLastTrade = now - lastTradeTime;
    if (timeSinceLastTrade < config.minTradingGapMs) {
      const remaining = config.minTradingGapMs - timeSinceLastTrade;
      return {
        canTrade: false,
        reason: `Minimum gap between trades (${formatTime(remaining)} remaining)`,
        cooldownRemaining: remaining,
        tradesThisHour,
        maxTradesPerHour: config.maxTradesPerHour,
        consecutiveLosses,
        maxConsecutiveLosses: config.maxConsecutiveLosses,
        lastTradeTime,
        timestamp: now,
      };
    }
  }

  // ============================================================================
  // CHECK 3: Consecutive losses (before max trades - this is a safety pause)
  // ============================================================================

  if (consecutiveLosses >= config.maxConsecutiveLosses) {
    return {
      canTrade: false,
      reason: `Paused after ${consecutiveLosses} consecutive losses`,
      cooldownRemaining: 0,
      tradesThisHour,
      maxTradesPerHour: config.maxTradesPerHour,
      consecutiveLosses,
      maxConsecutiveLosses: config.maxConsecutiveLosses,
      lastTradeTime,
      timestamp: now,
    };
  }

  // ============================================================================
  // CHECK 4: Max trades per hour
  // ============================================================================

  if (tradesThisHour >= config.maxTradesPerHour) {
    // Find when the oldest trade in the window will expire
    const oldestTrade = tradeHistory[0];
    const remaining = oldestTrade ? (oldestTrade.timestamp + 60 * 60 * 1000) - now : 0;
    return {
      canTrade: false,
      reason: `Max trades per hour reached (${tradesThisHour}/${config.maxTradesPerHour})`,
      cooldownRemaining: Math.max(0, remaining),
      tradesThisHour,
      maxTradesPerHour: config.maxTradesPerHour,
      consecutiveLosses,
      maxConsecutiveLosses: config.maxConsecutiveLosses,
      lastTradeTime,
      timestamp: now,
    };
  }

  // ============================================================================
  // ALL CHECKS PASSED
  // ============================================================================

  return {
    canTrade: true,
    reason: null,
    cooldownRemaining: 0,
    tradesThisHour,
    maxTradesPerHour: config.maxTradesPerHour,
    consecutiveLosses,
    maxConsecutiveLosses: config.maxConsecutiveLosses,
    lastTradeTime,
    timestamp: now,
  };
}

/**
 * Record a completed trade
 *
 * Call this after every trade exit to track history.
 */
export function recordTrade(result: 'win' | 'loss' | 'breakeven', exitReason: string): void {
  const now = Date.now();

  // Add to history
  tradeHistory.push({
    timestamp: now,
    result,
    exitReason,
  });

  // Update consecutive losses
  if (result === 'loss') {
    consecutiveLosses++;
    // Track stop-loss specifically for cooldown
    if (exitReason === 'STOP_LOSS') {
      lastStopLossTime = now;
    }
  } else {
    // Win or breakeven resets consecutive losses
    consecutiveLosses = 0;
  }
}

/**
 * Reset consecutive loss counter
 *
 * Call this to manually reset the pause state (e.g., after user review).
 */
export function resetConsecutiveLosses(): void {
  consecutiveLosses = 0;
}

/**
 * Reset stop-loss cooldown
 *
 * Call this to manually clear the stop-loss cooldown.
 */
export function clearStopLossCooldown(): void {
  lastStopLossTime = null;
}

/**
 * Update throttle configuration
 */
export function setThrottleConfig(newConfig: Partial<ThrottleConfig>): void {
  config = { ...config, ...newConfig };
}

/**
 * Get current throttle configuration
 */
export function getThrottleConfig(): ThrottleConfig {
  return { ...config };
}

/**
 * Reset all throttle state (for testing)
 */
export function resetThrottleState(): void {
  tradeHistory = [];
  consecutiveLosses = 0;
  lastStopLossTime = null;
  config = { ...DEFAULT_THROTTLE_CONFIG };
}

/**
 * Quick check - just returns boolean
 */
export function canTrade(): boolean {
  return checkThrottle().canTrade;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Format milliseconds as human-readable time
 */
function formatTime(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (remainingSeconds === 0) {
    return `${minutes}m`;
  }
  return `${minutes}m ${remainingSeconds}s`;
}
