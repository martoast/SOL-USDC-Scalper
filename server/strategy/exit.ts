// server/strategy/exit.ts

/**
 * Exit Signal Generator
 *
 * Generates intelligent exit signals including:
 * - Take profit (ATR-based)
 * - Stop loss (ATR-based)
 * - Trailing stops
 * - Signal reversal exits
 * - Time-based exits
 */

import type { IndicatorSnapshot } from '../indicators/types';
import type { ExitSignal, ExitReason, ActivePosition, StrategyConfig, MarketRegimeAnalysis } from './types';
import { DEFAULT_STRATEGY_CONFIG } from './types';

/**
 * Generate exit signal for an active position
 *
 * @param snapshot - Current indicator snapshot
 * @param position - Active position details
 * @param currentPrice - Current market price
 * @param regime - Current market regime
 * @param config - Strategy configuration
 * @returns Exit signal with all details
 */
export function generateExitSignal(
  snapshot: IndicatorSnapshot,
  position: ActivePosition,
  currentPrice: number,
  regime: MarketRegimeAnalysis,
  config: StrategyConfig = DEFAULT_STRATEGY_CONFIG
): ExitSignal {
  const { direction, entryPrice, entryTime, takeProfit, currentStopLoss, maxPnLPercent } = position;

  // Calculate current P&L
  let currentPnLPercent: number;
  if (direction === 'LONG') {
    currentPnLPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
  } else {
    currentPnLPercent = ((entryPrice - currentPrice) / entryPrice) * 100;
  }

  // Track maximum P&L
  const newMaxPnL = Math.max(maxPnLPercent, currentPnLPercent);

  // ============================================================================
  // CHECK EXIT CONDITIONS (in order of priority)
  // ============================================================================

  // 1. STOP LOSS - highest priority
  const stopLossHit = checkStopLoss(currentPrice, direction, currentStopLoss);
  if (stopLossHit) {
    return {
      shouldExit: true,
      reason: 'STOP_LOSS',
      urgency: 'critical',
      trailingStopPrice: null,
      trailingStopTriggered: false,
      currentPnLPercent,
      maxPnLPercent: newMaxPnL,
      explanation: `Stop loss hit at $${currentStopLoss.toFixed(4)}. Cut losses.`,
      timestamp: Date.now(),
    };
  }

  // 2. TAKE PROFIT
  const takeProfitHit = checkTakeProfit(currentPrice, direction, takeProfit);
  if (takeProfitHit) {
    return {
      shouldExit: true,
      reason: 'TAKE_PROFIT',
      urgency: 'high',
      trailingStopPrice: null,
      trailingStopTriggered: false,
      currentPnLPercent,
      maxPnLPercent: newMaxPnL,
      explanation: `Take profit target reached at $${takeProfit.toFixed(4)}. Secure gains!`,
      timestamp: Date.now(),
    };
  }

  // 3. TRAILING STOP
  if (config.enableTrailingStop) {
    const trailingResult = checkTrailingStop(
      currentPrice,
      direction,
      position,
      currentPnLPercent,
      newMaxPnL,
      config
    );

    if (trailingResult.triggered) {
      return {
        shouldExit: true,
        reason: 'TRAILING_STOP',
        urgency: 'high',
        trailingStopPrice: trailingResult.trailingStopPrice,
        trailingStopTriggered: true,
        currentPnLPercent,
        maxPnLPercent: newMaxPnL,
        explanation: `Trailing stop triggered at $${trailingResult.trailingStopPrice?.toFixed(4)}. Locking in profits.`,
        timestamp: Date.now(),
      };
    }
  }

  // 4. SIGNAL REVERSAL - indicators flipped against position
  const signalReversal = checkSignalReversal(snapshot, direction);
  if (signalReversal.shouldExit) {
    return {
      shouldExit: true,
      reason: 'SIGNAL_REVERSAL',
      urgency: 'medium',
      trailingStopPrice: null,
      trailingStopTriggered: false,
      currentPnLPercent,
      maxPnLPercent: newMaxPnL,
      explanation: signalReversal.explanation,
      timestamp: Date.now(),
    };
  }

  // 5. REGIME CHANGE - market conditions changed significantly
  if (config.enableRegimeFilter && regime.regime === 'volatile') {
    return {
      shouldExit: true,
      reason: 'REGIME_CHANGE',
      urgency: 'medium',
      trailingStopPrice: null,
      trailingStopTriggered: false,
      currentPnLPercent,
      maxPnLPercent: newMaxPnL,
      explanation: 'Market became volatile. Exiting for safety.',
      timestamp: Date.now(),
    };
  }

  // 6. TIME STOP - position held too long
  const holdTimeSeconds = (Date.now() - entryTime) / 1000;
  if (holdTimeSeconds >= config.maxHoldTimeSeconds) {
    return {
      shouldExit: true,
      reason: 'TIME_STOP',
      urgency: 'low',
      trailingStopPrice: null,
      trailingStopTriggered: false,
      currentPnLPercent,
      maxPnLPercent: newMaxPnL,
      explanation: `Position held for ${(holdTimeSeconds / 60).toFixed(1)} minutes. Time stop triggered.`,
      timestamp: Date.now(),
    };
  }

  // 7. VOLATILITY SPIKE - sudden increase in volatility
  if (snapshot.atr && snapshot.atr.volatilityLevel === 'extreme' && currentPnLPercent > 0) {
    return {
      shouldExit: true,
      reason: 'VOLATILITY_SPIKE',
      urgency: 'medium',
      trailingStopPrice: null,
      trailingStopTriggered: false,
      currentPnLPercent,
      maxPnLPercent: newMaxPnL,
      explanation: 'Extreme volatility detected while in profit. Taking gains.',
      timestamp: Date.now(),
    };
  }

  // ============================================================================
  // NO EXIT - Calculate trailing stop level for display
  // ============================================================================

  let trailingStopPrice: number | null = null;

  if (config.enableTrailingStop && currentPnLPercent >= config.trailingStopActivationPercent) {
    // Calculate where trailing stop would be
    if (direction === 'LONG') {
      const highestPrice = Math.max(position.maxPrice, currentPrice);
      trailingStopPrice = highestPrice * (1 - config.trailingStopDistancePercent / 100);
    } else {
      const lowestPrice = Math.min(position.minPrice, currentPrice);
      trailingStopPrice = lowestPrice * (1 + config.trailingStopDistancePercent / 100);
    }
  }

  return {
    shouldExit: false,
    reason: 'NONE',
    urgency: 'low',
    trailingStopPrice,
    trailingStopTriggered: false,
    currentPnLPercent,
    maxPnLPercent: newMaxPnL,
    explanation: 'Position within parameters. Continue holding.',
    timestamp: Date.now(),
  };
}

