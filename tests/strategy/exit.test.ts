// tests/strategy/exit.test.ts

import { describe, it, expect } from 'vitest';
import {
  generateExitSignal,
  updatePositionTracking,
  createPosition,
} from '../../server/strategy/exit';
import { DEFAULT_STRATEGY_CONFIG } from '../../server/strategy/types';
import type { IndicatorSnapshot } from '../../server/indicators/types';
import type { ActivePosition, MarketRegimeAnalysis } from '../../server/strategy/types';

// Helper to create mock snapshot
function createMockSnapshot(overrides: Partial<IndicatorSnapshot> = {}): IndicatorSnapshot {
  return {
    timeframe: '1m',
    timestamp: Date.now(),
    price: 200,
    ema: {
      ema9: 200,
      ema21: 199,
      ema50: 198,
      ema200: 195,
      trend: 'bullish',
      shortTermMomentum: 0.5,
      mediumTermMomentum: 0.3,
    },
    rsi: {
      value: 55,
      zone: 'neutral',
      isOverbought: false,
      isOversold: false,
      divergence: 'none',
    },
    macd: {
      macd: 0.5,
      signal: 0.3,
      histogram: 0.2,
      trend: 'bullish',
      crossover: 'none',
      isAboveSignal: true,
      isBelowSignal: false,
      histogramDirection: 'expanding',
    },
    bollingerBands: {
      upper: 205,
      middle: 200,
      lower: 195,
      width: 5,
      percentB: 0.5,
      zone: 'middle',
      squeeze: false,
    },
    atr: {
      value: 2,
      valuePercent: 1,
      volatilityLevel: 'normal',
      avgVolatility: 1.8,
    },
    adx: {
      adx: 30,
      plusDI: 25,
      minusDI: 15,
      trendStrength: 'moderate',
      trendDirection: 'bullish',
    },
    vwap: {
      vwap: 199,
      deviation: 0.5,
      position: 'above',
    },
    volumePressure: {
      buyVolume: 60,
      sellVolume: 40,
      ratio: 1.5,
      dominance: 'buyers',
      netPressure: 20,
    },
    signals: {
      compositeScore: 25,
      direction: 'bullish',
      strength: 'moderate',
      confidence: 65,
      components: {
        rsi: 10,
        macd: 15,
        ema: 20,
        bollinger: 5,
        volume: 10,
      },
    },
    candleCount: 100,
    ...overrides,
  };
}

function createLongPosition(overrides: Partial<ActivePosition> = {}): ActivePosition {
  return {
    direction: 'LONG',
    entryPrice: 200,
    entryTime: Date.now() - 60000, // 1 minute ago
    size: 0.1,
    initialStopLoss: 197,
    currentStopLoss: 197,
    takeProfit: 206,
    maxPrice: 200, // Same as entry - no profit yet
    minPrice: 199,
    maxPnLPercent: 0, // No profit yet - won't trigger trailing stop
    ...overrides,
  };
}

function createShortPosition(overrides: Partial<ActivePosition> = {}): ActivePosition {
  return {
    direction: 'SHORT',
    entryPrice: 200,
    entryTime: Date.now() - 60000, // 1 minute ago
    size: 0.1,
    initialStopLoss: 203,
    currentStopLoss: 203,
    takeProfit: 194,
    maxPrice: 201,
    minPrice: 200, // Same as entry - no profit yet
    maxPnLPercent: 0, // No profit yet - won't trigger trailing stop
    ...overrides,
  };
}

function createNormalRegime(): MarketRegimeAnalysis {
  return {
    regime: 'trending_bullish',
    confidence: 70,
    adxValue: 35,
    volatilityLevel: 'normal',
    trendStrength: 'strong',
    recommendation: 'Hold',
  };
}

function createVolatileRegime(): MarketRegimeAnalysis {
  return {
    regime: 'volatile',
    confidence: 85,
    adxValue: 35,
    volatilityLevel: 'extreme',
    trendStrength: 'strong',
    recommendation: 'Exit',
  };
}

