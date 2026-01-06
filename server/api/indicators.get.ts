// server/api/indicators.get.ts

/**
 * Technical Indicators API Endpoint
 *
 * Returns calculated technical indicators for a given timeframe.
 *
 * Query Parameters:
 *   - timeframe: '1s' | '1m' | '2m' | '5m' | '10m' | '30m' | '1h' (default: '1m')
 *   - limit: number of candles to use (default: 50)
 *   - multi: 'true' to get multi-timeframe analysis
 *
 * Examples:
 *   GET /api/indicators?timeframe=5m
 *   GET /api/indicators?timeframe=1m&limit=100
 *   GET /api/indicators?multi=true
 */

import { defineEventHandler, getQuery } from 'h3';
import {
  getIndicatorSnapshot,
  getMultiTimeframeSnapshots,
  getConfluenceScore,
  getTradeRecommendation,
  type Timeframe,
} from '../indicators';

// Valid timeframes
const VALID_TIMEFRAMES: Timeframe[] = ['1s', '1m', '2m', '5m', '10m', '30m', '1h'];

export default defineEventHandler((event) => {
  const query = getQuery(event);

  // Parse query parameters
  const timeframe = (query.timeframe as Timeframe) || '1m';
  const limit = Math.min(Math.max(parseInt(String(query.limit)) || 50, 10), 200);
  const multi = query.multi === 'true';

  // Validate timeframe
  if (!VALID_TIMEFRAMES.includes(timeframe)) {
    return {
      success: false,
      error: `Invalid timeframe. Valid options: ${VALID_TIMEFRAMES.join(', ')}`,
      data: null,
    };
  }

  try {
    // Multi-timeframe mode
    if (multi) {
      const confluence = getConfluenceScore(['1m', '5m', '10m']);
      const recommendation = getTradeRecommendation(timeframe);

      return {
        success: true,
        data: {
          mode: 'multi-timeframe',
          confluence: {
            score: confluence.score,
            direction: confluence.direction,
            agreementCount: confluence.agreementCount,
          },
          recommendation,
          timeframes: {
            '1m': formatSnapshot(confluence.snapshots['1m']),
            '5m': formatSnapshot(confluence.snapshots['5m']),
            '10m': formatSnapshot(confluence.snapshots['10m']),
          },
          timestamp: Date.now(),
        },
      };
    }

    // Single timeframe mode
    const snapshot = getIndicatorSnapshot(timeframe, limit);

    if (!snapshot) {
      return {
        success: false,
        error: 'Insufficient data for indicator calculation',
        data: null,
      };
    }

    const recommendation = getTradeRecommendation(timeframe);

    return {
      success: true,
      data: {
        mode: 'single-timeframe',
        timeframe,
        timestamp: snapshot.timestamp,
        price: snapshot.price,

        // Core indicators
        indicators: {
          ema: {
            ema9: snapshot.ema.ema9?.value ?? null,
            ema21: snapshot.ema.ema21?.value ?? null,
            ema50: snapshot.ema.ema50?.value ?? null,
            ema200: snapshot.ema.ema200?.value ?? null,
            trend: snapshot.ema.trend,
            crossovers: {
              ema9Above21: snapshot.ema.ema9Above21,
              ema21Above50: snapshot.ema.ema21Above50,
              ema50Above200: snapshot.ema.ema50Above200,
            },
          },
          rsi: snapshot.rsi
            ? {
                value: round(snapshot.rsi.value),
                zone: snapshot.rsi.zone,
                isOverbought: snapshot.rsi.isOverbought,
                isOversold: snapshot.rsi.isOversold,
              }
            : null,
          macd: snapshot.macd
            ? {
                macd: round(snapshot.macd.macd),
                signal: round(snapshot.macd.signal),
                histogram: round(snapshot.macd.histogram),
                crossover: snapshot.macd.crossover,
                isAboveSignal: snapshot.macd.isAboveSignal,
              }
            : null,
          bollingerBands: snapshot.bollingerBands
            ? {
                upper: round(snapshot.bollingerBands.upper),
                middle: round(snapshot.bollingerBands.middle),
                lower: round(snapshot.bollingerBands.lower),
                bandwidth: round(snapshot.bollingerBands.bandwidth),
                percentB: round(snapshot.bollingerBands.percentB),
                zone: snapshot.bollingerBands.zone,
              }
            : null,
          atr: snapshot.atr
            ? {
                value: round(snapshot.atr.value),
                valuePercent: round(snapshot.atr.valuePercent),
                volatilityLevel: snapshot.atr.volatilityLevel,
              }
            : null,
        },

        // Volume indicators
        volume: {
          vwap: snapshot.vwap
            ? {
                value: round(snapshot.vwap.value),
                priceVsVwap: round(snapshot.vwap.priceVsVwap),
                isAboveVwap: snapshot.vwap.isAboveVwap,
              }
            : null,
          pressure: snapshot.volumePressure
            ? {
                buyRatio: round(snapshot.volumePressure.buyRatio),
                dominance: snapshot.volumePressure.dominance,
              }
            : null,
          spike: snapshot.volumeSpike
            ? {
                ratio: round(snapshot.volumeSpike.ratio),
                isSpike: snapshot.volumeSpike.isSpike,
              }
            : null,
        },

        // Trading signals
        signals: {
          individual: {
            rsi: round(snapshot.signals.rsiSignal),
            macd: round(snapshot.signals.macdSignal),
            ema: round(snapshot.signals.emaSignal),
            bollinger: round(snapshot.signals.bollingerSignal),
            volume: round(snapshot.signals.volumeSignal),
          },
          composite: {
            score: round(snapshot.signals.compositeScore),
            recommendation: snapshot.signals.recommendation,
            confidence: round(snapshot.signals.confidence),
          },
        },

        // Trade recommendation
        recommendation,
      },
    };
  } catch (error) {
    console.error('[IndicatorsAPI] Error:', error);
    return {
      success: false,
      error: 'Failed to calculate indicators',
      data: null,
    };
  }
});

// Helper to round numbers for cleaner JSON
function round(value: number, decimals: number = 4): number {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

// Format snapshot for multi-timeframe response
function formatSnapshot(snapshot: ReturnType<typeof getIndicatorSnapshot>) {
  if (!snapshot) return null;

  return {
    price: snapshot.price,
    signals: {
      score: round(snapshot.signals.compositeScore),
      recommendation: snapshot.signals.recommendation,
      confidence: round(snapshot.signals.confidence),
    },
    rsi: snapshot.rsi ? round(snapshot.rsi.value) : null,
    emaTrend: snapshot.ema.trend,
    macdCrossover: snapshot.macd?.crossover ?? 'none',
  };
}
