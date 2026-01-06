// server/indicators/core.ts

/**
 * Core Technical Indicator Calculations
 *
 * Professional-grade implementations of standard technical indicators.
 * All calculations follow industry-standard formulas used by TradingView,
 * Bloomberg, and institutional trading systems.
 */

import type {
  Candle,
  EMAResult,
  SMAResult,
  RSIResult,
  MACDResult,
  BollingerBandsResult,
  ATRResult,
  EMACollection,
} from './types';
import { DEFAULT_PARAMS } from './types';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Extract closing prices from candles
 */
export function getClosingPrices(candles: Candle[]): number[] {
  return candles.map((c) => c.close);
}

/**
 * Calculate standard deviation
 */
export function standardDeviation(values: number[], mean?: number): number {
  if (values.length === 0) return 0;

  const avg = mean ?? values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map((v) => Math.pow(v - avg, 2));
  const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;

  return Math.sqrt(avgSquaredDiff);
}

/**
 * Calculate True Range for a single candle
 * TR = max(high - low, |high - prevClose|, |low - prevClose|)
 */
export function trueRange(current: Candle, previous: Candle | null): number {
  const highLow = current.high - current.low;

  if (!previous) {
    return highLow;
  }

  const highPrevClose = Math.abs(current.high - previous.close);
  const lowPrevClose = Math.abs(current.low - previous.close);

  return Math.max(highLow, highPrevClose, lowPrevClose);
}

// ============================================================================
// SIMPLE MOVING AVERAGE (SMA)
// ============================================================================

/**
 * Calculate Simple Moving Average
 *
 * SMA = Sum of prices over period / period
 *
 * @param candles - Array of candles (newest first)
 * @param period - Number of periods
 * @returns SMA result or null if insufficient data
 */
export function calculateSMA(candles: Candle[], period: number): SMAResult | null {
  if (candles.length < period) {
    return null;
  }

  // Take the most recent 'period' candles
  const relevantCandles = candles.slice(0, period);
  const sum = relevantCandles.reduce((acc, c) => acc + c.close, 0);
  const value = sum / period;

  return {
    value,
    period,
    timestamp: candles[0]?.timestamp || Date.now(),
  };
}

/**
 * Calculate SMA series for all available points
 */
export function calculateSMASeries(candles: Candle[], period: number): number[] {
  const result: number[] = [];

  for (let i = 0; i <= candles.length - period; i++) {
    const slice = candles.slice(i, i + period);
    const sum = slice.reduce((acc, c) => acc + c.close, 0);
    result.push(sum / period);
  }

  return result;
}

// ============================================================================
// EXPONENTIAL MOVING AVERAGE (EMA)
// ============================================================================

/**
 * Calculate Exponential Moving Average
 *
 * EMA = (Price * k) + (Previous EMA * (1 - k))
 * where k = 2 / (period + 1)
 *
 * The EMA gives more weight to recent prices, making it more responsive
 * to new information than the SMA.
 *
 * @param candles - Array of candles (newest first)
 * @param period - Number of periods
 * @returns EMA result or null if insufficient data
 */
export function calculateEMA(candles: Candle[], period: number): EMAResult | null {
  if (candles.length < period) {
    return null;
  }

  // Reverse to oldest-first for calculation
  const prices = getClosingPrices(candles).reverse();
  const k = 2 / (period + 1);

  // Start with SMA of first 'period' prices
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;

  // Calculate EMA for remaining prices
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }

  return {
    value: ema,
    period,
    timestamp: candles[0]?.timestamp || Date.now(),
  };
}

/**
 * Calculate EMA series for charting
 * Returns array from newest to oldest
 */
export function calculateEMASeries(candles: Candle[], period: number): number[] {
  if (candles.length < period) {
    return [];
  }

  // Reverse to oldest-first for calculation
  const prices = getClosingPrices(candles).reverse();
  const k = 2 / (period + 1);
  const result: number[] = [];

  // Start with SMA of first 'period' prices
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(ema);

  // Calculate EMA for remaining prices
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
    result.push(ema);
  }

  // Reverse back to newest-first
  return result.reverse();
}

/**
 * Calculate all standard EMA periods with crossover analysis
 */