describe('Exit Signal Generator', () => {
  describe('generateExitSignal', () => {
    it('should trigger STOP_LOSS for LONG when price drops below stop', () => {
      const snapshot = createMockSnapshot();
      const position = createLongPosition({
        currentStopLoss: 198,
      });
      const regime = createNormalRegime();

      const exit = generateExitSignal(snapshot, position, 197, regime, DEFAULT_STRATEGY_CONFIG);

      expect(exit.shouldExit).toBe(true);
      expect(exit.reason).toBe('STOP_LOSS');
      expect(exit.urgency).toBe('critical');
    });

    it('should trigger STOP_LOSS for SHORT when price rises above stop', () => {
      const snapshot = createMockSnapshot();
      const position = createShortPosition({
        currentStopLoss: 202,
      });
      const regime = createNormalRegime();

      const exit = generateExitSignal(snapshot, position, 203, regime, DEFAULT_STRATEGY_CONFIG);

      expect(exit.shouldExit).toBe(true);
      expect(exit.reason).toBe('STOP_LOSS');
      expect(exit.urgency).toBe('critical');
    });

    it('should trigger TAKE_PROFIT for LONG when price exceeds target', () => {
      const snapshot = createMockSnapshot();
      const position = createLongPosition({
        takeProfit: 205,
      });
      const regime = createNormalRegime();

      const exit = generateExitSignal(snapshot, position, 206, regime, DEFAULT_STRATEGY_CONFIG);

      expect(exit.shouldExit).toBe(true);
      expect(exit.reason).toBe('TAKE_PROFIT');
      expect(exit.urgency).toBe('high');
    });

    it('should trigger TAKE_PROFIT for SHORT when price drops below target', () => {
      const snapshot = createMockSnapshot();
      const position = createShortPosition({
        takeProfit: 195,
      });
      const regime = createNormalRegime();

      const exit = generateExitSignal(snapshot, position, 194, regime, DEFAULT_STRATEGY_CONFIG);

      expect(exit.shouldExit).toBe(true);
      expect(exit.reason).toBe('TAKE_PROFIT');
    });

    it('should trigger TRAILING_STOP for LONG when enabled and activated', () => {
      const snapshot = createMockSnapshot();
      const position = createLongPosition({
        maxPrice: 205, // Price went up 2.5%
        maxPnLPercent: 2.5,
      });
      const regime = createNormalRegime();
      const config = {
        ...DEFAULT_STRATEGY_CONFIG,
        enableTrailingStop: true,
        trailingStopActivationPercent: 0.5,
        trailingStopDistancePercent: 0.3,
      };

      // Price has pulled back from max
      const currentPrice = 204.2; // 0.4% below max, trailing is 0.3%
      const exit = generateExitSignal(snapshot, position, currentPrice, regime, config);

      expect(exit.shouldExit).toBe(true);
      expect(exit.reason).toBe('TRAILING_STOP');
    });

    it('should trigger SIGNAL_REVERSAL for LONG when indicators turn bearish', () => {
      const snapshot = createMockSnapshot({
        signals: {
          compositeScore: -40,
          direction: 'bearish',
          strength: 'strong',
          confidence: 75,
          components: {
            rsi: -15,
            macd: -20,
            ema: -25,
            bollinger: -10,
            volume: -15,
          },
        },
      });
      const position = createLongPosition();
      const regime = createNormalRegime();

      const exit = generateExitSignal(snapshot, position, 201, regime, DEFAULT_STRATEGY_CONFIG);

      expect(exit.shouldExit).toBe(true);
      expect(exit.reason).toBe('SIGNAL_REVERSAL');
      expect(exit.urgency).toBe('medium');
    });

    it('should trigger SIGNAL_REVERSAL for LONG when RSI extremely overbought', () => {
      const snapshot = createMockSnapshot({
        rsi: {
          value: 85,
          zone: 'overbought',
          isOverbought: true,
          isOversold: false,
          divergence: 'none',
        },
      });
      const position = createLongPosition();
      const regime = createNormalRegime();

      const exit = generateExitSignal(snapshot, position, 205, regime, DEFAULT_STRATEGY_CONFIG);

      expect(exit.shouldExit).toBe(true);
      expect(exit.reason).toBe('SIGNAL_REVERSAL');
      expect(exit.explanation).toContain('RSI');
    });

    it('should trigger REGIME_CHANGE when market becomes volatile', () => {
      const snapshot = createMockSnapshot();
      const position = createLongPosition();
      const regime = createVolatileRegime();
      const config = { ...DEFAULT_STRATEGY_CONFIG, enableRegimeFilter: true };

      const exit = generateExitSignal(snapshot, position, 201, regime, config);

      expect(exit.shouldExit).toBe(true);
      expect(exit.reason).toBe('REGIME_CHANGE');
      expect(exit.explanation).toContain('volatile');
    });

    it('should trigger TIME_STOP when position held too long', () => {
      const snapshot = createMockSnapshot();
      const position = createLongPosition({
        entryTime: Date.now() - 400000, // 6.7 minutes ago
      });
      const regime = createNormalRegime();
      const config = { ...DEFAULT_STRATEGY_CONFIG, maxHoldTimeSeconds: 300 };

      const exit = generateExitSignal(snapshot, position, 201, regime, config);

      expect(exit.shouldExit).toBe(true);
      expect(exit.reason).toBe('TIME_STOP');
    });

    it('should trigger VOLATILITY_SPIKE when in profit and volatility extreme', () => {
      const snapshot = createMockSnapshot({
        atr: {
          value: 10,
          valuePercent: 5,
          volatilityLevel: 'extreme',
          avgVolatility: 3,
        },
      });
      const position = createLongPosition();
      const regime = createNormalRegime();

      // Price is up, position is profitable
      const exit = generateExitSignal(snapshot, position, 205, regime, DEFAULT_STRATEGY_CONFIG);

      expect(exit.shouldExit).toBe(true);
      expect(exit.reason).toBe('VOLATILITY_SPIKE');
    });

    it('should NOT exit when all conditions are normal', () => {
      const snapshot = createMockSnapshot();
      const position = createLongPosition();
      const regime = createNormalRegime();

      const exit = generateExitSignal(snapshot, position, 201, regime, DEFAULT_STRATEGY_CONFIG);

      expect(exit.shouldExit).toBe(false);
      expect(exit.reason).toBe('NONE');
    });

    it('should calculate current P&L correctly for LONG', () => {
      const snapshot = createMockSnapshot();
      const position = createLongPosition({ entryPrice: 200 });
      const regime = createNormalRegime();

      const exit = generateExitSignal(snapshot, position, 205, regime, DEFAULT_STRATEGY_CONFIG);

      expect(exit.currentPnLPercent).toBeCloseTo(2.5, 1);
    });

    it('should calculate current P&L correctly for SHORT', () => {
      const snapshot = createMockSnapshot();
      const position = createShortPosition({ entryPrice: 200 });
      const regime = createNormalRegime();

      const exit = generateExitSignal(snapshot, position, 195, regime, DEFAULT_STRATEGY_CONFIG);

      expect(exit.currentPnLPercent).toBeCloseTo(2.5, 1);
    });
  });

  describe('updatePositionTracking', () => {
    it('should update maxPrice when price goes higher', () => {
      const position = createLongPosition({
        maxPrice: 202,
        minPrice: 199,
      });

      const updated = updatePositionTracking(position, 205);

      expect(updated.maxPrice).toBe(205);
      expect(updated.minPrice).toBe(199);
    });

    it('should update minPrice when price goes lower', () => {
      const position = createLongPosition({
        maxPrice: 202,
        minPrice: 199,
      });

      const updated = updatePositionTracking(position, 197);

      expect(updated.maxPrice).toBe(202);
      expect(updated.minPrice).toBe(197);
    });

    it('should update maxPnLPercent for LONG when it improves', () => {
      const position = createLongPosition({
        entryPrice: 200,
        maxPnLPercent: 1,
      });

      const updated = updatePositionTracking(position, 205); // 2.5% profit

      expect(updated.maxPnLPercent).toBe(2.5);
    });

    it('should update maxPnLPercent for SHORT when it improves', () => {
      const position = createShortPosition({
        entryPrice: 200,
        maxPnLPercent: 1,
      });

      const updated = updatePositionTracking(position, 195); // 2.5% profit

      expect(updated.maxPnLPercent).toBe(2.5);
    });
  });

  describe('createPosition', () => {
    it('should create LONG position with correct values', () => {
      const position = createPosition('LONG', 200, 0.5, 195, 210);

      expect(position.direction).toBe('LONG');
      expect(position.entryPrice).toBe(200);
      expect(position.size).toBe(0.5);
      expect(position.initialStopLoss).toBe(195);
      expect(position.currentStopLoss).toBe(195);
      expect(position.takeProfit).toBe(210);
      expect(position.maxPrice).toBe(200);
      expect(position.minPrice).toBe(200);
      expect(position.maxPnLPercent).toBe(0);
    });

    it('should create SHORT position with correct values', () => {
      const position = createPosition('SHORT', 200, 0.5, 205, 190);

      expect(position.direction).toBe('SHORT');
      expect(position.entryPrice).toBe(200);
      expect(position.size).toBe(0.5);
      expect(position.initialStopLoss).toBe(205);
      expect(position.currentStopLoss).toBe(205);
      expect(position.takeProfit).toBe(190);
    });

    it('should set entryTime to current timestamp', () => {
      const before = Date.now();
      const position = createPosition('LONG', 200, 0.5, 195, 210);
      const after = Date.now();

      expect(position.entryTime).toBeGreaterThanOrEqual(before);
      expect(position.entryTime).toBeLessThanOrEqual(after);
    });
  });
});
