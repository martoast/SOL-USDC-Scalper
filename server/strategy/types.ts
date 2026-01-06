// server/strategy/types.ts

/**
 * Trading Strategy Types
 *
 * Defines the core types for the intelligent trading strategy system.
 */

// ============================================================================
// MARKET REGIME
// ============================================================================

/**
 * Market regime classification
 */
export type MarketRegime = 'trending_bullish' | 'trending_bearish' | 'ranging' | 'volatile' | 'unknown';

/**
 * Complete market regime analysis
 */
export interface MarketRegimeAnalysis {
  regime: MarketRegime;
  confidence: number;          // 0-100
  adxValue: number | null;
  volatilityLevel: string;
  trendStrength: string;
  recommendation: string;      // Strategy recommendation for this regime
}

// ============================================================================
// ENTRY SIGNALS
// ============================================================================

/**
 * Entry signal for opening a position
 */
export interface EntrySignal {
  shouldEnter: boolean;
  direction: 'LONG' | 'SHORT' | 'NONE';
  confidence: number;          // 0-100
  score: number;               // -100 to +100 composite score

  // Dynamic levels based on ATR
  suggestedStopLoss: number;   // Price level
  suggestedTakeProfit: number; // Price level
  stopLossPercent: number;     // As percentage
  takeProfitPercent: number;   // As percentage

  // Position sizing
  suggestedSizeMultiplier: number;  // 0.5x to 1.5x base size

  // Supporting data
  reasons: string[];           // Why this signal was generated
  warnings: string[];          // Any concerns

  // Indicator values for display
  indicators: {
    rsi: number | null;
    macdHistogram: number | null;
    emaTrend: string;
    adx: number | null;
    atrPercent: number | null;
  };

  timestamp: number;
}

// ============================================================================
// EXIT SIGNALS
// ============================================================================

/**
 * Exit signal for closing a position
 */
export interface ExitSignal {
  shouldExit: boolean;
  reason: ExitReason;
  urgency: 'low' | 'medium' | 'high' | 'critical';

  // Trailing stop info
  trailingStopPrice: number | null;
  trailingStopTriggered: boolean;

  // Current P&L context
  currentPnLPercent: number;
  maxPnLPercent: number;       // Maximum P&L reached (for trailing)

  explanation: string;
  timestamp: number;
}

export type ExitReason =
  | 'TAKE_PROFIT'
  | 'STOP_LOSS'
  | 'TRAILING_STOP'
  | 'SIGNAL_REVERSAL'         // Indicators flipped against position
  | 'REGIME_CHANGE'           // Market regime changed
  | 'TIME_STOP'               // Position held too long
  | 'VOLATILITY_SPIKE'        // Sudden volatility increase
  | 'MANUAL'
  | 'NONE';

// ============================================================================
// POSITION TRACKING
// ============================================================================

/**
 * Active position for exit signal calculation
 */
export interface ActivePosition {
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  entryTime: number;
  size: number;

  // Dynamic stops
  initialStopLoss: number;
  currentStopLoss: number;     // May have been trailed
  takeProfit: number;

  // Tracking
  maxPrice: number;            // Highest price since entry (for trailing)
  minPrice: number;            // Lowest price since entry (for trailing)
  maxPnLPercent: number;       // Best P&L achieved
}

// ============================================================================
// STRATEGY CONFIGURATION
// ============================================================================

/**
 * Strategy parameters (configurable)
 */
export interface StrategyConfig {
  // Entry
  minConfidenceToEnter: number;        // Minimum confidence score (default: 50)
  minScoreToEnter: number;             // Minimum composite score (default: 25)

  // Exit - ATR multipliers
  atrStopLossMultiplier: number;       // SL = ATR * this (default: 1.5)
  atrTakeProfitMultiplier: number;     // TP = ATR * this (default: 2.0)

  // Trailing stop
  enableTrailingStop: boolean;
  trailingStopActivationPercent: number; // Activate after X% profit (default: 0.5)
  trailingStopDistancePercent: number;   // Trail by X% (default: 0.3)

  // Time stop
  maxHoldTimeSeconds: number;          // Max time in position (default: 300)