export function calculateEMACollection(
  candles: Candle[],
  periods: number[] = DEFAULT_PARAMS.emaPeriods
): EMACollection {
  const ema9 = calculateEMA(candles, periods[0] || 9);
  const ema21 = calculateEMA(candles, periods[1] || 21);
  const ema50 = calculateEMA(candles, periods[2] || 50);
  const ema200 = calculateEMA(candles, periods[3] || 200);

  // Calculate crossover states (only if both EMAs exist)
  const ema9Above21 = ema9 && ema21 ? ema9.value > ema21.value : false;
  const ema21Above50 = ema21 && ema50 ? ema21.value > ema50.value : false;
  const ema50Above200 = ema50 && ema200 ? ema50.value > ema200.value : false;

  // Determine overall trend
  let trend: EMACollection['trend'] = 'neutral';

  // Only determine trend if we have at least the short-term EMAs
  if (ema9 && ema21) {
    if (ema9Above21 && ema21Above50 && ema50Above200) {
      trend = 'strong_bullish';
    } else if (ema9Above21 && ema21Above50) {
      trend = 'bullish';
    } else if (!ema9Above21 && !ema21Above50 && ema50 !== null && ema200 !== null && !ema50Above200) {
      trend = 'strong_bearish';
    } else if (!ema9Above21 && !ema21Above50 && ema50 !== null) {
      trend = 'bearish';
    } else if (ema9Above21) {
      trend = 'bullish';
    } else if (!ema9Above21) {
      trend = 'bearish';
    }
  }

  return {
    ema9,
    ema21,
    ema50,
    ema200,
    ema9Above21,
    ema21Above50,
    ema50Above200,
    trend,
  };
}

// ============================================================================
// RELATIVE STRENGTH INDEX (RSI)
// ============================================================================

/**
 * Calculate Relative Strength Index
 *
 * RSI = 100 - (100 / (1 + RS))
 * where RS = Average Gain / Average Loss over period
 *
 * Uses Wilder's smoothing method (exponential smoothing)
 *
 * @param candles - Array of candles (newest first)
 * @param period - Number of periods (default: 14)
 * @returns RSI result or null if insufficient data
 */
export function calculateRSI(
  candles: Candle[],
  period: number = DEFAULT_PARAMS.rsiPeriod,
  overbought: number = DEFAULT_PARAMS.rsiOverbought,
  oversold: number = DEFAULT_PARAMS.rsiOversold
): RSIResult | null {
  // Need period + 1 candles minimum for price changes
  if (candles.length < period + 1) {
    return null;
  }

  // Reverse to oldest-first
  const prices = getClosingPrices(candles).reverse();

  // Calculate price changes
  const changes: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }

  // Separate gains and losses
  const gains = changes.map((c) => (c > 0 ? c : 0));
  const losses = changes.map((c) => (c < 0 ? Math.abs(c) : 0));

  // Calculate initial average gain and loss (SMA)
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

  // Apply Wilder's smoothing for remaining periods
  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
  }

  // Calculate RSI
  let rsi: number;
  if (avgLoss === 0) {
    rsi = 100;
  } else {
    const rs = avgGain / avgLoss;
    rsi = 100 - 100 / (1 + rs);
  }

  // Determine zone
  let zone: RSIResult['zone'] = 'neutral';
  if (rsi >= overbought) zone = 'overbought';
  else if (rsi <= oversold) zone = 'oversold';

  return {
    value: rsi,
    period,
    timestamp: candles[0]?.timestamp || Date.now(),
    isOverbought: rsi >= overbought,
    isOversold: rsi <= oversold,
    zone,
  };
}

// ============================================================================
// MACD (Moving Average Convergence Divergence)
// ============================================================================

/**
 * Calculate MACD
 *
 * MACD Line = Fast EMA - Slow EMA
 * Signal Line = EMA of MACD Line
 * Histogram = MACD Line - Signal Line
 *
 * Standard settings: 12, 26, 9
 *
 * @param candles - Array of candles (newest first)
 * @param fastPeriod - Fast EMA period (default: 12)
 * @param slowPeriod - Slow EMA period (default: 26)
 * @param signalPeriod - Signal EMA period (default: 9)
 * @returns MACD result or null if insufficient data
 */
