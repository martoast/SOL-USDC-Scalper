// tests/strategy/entry-confirm.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the indicators module BEFORE importing entry-confirm
vi.mock('../../server/indicators', () => ({
  getIndicatorSnapshot: vi.fn(),
}));

import { confirmEntry, isEntryConfirmed } from '../../server/strategy/entry-confirm';
import { getIndicatorSnapshot } from '../../server/indicators';
import type { IndicatorSnapshot } from '../../server/indicators/types';

// Helper to create mock 1m snapshot
function createMock1mSnapshot(overrides: Partial<{
  atr: { valuePercent: number; volatilityLevel: string };
  rsi: { value: number; zone: string };
  macd: { histogram: number };
  ema: { trend: string };
}> = {}): Partial<IndicatorSnapshot> {
  return {
    timeframe: '1m',
    timestamp: Date.now(),
    price: 200,
    atr: {
      value: 1,
      valuePercent: 0.5, // Default: normal volatility
      period: 14,
      timestamp: Date.now(),
      volatilityLevel: 'normal',
      ...overrides.atr,
    },
    rsi: {
      value: 50, // Default: neutral
      period: 14,
      timestamp: Date.now(),
      isOverbought: false,
      isOversold: false,
      zone: 'neutral',
      ...overrides.rsi,
    },
    macd: {
      macd: 0.1,
      signal: 0.05,
      histogram: 0.05, // Default: slightly positive
      timestamp: Date.now(),
      isAboveSignal: true,
      isBelowSignal: false,
      crossover: 'none',
      ...overrides.macd,
    },
    ema: {
      ema9: { value: 200, period: 9, timestamp: Date.now() },
      ema21: { value: 199, period: 21, timestamp: Date.now() },
      ema50: null,
      ema200: null,
      ema9Above21: true,
      ema21Above50: false,
      ema50Above200: false,
      trend: 'neutral', // Default: neutral
      ...overrides.ema,
    },
  } as Partial<IndicatorSnapshot>;
}

