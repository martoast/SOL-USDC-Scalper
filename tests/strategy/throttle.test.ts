// tests/strategy/throttle.test.ts

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  checkThrottle,
  canTrade,
  recordTrade,
  resetConsecutiveLosses,
  clearStopLossCooldown,
  setThrottleConfig,
  resetThrottleState,
  DEFAULT_THROTTLE_CONFIG,
} from '../../server/strategy/throttle';

describe('Trade Throttle System', () => {
  beforeEach(() => {
    resetThrottleState();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('checkThrottle - initial state', () => {
    it('should allow trading when no trades have been made', () => {
      const status = checkThrottle();

      expect(status.canTrade).toBe(true);
      expect(status.reason).toBeNull();
      expect(status.cooldownRemaining).toBe(0);
      expect(status.tradesThisHour).toBe(0);
      expect(status.consecutiveLosses).toBe(0);
    });
  });

  describe('checkThrottle - stop-loss cooldown', () => {
    it('should block trading after stop-loss', () => {
      // Record a stop-loss trade
      recordTrade('loss', 'STOP_LOSS');

      const status = checkThrottle();

      expect(status.canTrade).toBe(false);
      expect(status.reason).toContain('Stop-loss cooldown');
      expect(status.cooldownRemaining).toBeGreaterThan(0);
    });

    it('should allow trading after stop-loss cooldown expires', () => {
      // Record a stop-loss trade
      recordTrade('loss', 'STOP_LOSS');

      // Fast forward past cooldown (5 min default)
      vi.advanceTimersByTime(5 * 60 * 1000 + 1000);

      const status = checkThrottle();

      expect(status.canTrade).toBe(true);
    });

    it('should not trigger cooldown for non-stop-loss losses', () => {
      // Record a loss that wasn't a stop-loss
      recordTrade('loss', 'TIME_STOP');

      // Move past minimum gap
      vi.advanceTimersByTime(2 * 60 * 1000 + 1000);

      const status = checkThrottle();

      // Should not have stop-loss cooldown
      expect(status.canTrade).toBe(true);
    });

    it('should clear cooldown manually', () => {
      recordTrade('loss', 'STOP_LOSS');
      clearStopLossCooldown();

      // Move past minimum gap
      vi.advanceTimersByTime(2 * 60 * 1000 + 1000);

      const status = checkThrottle();
      expect(status.canTrade).toBe(true);
    });
  });

  describe('checkThrottle - minimum gap between trades', () => {
    it('should block trading within minimum gap', () => {
      // Record a winning trade
      recordTrade('win', 'TAKE_PROFIT');

      const status = checkThrottle();

      expect(status.canTrade).toBe(false);
      expect(status.reason).toContain('Minimum gap between trades');
    });

    it('should allow trading after minimum gap', () => {
      recordTrade('win', 'TAKE_PROFIT');

      // Fast forward past minimum gap (2 min default)
      vi.advanceTimersByTime(2 * 60 * 1000 + 1000);

      const status = checkThrottle();

      expect(status.canTrade).toBe(true);
    });
  });

  describe('checkThrottle - max trades per hour', () => {
    it('should block trading after reaching max trades', () => {
      // Record 3 trades (max default)
      for (let i = 0; i < 3; i++) {
        recordTrade('win', 'TAKE_PROFIT');
        vi.advanceTimersByTime(2 * 60 * 1000 + 1000); // Pass min gap
      }

      const status = checkThrottle();

      expect(status.canTrade).toBe(false);
      expect(status.reason).toContain('Max trades per hour');
      expect(status.tradesThisHour).toBe(3);
    });

    it('should allow trading after an hour when oldest trade expires', () => {
      // Record 3 trades
      for (let i = 0; i < 3; i++) {
        recordTrade('win', 'TAKE_PROFIT');
        vi.advanceTimersByTime(2 * 60 * 1000 + 1000);
      }

      // Fast forward 1 hour from the first trade
      vi.advanceTimersByTime(60 * 60 * 1000);

      const status = checkThrottle();

      expect(status.canTrade).toBe(true);
      expect(status.tradesThisHour).toBeLessThan(3);
    });
  });

  describe('checkThrottle - consecutive losses', () => {
    it('should pause after max consecutive losses', () => {
      // Record 3 consecutive losses
      for (let i = 0; i < 3; i++) {
        recordTrade('loss', 'TIME_STOP');
        vi.advanceTimersByTime(2 * 60 * 1000 + 1000); // Pass min gap
      }

      const status = checkThrottle();

      expect(status.canTrade).toBe(false);
      expect(status.reason).toContain('consecutive losses');
      expect(status.consecutiveLosses).toBe(3);
    });

    it('should reset consecutive losses after a win', () => {
      // Record 2 losses
      recordTrade('loss', 'TIME_STOP');
      vi.advanceTimersByTime(2 * 60 * 1000 + 1000);
      recordTrade('loss', 'TIME_STOP');
      vi.advanceTimersByTime(2 * 60 * 1000 + 1000);

      // Record a win
      recordTrade('win', 'TAKE_PROFIT');
      vi.advanceTimersByTime(2 * 60 * 1000 + 1000);

      const status = checkThrottle();

      expect(status.consecutiveLosses).toBe(0);
      // Should be allowed (if under max trades)
    });

    it('should reset consecutive losses manually', () => {
      // Increase max trades to avoid that limit
      setThrottleConfig({ maxTradesPerHour: 10 });

      // Record 3 losses (paused)
      for (let i = 0; i < 3; i++) {
        recordTrade('loss', 'TIME_STOP');
        vi.advanceTimersByTime(2 * 60 * 1000 + 1000);
      }

      expect(checkThrottle().canTrade).toBe(false);
      expect(checkThrottle().reason).toContain('consecutive losses');

      // Manually reset
      resetConsecutiveLosses();

      expect(checkThrottle().canTrade).toBe(true);
    });
  });

  describe('config customization', () => {
    it('should respect custom stop-loss cooldown', () => {
      setThrottleConfig({ stopLossCooldownMs: 10 * 60 * 1000 }); // 10 min

      recordTrade('loss', 'STOP_LOSS');

      // After 5 min (default), still blocked
      vi.advanceTimersByTime(5 * 60 * 1000);
      expect(checkThrottle().canTrade).toBe(false);

      // After 10 min, allowed
      vi.advanceTimersByTime(5 * 60 * 1000 + 1000);
      expect(checkThrottle().canTrade).toBe(true);
    });

    it('should respect custom max trades per hour', () => {
      setThrottleConfig({ maxTradesPerHour: 5 });

      // Record 5 trades
      for (let i = 0; i < 5; i++) {
        recordTrade('win', 'TAKE_PROFIT');
        vi.advanceTimersByTime(2 * 60 * 1000 + 1000);
      }

      const status = checkThrottle();
      expect(status.canTrade).toBe(false);
      expect(status.tradesThisHour).toBe(5);
    });

    it('should respect custom min trading gap', () => {
      setThrottleConfig({ minTradingGapMs: 30 * 1000 }); // 30 seconds

      recordTrade('win', 'TAKE_PROFIT');

      // After 30 seconds, allowed
      vi.advanceTimersByTime(30 * 1000 + 1000);
      expect(checkThrottle().canTrade).toBe(true);
    });

    it('should respect custom max consecutive losses', () => {
      // Increase max trades to avoid that limit, set max consecutive losses to 5
      setThrottleConfig({ maxConsecutiveLosses: 5, maxTradesPerHour: 10 });

      // Record 4 losses
      for (let i = 0; i < 4; i++) {
        recordTrade('loss', 'TIME_STOP');
        vi.advanceTimersByTime(2 * 60 * 1000 + 1000);
      }

      // Still allowed (need 5 to pause)
      expect(checkThrottle().canTrade).toBe(true);

      // 5th loss
      recordTrade('loss', 'TIME_STOP');
      vi.advanceTimersByTime(2 * 60 * 1000 + 1000);

      expect(checkThrottle().canTrade).toBe(false);
      expect(checkThrottle().reason).toContain('consecutive losses');
    });
  });

  describe('canTrade (quick check)', () => {
    it('should return true when can trade', () => {
      expect(canTrade()).toBe(true);
    });

    it('should return false when blocked', () => {
      recordTrade('loss', 'STOP_LOSS');
      expect(canTrade()).toBe(false);
    });
  });

  describe('throttle priority', () => {
    it('should check stop-loss cooldown before min gap', () => {
      recordTrade('loss', 'STOP_LOSS');

      const status = checkThrottle();

      // Should mention stop-loss, not min gap
      expect(status.reason).toContain('Stop-loss');
    });

    it('should check min gap before max trades', () => {
      // Record 2 trades (not at max yet)
      recordTrade('win', 'TAKE_PROFIT');
      vi.advanceTimersByTime(2 * 60 * 1000 + 1000);
      recordTrade('win', 'TAKE_PROFIT');
      // Don't advance time - should be blocked by min gap

      const status = checkThrottle();

      expect(status.canTrade).toBe(false);
      expect(status.reason).toContain('gap');
    });
  });

  describe('trade history cleanup', () => {
    it('should remove trades older than 1 hour', () => {
      // Record 3 trades
      for (let i = 0; i < 3; i++) {
        recordTrade('win', 'TAKE_PROFIT');
        vi.advanceTimersByTime(2 * 60 * 1000 + 1000);
      }

      // All 3 trades in history
      expect(checkThrottle().tradesThisHour).toBe(3);

      // Fast forward 1 hour + buffer
      vi.advanceTimersByTime(60 * 60 * 1000);

      // Old trades should be cleaned up
      expect(checkThrottle().tradesThisHour).toBe(0);
    });
  });
});