export function calculateMACD(
  candles: Candle[],
  fastPeriod: number = DEFAULT_PARAMS.macdFast,
  slowPeriod: number = DEFAULT_PARAMS.macdSlow,
  signalPeriod: number = DEFAULT_PARAMS.macdSignal
): MACDResult | null {
  // Need enough candles for slow EMA + signal period
  const minCandles = slowPeriod + signalPeriod;
  if (candles.length < minCandles) {
    return null;
  }

  // Calculate MACD line series (oldest to newest internally)
  const prices = getClosingPrices(candles).reverse();
  const kFast = 2 / (fastPeriod + 1);
  const kSlow = 2 / (slowPeriod + 1);
  const kSignal = 2 / (signalPeriod + 1);

  // Initialize EMAs with SMAs
  let fastEMA = prices.slice(0, fastPeriod).reduce((a, b) => a + b, 0) / fastPeriod;
  let slowEMA = prices.slice(0, slowPeriod).reduce((a, b) => a + b, 0) / slowPeriod;

  const macdLine: number[] = [];

  // Calculate EMAs and MACD line
  for (let i = slowPeriod; i < prices.length; i++) {
    // Update fast EMA
    if (i >= fastPeriod) {
      fastEMA = prices[i] * kFast + fastEMA * (1 - kFast);
    } else {
      fastEMA = prices.slice(0, i + 1).reduce((a, b) => a + b, 0) / (i + 1);
    }

    // Update slow EMA
    slowEMA = prices[i] * kSlow + slowEMA * (1 - kSlow);

    macdLine.push(fastEMA - slowEMA);
  }

  if (macdLine.length < signalPeriod) {
    return null;
  }

  // Calculate signal line (EMA of MACD)
  let signalLine = macdLine.slice(0, signalPeriod).reduce((a, b) => a + b, 0) / signalPeriod;

  for (let i = signalPeriod; i < macdLine.length; i++) {
    signalLine = macdLine[i] * kSignal + signalLine * (1 - kSignal);
  }

  const currentMACD = macdLine[macdLine.length - 1];
  const previousMACD = macdLine.length > 1 ? macdLine[macdLine.length - 2] : currentMACD;
  const histogram = currentMACD - signalLine;

  // Detect crossover (compare current and previous positions relative to signal)
  // This is simplified - for proper crossover detection we'd need signal line history
  let crossover: MACDResult['crossover'] = 'none';

  // Check if we have enough history for crossover detection
  if (macdLine.length >= signalPeriod + 1) {
    // Recalculate previous signal line
    let prevSignal = macdLine.slice(0, signalPeriod).reduce((a, b) => a + b, 0) / signalPeriod;
    for (let i = signalPeriod; i < macdLine.length - 1; i++) {
      prevSignal = macdLine[i] * kSignal + prevSignal * (1 - kSignal);
    }

    const wasAbove = previousMACD > prevSignal;
    const isAbove = currentMACD > signalLine;

    if (!wasAbove && isAbove) {
      crossover = 'bullish';
    } else if (wasAbove && !isAbove) {
      crossover = 'bearish';
    }
  }

  return {
    macd: currentMACD,
    signal: signalLine,
    histogram,
    timestamp: candles[0]?.timestamp || Date.now(),
    isAboveSignal: currentMACD > signalLine,
    isBelowSignal: currentMACD < signalLine,
    crossover,
  };
}

// ============================================================================
// BOLLINGER BANDS
// ============================================================================

/**
 * Calculate Bollinger Bands
 *
 * Middle Band = SMA(period)
 * Upper Band = Middle + (k * stddev)
 * Lower Band = Middle - (k * stddev)
 *
 * Standard settings: period=20, k=2
 *
 * @param candles - Array of candles (newest first)
 * @param period - SMA period (default: 20)
 * @param stdDevMultiplier - Standard deviation multiplier (default: 2)
 * @param currentPrice - Current price for %B calculation
 * @returns Bollinger Bands result or null if insufficient data
 */
export function calculateBollingerBands(
  candles: Candle[],
  period: number = DEFAULT_PARAMS.bbPeriod,
  stdDevMultiplier: number = DEFAULT_PARAMS.bbStdDev,
  currentPrice?: number
): BollingerBandsResult | null {
  if (candles.length < period) {
    return null;
  }

  const prices = candles.slice(0, period).map((c) => c.close);
  const price = currentPrice ?? candles[0].close;

  // Calculate middle band (SMA)
  const middle = prices.reduce((a, b) => a + b, 0) / period;

  // Calculate standard deviation
  const stdDev = standardDeviation(prices, middle);

  // Calculate bands
  const upper = middle + stdDevMultiplier * stdDev;
  const lower = middle - stdDevMultiplier * stdDev;

  // Calculate bandwidth and %B
  const bandwidth = ((upper - lower) / middle) * 100;
  const percentB = upper !== lower ? (price - lower) / (upper - lower) : 0.5;

  // Determine zone
  let zone: BollingerBandsResult['zone'] = 'middle';
  if (price > upper) zone = 'above_upper';
  else if (price < lower) zone = 'below_lower';

  return {
    upper,
    middle,
    lower,
    bandwidth,
    percentB,
    timestamp: candles[0]?.timestamp || Date.now(),
    isAboveUpper: price > upper,
    isBelowLower: price < lower,
    zone,
  };
}