/**
 * Check if stop loss was hit
 */
function checkStopLoss(
  currentPrice: number,
  direction: 'LONG' | 'SHORT',
  stopLoss: number
): boolean {
  if (direction === 'LONG') {
    return currentPrice <= stopLoss;
  } else {
    return currentPrice >= stopLoss;
  }
}

/**
 * Check if take profit was hit
 */
function checkTakeProfit(
  currentPrice: number,
  direction: 'LONG' | 'SHORT',
  takeProfit: number
): boolean {
  if (direction === 'LONG') {
    return currentPrice >= takeProfit;
  } else {
    return currentPrice <= takeProfit;
  }
}

/**
 * Check trailing stop
 */
function checkTrailingStop(
  currentPrice: number,
  direction: 'LONG' | 'SHORT',
  position: ActivePosition,
  currentPnLPercent: number,
  maxPnLPercent: number,
  config: StrategyConfig
): { triggered: boolean; trailingStopPrice: number | null } {
  // Only activate trailing stop after minimum profit reached
  if (maxPnLPercent < config.trailingStopActivationPercent) {
    return { triggered: false, trailingStopPrice: null };
  }

  let trailingStopPrice: number;

  if (direction === 'LONG') {
    // For LONG: trail from the highest price reached
    const highestPrice = Math.max(position.maxPrice, currentPrice);
    trailingStopPrice = highestPrice * (1 - config.trailingStopDistancePercent / 100);

    // Check if price has fallen to trailing stop
    if (currentPrice <= trailingStopPrice) {
      return { triggered: true, trailingStopPrice };
    }
  } else {
    // For SHORT: trail from the lowest price reached
    const lowestPrice = Math.min(position.minPrice, currentPrice);
    trailingStopPrice = lowestPrice * (1 + config.trailingStopDistancePercent / 100);

    // Check if price has risen to trailing stop
    if (currentPrice >= trailingStopPrice) {
      return { triggered: true, trailingStopPrice };
    }
  }

  return { triggered: false, trailingStopPrice };
}

