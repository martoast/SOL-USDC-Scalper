// server/strategy/entry.ts

/**
 * Entry Signal Generator
 *
 * Generates intelligent entry signals based on multiple indicators,
 * market regime, and configurable parameters.
 */

import type { IndicatorSnapshot } from '../indicators/types';
import type { EntrySignal, StrategyConfig, MarketRegimeAnalysis } from './types';
import { DEFAULT_STRATEGY_CONFIG } from './types';
import { getRegimeAdjustedParams, isRegimeFavorable } from './regime';

/**
 * Generate entry signal based on current market conditions
 *
 * @param snapshot - Current indicator snapshot
 * @param regime - Market regime analysis
 * @param currentPrice - Current price
 * @param config - Strategy configuration
 * @returns Entry signal with all details
 */
export function generateEntrySignal(
  snapshot: IndicatorSnapshot,
  regime: MarketRegimeAnalysis,
  currentPrice: number,
  config: StrategyConfig = DEFAULT_STRATEGY_CONFIG
): EntrySignal {
  const reasons: string[] = [];
  const warnings: string[] = [];

  // Extract indicator values
  const { rsi, macd, ema, bollingerBands, atr, adx, volumePressure, signals } = snapshot;

  // Get composite score and confidence from pre-calculated signals
  const score = signals.compositeScore;
  const confidence = signals.confidence;

  // ============================================================================
  // DETERMINE DIRECTION
  // ============================================================================

  let direction: 'LONG' | 'SHORT' | 'NONE' = 'NONE';
  let shouldEnter = false;

  // Check if regime is favorable
  if (!isRegimeFavorable(regime, config.allowTradingInRanging)) {
    warnings.push(`Unfavorable regime: ${regime.regime}`);
    if (config.enableRegimeFilter) {
      return createNoEntrySignal(snapshot, currentPrice, warnings, 'Regime filter blocked entry');
    }
  }

  // Direction based on score
  if (score >= config.minScoreToEnter) {
    direction = 'LONG';
    reasons.push(`Composite score ${score.toFixed(1)} >= ${config.minScoreToEnter} (bullish)`);
  } else if (score <= -config.minScoreToEnter) {
    direction = 'SHORT';
    reasons.push(`Composite score ${score.toFixed(1)} <= -${config.minScoreToEnter} (bearish)`);
  }

  // ============================================================================
  // VALIDATE WITH INDIVIDUAL INDICATORS
  // ============================================================================

  // RSI confirmation
  if (rsi) {
    if (direction === 'LONG' && rsi.zone === 'overbought') {
      warnings.push(`RSI overbought (${rsi.value.toFixed(1)}) - LONG may be late`);
    } else if (direction === 'LONG' && rsi.zone === 'oversold') {
      reasons.push(`RSI oversold (${rsi.value.toFixed(1)}) - good LONG entry`);
    } else if (direction === 'SHORT' && rsi.zone === 'oversold') {
      warnings.push(`RSI oversold (${rsi.value.toFixed(1)}) - SHORT may be late`);
    } else if (direction === 'SHORT' && rsi.zone === 'overbought') {
      reasons.push(`RSI overbought (${rsi.value.toFixed(1)}) - good SHORT entry`);
    }
  }

  // MACD confirmation
  if (macd) {
    if (direction === 'LONG' && macd.crossover === 'bullish') {
      reasons.push('MACD bullish crossover - strong LONG signal');
    } else if (direction === 'SHORT' && macd.crossover === 'bearish') {
      reasons.push('MACD bearish crossover - strong SHORT signal');
    } else if (direction === 'LONG' && macd.isBelowSignal) {
      warnings.push('MACD below signal line - LONG signal weaker');
    } else if (direction === 'SHORT' && macd.isAboveSignal) {
      warnings.push('MACD above signal line - SHORT signal weaker');
    }
  }

  // EMA trend confirmation
  if (ema) {
    const emaTrend = ema.trend;
    if (direction === 'LONG' && (emaTrend === 'bearish' || emaTrend === 'strong_bearish')) {
      warnings.push(`EMA trend is ${emaTrend} - going against trend`);
    } else if (direction === 'SHORT' && (emaTrend === 'bullish' || emaTrend === 'strong_bullish')) {
      warnings.push(`EMA trend is ${emaTrend} - going against trend`);
    } else if (direction === 'LONG' && (emaTrend === 'bullish' || emaTrend === 'strong_bullish')) {
      reasons.push(`EMA trend aligned: ${emaTrend}`);
    } else if (direction === 'SHORT' && (emaTrend === 'bearish' || emaTrend === 'strong_bearish')) {
      reasons.push(`EMA trend aligned: ${emaTrend}`);
    }
  }

  // ADX trend strength
  if (adx) {
    if (adx.trendStrength === 'strong' || adx.trendStrength === 'extreme') {
      reasons.push(`Strong trend (ADX: ${adx.adx.toFixed(1)})`);
    } else if (adx.trendStrength === 'none' || adx.trendStrength === 'weak') {
      if (regime.regime !== 'ranging') {
        warnings.push(`Weak trend (ADX: ${adx.adx.toFixed(1)}) - momentum may fade`);
      }
    }
  }

  // Bollinger Bands
  if (bollingerBands) {
    if (direction === 'LONG' && bollingerBands.zone === 'below_lower') {
      reasons.push('Price below lower Bollinger Band - oversold');
    } else if (direction === 'SHORT' && bollingerBands.zone === 'above_upper') {
      reasons.push('Price above upper Bollinger Band - overbought');
    }
  }

  // Volume confirmation
  if (volumePressure) {
    if (direction === 'LONG' && volumePressure.dominance === 'buyers') {
      reasons.push('Buyer volume dominance');
    } else if (direction === 'SHORT' && volumePressure.dominance === 'sellers') {
      reasons.push('Seller volume dominance');
    } else if (direction === 'LONG' && volumePressure.dominance === 'sellers') {
      warnings.push('Sellers dominating - LONG may struggle');
    } else if (direction === 'SHORT' && volumePressure.dominance === 'buyers') {
      warnings.push('Buyers dominating - SHORT may struggle');
    }
  }

  // ============================================================================
  // FINAL DECISION
  // ============================================================================

  // Check confidence threshold
  if (confidence < config.minConfidenceToEnter) {
    warnings.push(`Confidence ${confidence.toFixed(0)}% below threshold ${config.minConfidenceToEnter}%`);
    if (direction !== 'NONE') {
      direction = 'NONE';
    }
  }

  // Final shouldEnter decision
  // Simplified: just need a direction and not too many critical warnings
  shouldEnter = direction !== 'NONE' && warnings.length <= 4;

  // Only bail if we have overwhelming warnings (5+)
  if (warnings.length >= 5) {
    shouldEnter = false;
    direction = 'NONE';
    warnings.push('Too many warning signals - staying out');
  }

  // ============================================================================
  // CALCULATE STOP LOSS & TAKE PROFIT
  // ============================================================================

  const { stopLossMultiplier, takeProfitMultiplier, positionSizeMultiplier } = getRegimeAdjustedParams(regime);

  // Use ATR for dynamic stops
  const atrValue = atr?.value ?? currentPrice * 0.005; // Default 0.5% if no ATR
  const adjustedAtr = atrValue * config.atrStopLossMultiplier * stopLossMultiplier;
  const adjustedTp = atrValue * config.atrTakeProfitMultiplier * takeProfitMultiplier;

  // IMPORTANT: Set minimum TP/SL to cover fees!
  // Round-trip fees are ~0.6%, so TP must be > 1% to make any profit
  const MIN_TP_PERCENT = 1.2; // At least 1.2% TP (leaves ~0.6% after fees)
  const MIN_SL_PERCENT = 0.5; // At least 0.5% SL (reasonable risk)

  const minTpMove = currentPrice * (MIN_TP_PERCENT / 100);
  const minSlMove = currentPrice * (MIN_SL_PERCENT / 100);

  // Use the larger of ATR-based or minimum
  const finalTpMove = Math.max(adjustedTp, minTpMove);
  const finalSlMove = Math.max(adjustedAtr, minSlMove);

  let suggestedStopLoss: number;
  let suggestedTakeProfit: number;

  if (direction === 'LONG') {
    suggestedStopLoss = currentPrice - finalSlMove;
    suggestedTakeProfit = currentPrice + finalTpMove;
  } else if (direction === 'SHORT') {
    suggestedStopLoss = currentPrice + finalSlMove;
    suggestedTakeProfit = currentPrice - finalTpMove;
  } else {
    suggestedStopLoss = currentPrice;
    suggestedTakeProfit = currentPrice;
  }

  const stopLossPercent = (Math.abs(currentPrice - suggestedStopLoss) / currentPrice) * 100;
  const takeProfitPercent = (Math.abs(suggestedTakeProfit - currentPrice) / currentPrice) * 100;

  // ============================================================================
  // CALCULATE POSITION SIZE MULTIPLIER
  // ============================================================================

  // Base multiplier from regime
  let sizeMultiplier = positionSizeMultiplier;

  // Adjust based on confidence
  if (confidence >= 75) {
    sizeMultiplier *= 1.2;
  } else if (confidence >= 60) {
    sizeMultiplier *= 1.0;
  } else if (confidence >= 45) {
    sizeMultiplier *= 0.8;
  } else {
    sizeMultiplier *= 0.5;
  }

  // Clamp to config limits
  sizeMultiplier = Math.max(
    config.minPositionSizeMultiplier,
    Math.min(config.maxPositionSizeMultiplier, sizeMultiplier)
  );

  return {
    shouldEnter,
    direction,
    confidence,
    score,
    suggestedStopLoss,
    suggestedTakeProfit,
    stopLossPercent,
    takeProfitPercent,
    suggestedSizeMultiplier: sizeMultiplier,
    reasons,
    warnings,
    indicators: {
      rsi: rsi?.value ?? null,
      macdHistogram: macd?.histogram ?? null,
      emaTrend: ema.trend,
      adx: adx?.adx ?? null,
      atrPercent: atr?.valuePercent ?? null,
    },
    timestamp: Date.now(),
  };
}

/**
 * Create a "no entry" signal with explanation
 */
function createNoEntrySignal(
  snapshot: IndicatorSnapshot,
  currentPrice: number,
  warnings: string[],
  reason: string
): EntrySignal {
  const { rsi, macd, ema, atr, adx, signals } = snapshot;

  return {
    shouldEnter: false,
    direction: 'NONE',
    confidence: signals.confidence,
    score: signals.compositeScore,
    suggestedStopLoss: currentPrice,
    suggestedTakeProfit: currentPrice,
    stopLossPercent: 0,
    takeProfitPercent: 0,
    suggestedSizeMultiplier: 0,
    reasons: [],
    warnings: [...warnings, reason],
    indicators: {
      rsi: rsi?.value ?? null,
      macdHistogram: macd?.histogram ?? null,
      emaTrend: ema.trend,
      adx: adx?.adx ?? null,
      atrPercent: atr?.valuePercent ?? null,
    },
    timestamp: Date.now(),
  };
}

/**
 * Quick check if any entry signal is present
 */
export function hasEntrySignal(entry: EntrySignal): boolean {
  return entry.shouldEnter && entry.direction !== 'NONE';
}
