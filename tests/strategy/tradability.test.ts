// tests/strategy/tradability.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the indicators module BEFORE importing tradability
vi.mock('../../server/indicators', () => ({
  getIndicatorSnapshot: vi.fn(),
}));

import { checkTradability, isTradable } from '../../server/strategy/tradability';
import { getIndicatorSnapshot } from '../../server/indicators';
import type { IndicatorSnapshot } from '../../server/indicators/types';

// Helper to create mock 15m snapshot
function createMock15mSnapshot(overrides: Partial<{
  atr: { valuePercent: number; volatilityLevel: string };
  adx: { adx: number; trendStrength: string; trendDirection: string };
  bollingerBands: { bandwidth: number };
}> = {}): Partial<IndicatorSnapshot> {
  return {
    timeframe: '15m',
    timestamp: Date.now(),
    price: 200,
    atr: {
      value: 2,
      valuePercent: 0.5, // Default: normal volatility
      period: 14,
      timestamp: Date.now(),
      volatilityLevel: 'normal',
      ...overrides.atr,
    },
    adx: {
      adx: 25, // Default: trending
      plusDI: 20,
      minusDI: 15,
      period: 14,
      timestamp: Date.now(),
      trendStrength: 'moderate',
      trendDirection: 'bullish',
      ...overrides.adx,
    },
    bollingerBands: {
      upper: 205,
      middle: 200,
      lower: 195,
      bandwidth: 2.5, // Default: not compressed
      percentB: 0.5,
      timestamp: Date.now(),
      isAboveUpper: false,
      isBelowLower: false,
      zone: 'middle',
      ...overrides.bollingerBands,
    },
  } as Partial<IndicatorSnapshot>;
}