describe('Entry Confirmation System', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('confirmEntry - all checks pass', () => {
    it('should confirm LONG entry when all conditions are good', () => {
      const mockSnapshot = createMock1mSnapshot({
        atr: { valuePercent: 0.5, volatilityLevel: 'normal' },
        rsi: { value: 50, zone: 'neutral' },
        ema: { trend: 'neutral' },
        macd: { histogram: 0.1 },
      });
      vi.mocked(getIndicatorSnapshot).mockReturnValue(mockSnapshot as IndicatorSnapshot);

      const result = confirmEntry('LONG');

      expect(result.confirmed).toBe(true);
      expect(result.reason).toBeNull();
      expect(result.checks.rangeCheck.passed).toBe(true);
      expect(result.checks.momentumCheck.passed).toBe(true);
      expect(result.checks.exhaustionCheck.passed).toBe(true);
    });

    it('should confirm SHORT entry when all conditions are good', () => {
      const mockSnapshot = createMock1mSnapshot({
        atr: { valuePercent: 0.5, volatilityLevel: 'normal' },
        rsi: { value: 50, zone: 'neutral' },
        ema: { trend: 'neutral' },
        macd: { histogram: -0.1 },
      });
      vi.mocked(getIndicatorSnapshot).mockReturnValue(mockSnapshot as IndicatorSnapshot);

      const result = confirmEntry('SHORT');

      expect(result.confirmed).toBe(true);
      expect(result.reason).toBeNull();
    });
  });

  describe('confirmEntry - range check (volatility spike)', () => {
    it('should reject LONG entry during extreme volatility spike', () => {
      const mockSnapshot = createMock1mSnapshot({
        atr: { valuePercent: 3.0, volatilityLevel: 'extreme' },
      });
      vi.mocked(getIndicatorSnapshot).mockReturnValue(mockSnapshot as IndicatorSnapshot);

      const result = confirmEntry('LONG');

      expect(result.confirmed).toBe(false);
      expect(result.reason).toContain('spike');
      expect(result.checks.rangeCheck.passed).toBe(false);
    });

    it('should reject SHORT entry during high volatility', () => {
      const mockSnapshot = createMock1mSnapshot({
        atr: { valuePercent: 2.0, volatilityLevel: 'high' },
      });
      vi.mocked(getIndicatorSnapshot).mockReturnValue(mockSnapshot as IndicatorSnapshot);

      const result = confirmEntry('SHORT');

      expect(result.confirmed).toBe(false);
      expect(result.reason).toContain('volatility');
      expect(result.checks.rangeCheck.passed).toBe(false);
    });

    it('should allow entry during normal volatility', () => {
      const mockSnapshot = createMock1mSnapshot({
        atr: { valuePercent: 0.8, volatilityLevel: 'normal' },
      });
      vi.mocked(getIndicatorSnapshot).mockReturnValue(mockSnapshot as IndicatorSnapshot);

      const result = confirmEntry('LONG');

      expect(result.checks.rangeCheck.passed).toBe(true);
    });
  });

  describe('confirmEntry - momentum check', () => {
    it('should reject LONG entry when 1m is strongly bearish', () => {
      const mockSnapshot = createMock1mSnapshot({
        ema: { trend: 'strong_bearish' },
      });
      vi.mocked(getIndicatorSnapshot).mockReturnValue(mockSnapshot as IndicatorSnapshot);

      const result = confirmEntry('LONG');

      expect(result.confirmed).toBe(false);
      expect(result.reason).toContain('bearish momentum');
      expect(result.checks.momentumCheck.passed).toBe(false);
    });

    it('should reject SHORT entry when 1m is strongly bullish', () => {
      const mockSnapshot = createMock1mSnapshot({
        ema: { trend: 'strong_bullish' },
      });
      vi.mocked(getIndicatorSnapshot).mockReturnValue(mockSnapshot as IndicatorSnapshot);

      const result = confirmEntry('SHORT');

      expect(result.confirmed).toBe(false);
      expect(result.reason).toContain('bullish momentum');
      expect(result.checks.momentumCheck.passed).toBe(false);
    });

    it('should allow LONG entry when 1m is bullish', () => {
      const mockSnapshot = createMock1mSnapshot({
        ema: { trend: 'bullish' },
      });
      vi.mocked(getIndicatorSnapshot).mockReturnValue(mockSnapshot as IndicatorSnapshot);

      const result = confirmEntry('LONG');

      expect(result.checks.momentumCheck.passed).toBe(true);
    });

    it('should allow SHORT entry when 1m is bearish', () => {
      const mockSnapshot = createMock1mSnapshot({
        ema: { trend: 'bearish' },
      });
      vi.mocked(getIndicatorSnapshot).mockReturnValue(mockSnapshot as IndicatorSnapshot);

      const result = confirmEntry('SHORT');

      expect(result.checks.momentumCheck.passed).toBe(true);
    });

    it('should reject LONG when MACD histogram is strongly negative', () => {
      const mockSnapshot = createMock1mSnapshot({
        ema: { trend: 'neutral' },
        macd: { histogram: -0.8 },
      });
      vi.mocked(getIndicatorSnapshot).mockReturnValue(mockSnapshot as IndicatorSnapshot);

      const result = confirmEntry('LONG');

      expect(result.confirmed).toBe(false);
      expect(result.reason).toContain('MACD');
      expect(result.checks.momentumCheck.passed).toBe(false);
    });

    it('should reject SHORT when MACD histogram is strongly positive', () => {
      const mockSnapshot = createMock1mSnapshot({
        ema: { trend: 'neutral' },
        macd: { histogram: 0.8 },
      });
      vi.mocked(getIndicatorSnapshot).mockReturnValue(mockSnapshot as IndicatorSnapshot);

      const result = confirmEntry('SHORT');

      expect(result.confirmed).toBe(false);
      expect(result.reason).toContain('MACD');
      expect(result.checks.momentumCheck.passed).toBe(false);
    });
  });

  describe('confirmEntry - exhaustion check (RSI)', () => {
    it('should reject LONG entry when RSI is overbought', () => {
      const mockSnapshot = createMock1mSnapshot({
        rsi: { value: 85, zone: 'overbought' },
      });
      vi.mocked(getIndicatorSnapshot).mockReturnValue(mockSnapshot as IndicatorSnapshot);

      const result = confirmEntry('LONG');

      expect(result.confirmed).toBe(false);
      expect(result.reason).toContain('overbought');
      expect(result.checks.exhaustionCheck.passed).toBe(false);
      expect(result.checks.exhaustionCheck.rsiValue).toBe(85);
    });

    it('should reject SHORT entry when RSI is oversold', () => {
      const mockSnapshot = createMock1mSnapshot({
        rsi: { value: 15, zone: 'oversold' },
      });
      vi.mocked(getIndicatorSnapshot).mockReturnValue(mockSnapshot as IndicatorSnapshot);

      const result = confirmEntry('SHORT');

      expect(result.confirmed).toBe(false);
      expect(result.reason).toContain('oversold');
      expect(result.checks.exhaustionCheck.passed).toBe(false);
    });

    it('should allow LONG entry when RSI is neutral', () => {
      const mockSnapshot = createMock1mSnapshot({
        rsi: { value: 55, zone: 'neutral' },
      });
      vi.mocked(getIndicatorSnapshot).mockReturnValue(mockSnapshot as IndicatorSnapshot);

      const result = confirmEntry('LONG');

      expect(result.checks.exhaustionCheck.passed).toBe(true);
    });

    it('should allow LONG entry when RSI is slightly oversold (good entry)', () => {
      const mockSnapshot = createMock1mSnapshot({
        rsi: { value: 25, zone: 'oversold' },
      });
      vi.mocked(getIndicatorSnapshot).mockReturnValue(mockSnapshot as IndicatorSnapshot);

      const result = confirmEntry('LONG');

      // Oversold is good for LONG entry
      expect(result.checks.exhaustionCheck.passed).toBe(true);
    });

    it('should allow SHORT entry when RSI is slightly overbought (good entry)', () => {
      const mockSnapshot = createMock1mSnapshot({
        rsi: { value: 75, zone: 'overbought' },
      });
      vi.mocked(getIndicatorSnapshot).mockReturnValue(mockSnapshot as IndicatorSnapshot);

      const result = confirmEntry('SHORT');

      // Overbought is good for SHORT entry
      expect(result.checks.exhaustionCheck.passed).toBe(true);
    });
  });

  describe('confirmEntry - boundary tests', () => {
    it('should pass exhaustion check at RSI boundary (80 for LONG)', () => {
      const mockSnapshot = createMock1mSnapshot({
        rsi: { value: 80, zone: 'neutral' },
      });
      vi.mocked(getIndicatorSnapshot).mockReturnValue(mockSnapshot as IndicatorSnapshot);

      const result = confirmEntry('LONG');

      expect(result.checks.exhaustionCheck.passed).toBe(true);
    });

    it('should fail exhaustion check just above RSI boundary (81 for LONG)', () => {
      const mockSnapshot = createMock1mSnapshot({
        rsi: { value: 81, zone: 'overbought' },
      });
      vi.mocked(getIndicatorSnapshot).mockReturnValue(mockSnapshot as IndicatorSnapshot);

      const result = confirmEntry('LONG');

      expect(result.checks.exhaustionCheck.passed).toBe(false);
    });

    it('should pass exhaustion check at RSI boundary (20 for SHORT)', () => {
      const mockSnapshot = createMock1mSnapshot({
        rsi: { value: 20, zone: 'neutral' },
      });
      vi.mocked(getIndicatorSnapshot).mockReturnValue(mockSnapshot as IndicatorSnapshot);

      const result = confirmEntry('SHORT');

      expect(result.checks.exhaustionCheck.passed).toBe(true);
    });

    it('should fail exhaustion check just below RSI boundary (19 for SHORT)', () => {
      const mockSnapshot = createMock1mSnapshot({
        rsi: { value: 19, zone: 'oversold' },
      });
      vi.mocked(getIndicatorSnapshot).mockReturnValue(mockSnapshot as IndicatorSnapshot);

      const result = confirmEntry('SHORT');

      expect(result.checks.exhaustionCheck.passed).toBe(false);
    });
  });

  describe('confirmEntry - missing data handling', () => {
    it('should not confirm when no snapshot available', () => {
      vi.mocked(getIndicatorSnapshot).mockReturnValue(null);

      const result = confirmEntry('LONG');

      expect(result.confirmed).toBe(false);
      expect(result.reason).toContain('Insufficient');
    });

    it('should pass range check when ATR missing', () => {
      const mockSnapshot = createMock1mSnapshot();
      (mockSnapshot as any).atr = null;
      vi.mocked(getIndicatorSnapshot).mockReturnValue(mockSnapshot as IndicatorSnapshot);

      const result = confirmEntry('LONG');

      // ATR missing = pass by default (don't block on missing data)
      expect(result.checks.rangeCheck.passed).toBe(true);
    });

    it('should pass exhaustion check when RSI missing', () => {
      const mockSnapshot = createMock1mSnapshot();
      (mockSnapshot as any).rsi = null;
      vi.mocked(getIndicatorSnapshot).mockReturnValue(mockSnapshot as IndicatorSnapshot);

      const result = confirmEntry('LONG');

      // RSI missing = pass by default
      expect(result.checks.exhaustionCheck.passed).toBe(true);
    });

    it('should use provided snapshot instead of fetching', () => {
      const providedSnapshot = createMock1mSnapshot({
        rsi: { value: 50, zone: 'neutral' },
      });

      const result = confirmEntry('LONG', providedSnapshot as IndicatorSnapshot);

      expect(result.confirmed).toBe(true);
      // Should NOT have called getIndicatorSnapshot
      expect(getIndicatorSnapshot).not.toHaveBeenCalled();
    });
  });

  describe('isEntryConfirmed (quick check)', () => {
    it('should return true when entry is confirmed', () => {
      const mockSnapshot = createMock1mSnapshot();
      vi.mocked(getIndicatorSnapshot).mockReturnValue(mockSnapshot as IndicatorSnapshot);

      expect(isEntryConfirmed('LONG')).toBe(true);
    });

    it('should return false when entry is not confirmed', () => {
      const mockSnapshot = createMock1mSnapshot({
        rsi: { value: 90, zone: 'overbought' },
      });
      vi.mocked(getIndicatorSnapshot).mockReturnValue(mockSnapshot as IndicatorSnapshot);

      expect(isEntryConfirmed('LONG')).toBe(false);
    });
  });
});