// ============================================================================
// AVERAGE TRUE RANGE (ATR)
// ============================================================================

/**
 * Calculate Average True Range
 *
 * TR = max(high - low, |high - prevClose|, |low - prevClose|)
 * ATR = EMA of TR over period (using Wilder's smoothing)
 *
 * ATR measures volatility without regard for direction
 *
 * @param candles - Array of candles (newest first)
 * @param period - ATR period (default: 14)
 * @param currentPrice - Current price for percentage calculation
 * @returns ATR result or null if insufficient data
 */
export function calculateATR(
  candles: Candle[],
  period: number = DEFAULT_PARAMS.atrPeriod,
  currentPrice?: number
): ATRResult | null {
  if (candles.length < period + 1) {
    return null;
  }

  // Reverse to oldest-first
  const reversed = [...candles].reverse();

  // Calculate True Range for each candle
  const trValues: number[] = [];
  for (let i = 1; i < reversed.length; i++) {
    trValues.push(trueRange(reversed[i], reversed[i - 1]));
  }

  if (trValues.length < period) {
    return null;
  }

  // Calculate initial ATR (SMA of first 'period' TRs)
  let atr = trValues.slice(0, period).reduce((a, b) => a + b, 0) / period;

  // Apply Wilder's smoothing
  for (let i = period; i < trValues.length; i++) {
    atr = (atr * (period - 1) + trValues[i]) / period;
  }

  const price = currentPrice ?? candles[0].close;
  const valuePercent = (atr / price) * 100;

  // Classify volatility level based on ATR percentage
  // These thresholds are calibrated for crypto (higher volatility than stocks)
  let volatilityLevel: ATRResult['volatilityLevel'] = 'normal';
  if (valuePercent < 0.3) {
    volatilityLevel = 'low';
  } else if (valuePercent > 1.5) {
    volatilityLevel = 'extreme';
  } else if (valuePercent > 0.8) {
    volatilityLevel = 'high';
  }

  return {
    value: atr,
    valuePercent,
    period,
    timestamp: candles[0]?.timestamp || Date.now(),
    volatilityLevel,
  };
}

// ============================================================================
// ADX (Average Directional Index)
// ============================================================================

/**
 * ADX Result - measures trend STRENGTH (not direction)
 */
export interface ADXResult {
  adx: number;                    // ADX value (0-100)
  plusDI: number;                 // +DI (bullish directional indicator)
  minusDI: number;                // -DI (bearish directional indicator)
  period: number;
  timestamp: number;
  // Interpretation
  trendStrength: 'none' | 'weak' | 'moderate' | 'strong' | 'extreme';
  trendDirection: 'bullish' | 'bearish' | 'neutral';
}

/**
 * Calculate Average Directional Index
 *
 * ADX measures trend STRENGTH, not direction:
 * - ADX < 20: No trend (ranging market)
 * - ADX 20-25: Weak trend
 * - ADX 25-50: Strong trend
 * - ADX 50-75: Very strong trend
 * - ADX > 75: Extremely strong trend
 *
 * +DI vs -DI indicates direction:
 * - +DI > -DI: Bullish trend
 * - -DI > +DI: Bearish trend
 *
 * @param candles - Array of candles (newest first)
 * @param period - ADX period (default: 14)
 * @returns ADX result or null if insufficient data
 */