describe('Market Tradability Gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('checkTradability', () => {
    it('should return tradable when all conditions are good', () => {
      const mockSnapshot = createMock15mSnapshot({
        atr: { valuePercent: 0.5, volatilityLevel: 'normal' },
        adx: { adx: 25, trendStrength: 'moderate', trendDirection: 'bullish' },
        bollingerBands: { bandwidth: 2.5 },
      });
      vi.mocked(getIndicatorSnapshot).mockReturnValue(mockSnapshot as IndicatorSnapshot);

      const result = checkTradability();

      expect(result.isTradable).toBe(true);
      expect(result.reason).toBeNull();
      expect(result.checks.volatility.passed).toBe(true);
      expect(result.checks.trendStrength.passed).toBe(true);
      expect(result.checks.rangeCompression.passed).toBe(true);
    });

    it('should block trading when volatility is too LOW (chop)', () => {
      const mockSnapshot = createMock15mSnapshot({
        atr: { valuePercent: 0.1, volatilityLevel: 'low' }, // Below 0.15% threshold
        adx: { adx: 25, trendStrength: 'moderate', trendDirection: 'bullish' },
      });
      vi.mocked(getIndicatorSnapshot).mockReturnValue(mockSnapshot as IndicatorSnapshot);

      const result = checkTradability();

      expect(result.isTradable).toBe(false);
      expect(result.reason).toContain('Low volatility');
      expect(result.checks.volatility.passed).toBe(false);
      expect(result.checks.volatility.value).toBe(0.1);
    });

    it('should block trading when volatility is too HIGH (dangerous)', () => {
      const mockSnapshot = createMock15mSnapshot({
        atr: { valuePercent: 2.5, volatilityLevel: 'extreme' }, // Above 2% threshold
        adx: { adx: 25, trendStrength: 'moderate', trendDirection: 'bullish' },
      });
      vi.mocked(getIndicatorSnapshot).mockReturnValue(mockSnapshot as IndicatorSnapshot);

      const result = checkTradability();

      expect(result.isTradable).toBe(false);
      expect(result.reason).toContain('Extreme volatility');
      expect(result.checks.volatility.passed).toBe(false);
    });

    it('should block trading when ADX is too low (no trend)', () => {
      const mockSnapshot = createMock15mSnapshot({
        atr: { valuePercent: 0.5, volatilityLevel: 'normal' },
        adx: { adx: 12, trendStrength: 'weak', trendDirection: 'neutral' }, // Below 18 threshold
        bollingerBands: { bandwidth: 0.5 }, // Also compressed
      });
      vi.mocked(getIndicatorSnapshot).mockReturnValue(mockSnapshot as IndicatorSnapshot);

      const result = checkTradability();

      expect(result.isTradable).toBe(false);
      expect(result.reason).toContain('No trend');
      expect(result.checks.trendStrength.passed).toBe(false);
      expect(result.checks.trendStrength.value).toBe(12);
    });

    it('should allow trading if ADX is low but not compressed (relaxed rule)', () => {
      const mockSnapshot = createMock15mSnapshot({
        atr: { valuePercent: 0.5, volatilityLevel: 'normal' },
        adx: { adx: 15, trendStrength: 'weak', trendDirection: 'neutral' }, // Below 18
        bollingerBands: { bandwidth: 2.0 }, // NOT compressed (> 0.8%)
      });
      vi.mocked(getIndicatorSnapshot).mockReturnValue(mockSnapshot as IndicatorSnapshot);

      const result = checkTradability();

      // Should be tradable because volatility is good AND not compressed
      expect(result.isTradable).toBe(true);
      expect(result.checks.trendStrength.passed).toBe(false); // ADX check still fails
      expect(result.checks.rangeCompression.passed).toBe(true); // But compression passes
    });

    it('should block when in tight compression (BB squeeze)', () => {
      const mockSnapshot = createMock15mSnapshot({
        atr: { valuePercent: 0.5, volatilityLevel: 'normal' },
        adx: { adx: 15, trendStrength: 'weak', trendDirection: 'neutral' },
        bollingerBands: { bandwidth: 0.5 }, // Below 0.8% threshold - squeezed
      });
      vi.mocked(getIndicatorSnapshot).mockReturnValue(mockSnapshot as IndicatorSnapshot);

      const result = checkTradability();

      expect(result.isTradable).toBe(false);
      expect(result.checks.rangeCompression.passed).toBe(false);
      expect(result.checks.rangeCompression.value).toBe(0.5);
    });

    it('should return not tradable when no data available', () => {
      vi.mocked(getIndicatorSnapshot).mockReturnValue(null);

      const result = checkTradability();

      expect(result.isTradable).toBe(false);
      expect(result.reason).toContain('Insufficient data');
    });

    it('should handle missing ATR gracefully', () => {
      const mockSnapshot = createMock15mSnapshot();
      (mockSnapshot as any).atr = null;
      vi.mocked(getIndicatorSnapshot).mockReturnValue(mockSnapshot as IndicatorSnapshot);

      const result = checkTradability();

      expect(result.isTradable).toBe(false);
      expect(result.reason).toContain('ATR data unavailable');
      expect(result.checks.volatility.passed).toBe(false);
    });

    it('should handle missing ADX gracefully', () => {
      const mockSnapshot = createMock15mSnapshot();
      (mockSnapshot as any).adx = null;
      vi.mocked(getIndicatorSnapshot).mockReturnValue(mockSnapshot as IndicatorSnapshot);

      const result = checkTradability();

      expect(result.isTradable).toBe(false);
      expect(result.reason).toContain('ADX data unavailable');
      expect(result.checks.trendStrength.passed).toBe(false);
    });

    it('should pass if BB is missing (secondary check)', () => {
      const mockSnapshot = createMock15mSnapshot({
        atr: { valuePercent: 0.5, volatilityLevel: 'normal' },
        adx: { adx: 25, trendStrength: 'moderate', trendDirection: 'bullish' },
      });
      (mockSnapshot as any).bollingerBands = null;
      vi.mocked(getIndicatorSnapshot).mockReturnValue(mockSnapshot as IndicatorSnapshot);

      const result = checkTradability();

      // Should still be tradable - BB is secondary
      expect(result.isTradable).toBe(true);
    });
  });

  describe('isTradable (quick check)', () => {
    it('should return true when tradable', () => {
      const mockSnapshot = createMock15mSnapshot({
        atr: { valuePercent: 0.5, volatilityLevel: 'normal' },
        adx: { adx: 25, trendStrength: 'moderate', trendDirection: 'bullish' },
      });
      vi.mocked(getIndicatorSnapshot).mockReturnValue(mockSnapshot as IndicatorSnapshot);

      expect(isTradable()).toBe(true);
    });

    it('should return false when not tradable', () => {
      const mockSnapshot = createMock15mSnapshot({
        atr: { valuePercent: 0.1, volatilityLevel: 'low' }, // Too quiet
      });
      vi.mocked(getIndicatorSnapshot).mockReturnValue(mockSnapshot as IndicatorSnapshot);

      expect(isTradable()).toBe(false);
    });
  });

  describe('threshold values', () => {
    it('should accept volatility at lower boundary (0.15%)', () => {
      const mockSnapshot = createMock15mSnapshot({
        atr: { valuePercent: 0.15, volatilityLevel: 'low' },
        adx: { adx: 25, trendStrength: 'moderate', trendDirection: 'bullish' },
      });
      vi.mocked(getIndicatorSnapshot).mockReturnValue(mockSnapshot as IndicatorSnapshot);

      const result = checkTradability();
      expect(result.checks.volatility.passed).toBe(true);
    });

    it('should reject volatility just below boundary (0.14%)', () => {
      const mockSnapshot = createMock15mSnapshot({
        atr: { valuePercent: 0.14, volatilityLevel: 'low' },
        adx: { adx: 25, trendStrength: 'moderate', trendDirection: 'bullish' },
      });
      vi.mocked(getIndicatorSnapshot).mockReturnValue(mockSnapshot as IndicatorSnapshot);

      const result = checkTradability();
      expect(result.checks.volatility.passed).toBe(false);
    });

    it('should accept volatility at upper boundary (2.0%)', () => {
      const mockSnapshot = createMock15mSnapshot({
        atr: { valuePercent: 2.0, volatilityLevel: 'high' },
        adx: { adx: 25, trendStrength: 'moderate', trendDirection: 'bullish' },
      });
      vi.mocked(getIndicatorSnapshot).mockReturnValue(mockSnapshot as IndicatorSnapshot);

      const result = checkTradability();
      expect(result.checks.volatility.passed).toBe(true);
    });

    it('should reject volatility just above boundary (2.1%)', () => {
      const mockSnapshot = createMock15mSnapshot({
        atr: { valuePercent: 2.1, volatilityLevel: 'extreme' },
        adx: { adx: 25, trendStrength: 'moderate', trendDirection: 'bullish' },
      });
      vi.mocked(getIndicatorSnapshot).mockReturnValue(mockSnapshot as IndicatorSnapshot);

      const result = checkTradability();
      expect(result.checks.volatility.passed).toBe(false);
    });

    it('should accept ADX at boundary (18)', () => {
      const mockSnapshot = createMock15mSnapshot({
        atr: { valuePercent: 0.5, volatilityLevel: 'normal' },
        adx: { adx: 18, trendStrength: 'weak', trendDirection: 'neutral' },
      });
      vi.mocked(getIndicatorSnapshot).mockReturnValue(mockSnapshot as IndicatorSnapshot);

      const result = checkTradability();
      expect(result.checks.trendStrength.passed).toBe(true);
    });

    it('should reject ADX just below boundary (17)', () => {
      const mockSnapshot = createMock15mSnapshot({
        atr: { valuePercent: 0.5, volatilityLevel: 'normal' },
        adx: { adx: 17, trendStrength: 'weak', trendDirection: 'neutral' },
        bollingerBands: { bandwidth: 0.5 }, // Also compressed to fail
      });
      vi.mocked(getIndicatorSnapshot).mockReturnValue(mockSnapshot as IndicatorSnapshot);

      const result = checkTradability();
      expect(result.checks.trendStrength.passed).toBe(false);
    });

    it('should accept BB bandwidth at boundary (0.8%)', () => {
      const mockSnapshot = createMock15mSnapshot({
        atr: { valuePercent: 0.5, volatilityLevel: 'normal' },
        adx: { adx: 25, trendStrength: 'moderate', trendDirection: 'bullish' },
        bollingerBands: { bandwidth: 0.8 },
      });
      vi.mocked(getIndicatorSnapshot).mockReturnValue(mockSnapshot as IndicatorSnapshot);

      const result = checkTradability();
      expect(result.checks.rangeCompression.passed).toBe(true);
    });

    it('should reject BB bandwidth just below boundary (0.79%)', () => {
      const mockSnapshot = createMock15mSnapshot({
        atr: { valuePercent: 0.5, volatilityLevel: 'normal' },
        adx: { adx: 25, trendStrength: 'moderate', trendDirection: 'bullish' },
        bollingerBands: { bandwidth: 0.79 },
      });
      vi.mocked(getIndicatorSnapshot).mockReturnValue(mockSnapshot as IndicatorSnapshot);

      const result = checkTradability();
      expect(result.checks.rangeCompression.passed).toBe(false);
    });
  });
});