/**
 * Check if signals have reversed against position
 *
 * IMPORTANT: We only exit on STRONG reversals, not minor indicator changes.
 * Let TP/SL do the work - don't cut winners short!
 */
function checkSignalReversal(
  snapshot: IndicatorSnapshot,
  direction: 'LONG' | 'SHORT'
): { shouldExit: boolean; explanation: string } {
  const { signals, rsi } = snapshot;

  // Only exit on VERY strong reversal - score must flip hard against us
  // This prevents whipsaw exits from minor indicator fluctuations
  const strongReversalThreshold = 40;

  if (direction === 'LONG') {
    // Exit LONG only if score becomes STRONGLY bearish
    if (signals.compositeScore <= -strongReversalThreshold) {
      return {
        shouldExit: true,
        explanation: `Strong bearish reversal (score: ${signals.compositeScore.toFixed(1)}). Exiting LONG.`,
      };
    }

    // Exit LONG if RSI hits extreme overbought (potential reversal)
    if (rsi && rsi.value >= 85) {
      return {
        shouldExit: true,
        explanation: `RSI extreme overbought (${rsi.value.toFixed(1)}). Taking LONG profits.`,
      };
    }

    // NOTE: Removed MACD crossover exit - too sensitive, causes whipsaw
  } else {
    // Exit SHORT only if score becomes STRONGLY bullish
    if (signals.compositeScore >= strongReversalThreshold) {
      return {
        shouldExit: true,
        explanation: `Strong bullish reversal (score: ${signals.compositeScore.toFixed(1)}). Exiting SHORT.`,
      };
    }

    // Exit SHORT if RSI hits extreme oversold
    if (rsi && rsi.value <= 15) {
      return {
        shouldExit: true,
        explanation: `RSI extreme oversold (${rsi.value.toFixed(1)}). Taking SHORT profits.`,
      };
    }

    // NOTE: Removed MACD crossover exit - too sensitive, causes whipsaw
  }

  return { shouldExit: false, explanation: '' };
}

/**
 * Update position tracking (call this after each price update)
 */
export function updatePositionTracking(
  position: ActivePosition,
  currentPrice: number
): ActivePosition {
  return {
    ...position,
    maxPrice: Math.max(position.maxPrice, currentPrice),
    minPrice: Math.min(position.minPrice, currentPrice),
    maxPnLPercent: Math.max(
      position.maxPnLPercent,
      position.direction === 'LONG'
        ? ((currentPrice - position.entryPrice) / position.entryPrice) * 100
        : ((position.entryPrice - currentPrice) / position.entryPrice) * 100
    ),
  };
}

/**
 * Create initial position from entry signal
 */
export function createPosition(
  direction: 'LONG' | 'SHORT',
  entryPrice: number,
  size: number,
  stopLoss: number,
  takeProfit: number
): ActivePosition {
  return {
    direction,
    entryPrice,
    entryTime: Date.now(),
    size,
    initialStopLoss: stopLoss,
    currentStopLoss: stopLoss,
    takeProfit,
    maxPrice: entryPrice,
    minPrice: entryPrice,
    maxPnLPercent: 0,
  };
}