export function calculateADX(
  candles: Candle[],
  period: number = 14
): ADXResult | null {
  // Need period * 2 + 1 candles minimum for proper ADX calculation
  if (candles.length < period * 2 + 1) {
    return null;
  }

  // Reverse to oldest-first for calculation
  const reversed = [...candles].reverse();

  // Calculate +DM, -DM, and TR for each candle
  const plusDM: number[] = [];
  const minusDM: number[] = [];
  const trueRanges: number[] = [];

  for (let i = 1; i < reversed.length; i++) {
    const current = reversed[i];
    const previous = reversed[i - 1];

    // Directional Movement
    const upMove = current.high - previous.high;
    const downMove = previous.low - current.low;

    // +DM: If upMove > downMove AND upMove > 0
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);

    // -DM: If downMove > upMove AND downMove > 0
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);

    // True Range
    trueRanges.push(trueRange(current, previous));
  }

  if (trueRanges.length < period) {
    return null;
  }

  // Calculate smoothed averages using Wilder's smoothing
  const smoothTR: number[] = [];
  const smoothPlusDM: number[] = [];
  const smoothMinusDM: number[] = [];

  // First smoothed value is sum of first 'period' values
  let sumTR = trueRanges.slice(0, period).reduce((a, b) => a + b, 0);
  let sumPlusDM = plusDM.slice(0, period).reduce((a, b) => a + b, 0);
  let sumMinusDM = minusDM.slice(0, period).reduce((a, b) => a + b, 0);

  smoothTR.push(sumTR);
  smoothPlusDM.push(sumPlusDM);
  smoothMinusDM.push(sumMinusDM);

  // Wilder's smoothing for remaining values
  for (let i = period; i < trueRanges.length; i++) {
    sumTR = sumTR - sumTR / period + trueRanges[i];
    sumPlusDM = sumPlusDM - sumPlusDM / period + plusDM[i];
    sumMinusDM = sumMinusDM - sumMinusDM / period + minusDM[i];

    smoothTR.push(sumTR);
    smoothPlusDM.push(sumPlusDM);
    smoothMinusDM.push(sumMinusDM);
  }

  // Calculate +DI and -DI
  const plusDI: number[] = [];
  const minusDI: number[] = [];
  const dx: number[] = [];

  for (let i = 0; i < smoothTR.length; i++) {
    const pdi = smoothTR[i] > 0 ? (smoothPlusDM[i] / smoothTR[i]) * 100 : 0;
    const mdi = smoothTR[i] > 0 ? (smoothMinusDM[i] / smoothTR[i]) * 100 : 0;

    plusDI.push(pdi);
    minusDI.push(mdi);

    // DX = |+DI - -DI| / (+DI + -DI) * 100
    const diSum = pdi + mdi;
    dx.push(diSum > 0 ? (Math.abs(pdi - mdi) / diSum) * 100 : 0);
  }

  if (dx.length < period) {
    return null;
  }

  // Calculate ADX as smoothed average of DX
  let adx = dx.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < dx.length; i++) {
    adx = (adx * (period - 1) + dx[i]) / period;
  }

  const currentPlusDI = plusDI[plusDI.length - 1];
  const currentMinusDI = minusDI[minusDI.length - 1];

  // Determine trend strength
  let trendStrength: ADXResult['trendStrength'] = 'none';
  if (adx >= 50) trendStrength = 'extreme';
  else if (adx >= 35) trendStrength = 'strong';
  else if (adx >= 25) trendStrength = 'moderate';
  else if (adx >= 20) trendStrength = 'weak';

  // Determine trend direction
  let trendDirection: ADXResult['trendDirection'] = 'neutral';
  if (currentPlusDI > currentMinusDI + 2) trendDirection = 'bullish';
  else if (currentMinusDI > currentPlusDI + 2) trendDirection = 'bearish';

  return {
    adx,
    plusDI: currentPlusDI,
    minusDI: currentMinusDI,
    period,
    timestamp: candles[0]?.timestamp || Date.now(),
    trendStrength,
    trendDirection,
  };
}

// ============================================================================
// UTILITY: Calculate All Core Indicators
// ============================================================================

export interface CoreIndicators {
  ema: EMACollection;
  rsi: RSIResult | null;
  macd: MACDResult | null;
  bollingerBands: BollingerBandsResult | null;
  atr: ATRResult | null;
  adx: ADXResult | null;
}

/**
 * Calculate all core indicators at once
 */
export function calculateAllCoreIndicators(
  candles: Candle[],
  currentPrice?: number
): CoreIndicators {
  return {
    ema: calculateEMACollection(candles),
    rsi: calculateRSI(candles),
    macd: calculateMACD(candles),
    bollingerBands: calculateBollingerBands(candles, undefined, undefined, currentPrice),
    atr: calculateATR(candles, undefined, currentPrice),
    adx: calculateADX(candles),
  };
}