  // Position sizing
  basePositionSize: number;            // Base size in SOL
  maxPositionSizeMultiplier: number;   // Max size = base * this (default: 1.5)
  minPositionSizeMultiplier: number;   // Min size = base * this (default: 0.5)

  // Regime filters
  enableRegimeFilter: boolean;         // Don't trade in unfavorable regimes
  allowTradingInRanging: boolean;      // Trade in ranging markets

  // Multi-timeframe
  requireMultiTimeframeConfirmation: boolean;
  timeframesToCheck: string[];
}

/**
 * Default strategy configuration
 *
 * IMPORTANT: These values are calibrated for REALISTIC trading with fees!
 * Round-trip costs are approximately 0.6-0.7%, so:
 * - TP must be > 1% to have meaningful profit after fees
 * - SL should be reasonable to maintain good risk:reward
 */
export const DEFAULT_STRATEGY_CONFIG: StrategyConfig = {
  // Entry - Require stronger signals to avoid whipsaw
  minConfidenceToEnter: 60, // Need decent confidence
  minScoreToEnter: 20, // Need clear directional bias (was 8, too low)

  // Exit - ATR multipliers (tuned for ~1.5% TP, ~0.8% SL typical)
  atrStopLossMultiplier: 2.0, // ~0.8-1% SL with normal ATR
  atrTakeProfitMultiplier: 4.0, // ~1.5-2% TP with normal ATR (need > 0.7% to profit!)

  // Trailing stop (helps lock in profits on winners)
  enableTrailingStop: true,
  trailingStopActivationPercent: 0.8, // Activate after 0.8% profit
  trailingStopDistancePercent: 0.4, // Trail by 0.4%

  // Time stop (exit stale positions)
  maxHoldTimeSeconds: 1800, // 30 minutes max hold (need time to hit TP)

  // Position sizing
  basePositionSize: 0.1,
  maxPositionSizeMultiplier: 1.5,
  minPositionSizeMultiplier: 0.5,

  // Regime filters
  enableRegimeFilter: false, // Disable regime blocking to get more trades
  allowTradingInRanging: true, // Allow trading in ranging markets

  // Multi-timeframe
  requireMultiTimeframeConfirmation: false,
  timeframesToCheck: ['1m', '5m'],
};

// ============================================================================
// COMPLETE STRATEGY OUTPUT
// ============================================================================

// ============================================================================
// TRADABILITY STATUS
// ============================================================================

/**
 * Market tradability gate result
 */
export interface TradabilityStatus {
  isTradable: boolean;
  reason: string | null;          // null if tradable, otherwise why not
  checks: {
    volatility: { passed: boolean; value: number | null; threshold: string };
    trendStrength: { passed: boolean; value: number | null; threshold: string };
    rangeCompression: { passed: boolean; value: number | null; threshold: string };
  };
  timestamp: number;
}

/**
 * Trade throttle status
 */
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

/**
 * Entry confirmation status (1m execution timeframe)
 */
export interface EntryConfirmation {
  confirmed: boolean;
  reason: string | null;          // null if confirmed, otherwise why not
  checks: {
    rangeCheck: { passed: boolean; value: number | null; threshold: string };
    momentumCheck: { passed: boolean; direction: string | null };
    exhaustionCheck: { passed: boolean; rsiValue: number | null; threshold: string };
  };
  timestamp: number;
}

// ============================================================================
// COMPLETE STRATEGY OUTPUT
// ============================================================================

/**
 * Complete strategy analysis for API response
 */
export interface StrategyAnalysis {
  // Tradability gate (top-level check)
  tradability: TradabilityStatus;

  // Throttle status (cooldowns & limits)
  throttle: ThrottleStatus;

  // Entry confirmation (1m execution check)
  entryConfirmation: EntryConfirmation | null;

  // Market context
  regime: MarketRegimeAnalysis;

  // Entry signal (when not in position)
  entry: EntrySignal;

  // Exit signal (when in position)
  exit: ExitSignal | null;

  // Current market data
  currentPrice: number;
  timestamp: number;

  // Configuration used
  config: StrategyConfig;
}
