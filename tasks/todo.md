# SOL-USDC Scalper - Professional Safeguards

## Goal
Reduce bad trades by:
- Trading only in tradable market regimes
- Improving entry timing
- Preventing death by overtrading

**No ML. No exotic infra. Just professional safeguards.**

---

## Core Strategy (Already Built)

```
SIGNAL:     3m    → Decide on trades
FILTERS:    15m + 1h → Must agree with direction
EXECUTION:  1m    → Precise entries
```

---

## This Phase: Survivability & Consistency

### 1. Market Tradability Gate (Highest ROI)

**What:** Top-level check before ANY signal processing
```
marketState: TRADABLE | NO_TRADE
```

**Inputs:**
- [ ] 15m volatility vs recent baseline (is vol normal?)
- [ ] 15m trend strength via ADX (is there a trend?)
- [ ] Range compression detection (avoid chop)

**Output:**
- If NO_TRADE → system does nothing, regardless of signals
- UI shows: "Market not tradable: [reason]"

**Why:** Most losses come from low-vol chop, trendless compression, post-move exhaustion. This removes entire loss clusters.

---

### 2. Trade Cooldowns & Throttles

**What:** Limits on how often the system can act

**Rules:**
- [ ] Cooldown after stop-loss hit (5-10 minutes)
- [ ] Max trades per hour (e.g., 3)
- [ ] No immediate re-entry after exit (minimum 2 min gap)
- [ ] Max consecutive losses before pause (e.g., 3)

**Why:** Scalpers blow up from revenge trading loops, not bad signals.

---

### 3. Volatility-Scaled Stops & Targets (Refined)

**What:** ATR is PRIMARY, percent is FLOOR only

**Rules:**
- TP = 2-3× ATR (primary)
- SL = 1-1.5× ATR (primary)
- TP floor = 1.2% (safety net)
- SL floor = 0.5% (safety net)
- SL cap = 2% (risk control)

**Implementation:**
- [x] ATR-based stops (already implemented)
- [x] Minimum floors (already done)
- [ ] Maximum cap on stop size (2% max SL)
- [ ] Ensure ATR decides, percent is backup only

**Why:** SOL volatility changes fast. ATR adapts. Fixed % drifts.

---

### 4. Time-Based Trade Kill Switch (Already Done - Refine)

**What:** Max lifetime per trade

**Current:** 30 min max hold
**Refinement:**
- [ ] Shorter timeout for momentum trades (10-15 min)
- [ ] If no movement in expected direction after 5 min → reduce position or exit

**Why:** Momentum trades that don't move quickly are failed trades.

---

### 5. Entry Confirmation on Execution TF (1m)

**What:** Binary checks only - execution should NOT "think"

**3 Simple Checks (all must pass):**
- [ ] **Range Check:** 1m candle range < 2× ATR (not entering a spike)
- [ ] **Momentum Check:** 1m shows continuation in signal direction
- [ ] **No Exhaustion:** 1m RSI between 20-80 (not extreme)

**Expected Trade Behavior:**
> "If price does not show favorable excursion within 5 minutes, the thesis is invalid."

Momentum trades should move quickly OR die quickly.
If neither → the setup was wrong.

**Why:** Improves fill quality without adding complexity.

---

### 6. Clear Visual State in UI (Operator Trust)

**What:** UI shows WHY bot is NOT trading

**Display:**
- [ ] "Market not tradable: low volatility"
- [ ] "Blocked by 1h filter"
- [ ] "Cooldown active (3:42 remaining)"
- [ ] "Max trades reached for this hour"

**Why:** Prevents manual overrides, emotional interference. Trust = consistency.

---

## Implementation Checklist

### Phase 1: Market Tradability Gate ✅ COMPLETE
- [x] Create `server/strategy/tradability.ts`
- [x] Implement volatility check (15m ATR vs baseline)
- [x] Implement trend strength check (ADX threshold)
- [x] Implement range compression check (BB bandwidth)
- [x] Add `isTradable()` to strategy flow
- [x] Block all entries when not tradable
- [x] Return tradability status in API response

### Phase 1.5: Signal Threshold Refinement
- [ ] Log score distributions over time
- [ ] Switch from fixed thresholds (Score > 20) to percentile-based
- [ ] LONG = top 20% of historical scores
- [ ] SHORT = bottom 20% of historical scores
- [ ] This prevents threshold drift

### Phase 2: Cooldowns & Throttles ✅ COMPLETE
- [x] Add cooldown timer after stop-loss (5 min default)
- [x] Track trades per hour
- [x] Add minimum gap between trades (2 min default)
- [x] Add consecutive loss counter
- [x] Pause trading after 3 consecutive losses
- [x] Wire up in strategy flow (blocks entries when throttled)
- [x] Return throttle status in API response
- [x] 21 unit tests passing

### Phase 3: Entry Confirmation ✅ COMPLETE
- [x] Range Check - 1m volatility not extreme (not entering a spike)
- [x] Momentum Check - 1m trend not strongly against signal direction
- [x] Exhaustion Check - 1m RSI not at extremes (20-80 range)
- [x] Wire up in strategy flow (blocks entries when not confirmed)
- [x] Return entryConfirmation status in API response
- [x] 26 unit tests passing

### Phase 4: UI State Display ✅ COMPLETE
- [x] Show tradability status (Market: Tradable/Not tradable)
- [x] Show throttle status (trades/hour, cooldown timer)
- [x] Show entry confirmation status (Ready/Waiting)
- [x] Simplified UI: removed manual Long/Short buttons
- [x] Kept only Start/Stop bot button
- [x] Streamlined settings: position size, TP%, SL%, allow longs/shorts

### Phase 5: Performance Truth (Instrumentation) ✅ COMPLETE

> ⚠️ **PHASE 5 IS READ-ONLY**
> No strategy changes allowed during data collection.
> We are measuring signal truth, execution drag, and regime dependency — nothing else.

**Why this matters:** Without MFE/MAE data, you're blind. You won't know which signals are actually good vs which just feel good.

#### 5.1 Trade Diagnostics (Mandatory)
For every trade, log:
- [ ] Signal score at entry
- [ ] MFE (max favorable excursion) after 1m, 3m, 5m, 10m
- [ ] MAE (max adverse excursion) before exit
- [ ] Time to first favorable tick
- [ ] Time to max favorable move (time-to-MFE)
- [ ] Signal decay speed (how fast does edge disappear?)
- [ ] **MFE-before-MAE ordering** — did price go +X% first or -Y% first?
  - Two trades can have identical MAE/MFE but only one was tradable without pain
  - Critical for psychological + risk scaling later

#### 5.2 Shadow PnL vs Ideal PnL
Track execution quality:
- [ ] Theoretical entry price (signal candle close)
- [ ] Actual fill price
- [ ] Slippage in bps
- [ ] Fee impact per trade
- [ ] Edge survival after reality (does profit survive fees + slippage?)
- [ ] **Slippage percentile distribution** (not just average):
  - Median slippage
  - 90th percentile slippage
  - Worst-case slippage during spikes
  - A few awful fills can erase 20 good trades — need tail risk, not mean

#### 5.3 Regime Tagging (Silent, No Decisions)
Tag every trade with context (observe only, don't act yet):
- [ ] Market state at entry (trend / chop / breakout)
- [ ] Volatility percentile (where is current vol vs recent history?)
- [ ] Time of day (SOL has rhythm)
- [ ] Tradability gate values at entry
- [ ] **Post-entry regime shift flag** — did regime change after entry?
  - Distinguishes "bad entry" from "good entry, market changed"

#### 5.4 Expectancy Calculation
Answer with data, not vibes:
- [ ] Win rate by signal score bucket
- [ ] Average MFE vs average MAE
- [ ] Expectancy = (win% × avg_win) - (loss% × avg_loss) - fees
- [ ] Minimum viable position size (below what size do fees kill the edge?)
- [ ] **% of trades where MFE ≥ SL × 2** (the brutal question)
  - Tells you if R-multiples are realistic
  - Tells you if trailing stops make sense
  - Tells you if "let winners run" is even true for this signal
  - If this number is low, no amount of execution saves it

**Implementation:**
- [x] Create `server/diagnostics/types.ts` - TradeSnapshot, ExcursionData types
- [x] Create `server/diagnostics/trade-tracker.ts` - track MFE/MAE in real-time
- [x] Create `server/diagnostics/expectancy.ts` - calculate expectancy metrics
- [x] Extend trade records in DB with diagnostic fields
- [x] Add `/api/diagnostics.get.ts` - retrieve performance data
- [x] Write tests for diagnostic calculations (31 tests)

**Output:** After 50+ trades, you'll have hard data showing:
- Which signals actually produce edge
- Whether 5-minute thesis rule is correct or too lenient
- If fees eat your expectancy
- Real vs theoretical performance gap
- If MFE > MAE by a clean margin
- If slippage tails are reasonable
- If edge concentrates in specific regimes

---

## What We Are NOT Adding Yet

- ❌ No machine learning
- ❌ No order book prediction
- ❌ No tick-level signal logic
- ❌ No strategy explosion

Those come only after this version proves profitable.

---

## Important Reality Check

**This system provides:**
- Execution + discipline alpha
- NOT prediction alpha

**Returns come from:**
- Not trading bad setups
- Strict risk controls
- Preventing overtrading

**Returns do NOT come from:**
- Outsmarting the market
- Better predictions
- Magic indicators

> "This is a system that survives. Survival = profit over time."

---

## Key Files

| File | Purpose |
|------|---------|
| `server/strategy/tradability.ts` | ✅ Market tradability gate (volatility, ADX, BB squeeze) |
| `server/strategy/throttle.ts` | ✅ Cooldowns and limits (stop-loss cooldown, max trades, etc.) |
| `server/strategy/entry-confirm.ts` | ✅ Entry confirmation (1m range, momentum, RSI checks) |
| `server/strategy/index.ts` | ✅ Wired up all gates (blocks entries through 3-layer filter) |
| `pages/index.vue` | ✅ Simplified UI with status panel |
| `tests/strategy/tradability.test.ts` | ✅ 20 tests for tradability |
| `tests/strategy/throttle.test.ts` | ✅ 21 tests for throttle |
| `tests/strategy/entry-confirm.test.ts` | ✅ 26 tests for entry confirmation |
| `server/diagnostics/types.ts` | ✅ Phase 5: TradeSnapshot, ExcursionData, TradeDiagnostics |
| `server/diagnostics/trade-tracker.ts` | ✅ Phase 5: MFE/MAE real-time tracking |
| `server/diagnostics/expectancy.ts` | ✅ Phase 5: Expectancy & metrics calculations |
| `server/api/diagnostics.get.ts` | ✅ Phase 5: Performance data API |
| `tests/diagnostics/trade-tracker.test.ts` | ✅ 17 tests for trade tracking |
| `tests/diagnostics/expectancy.test.ts` | ✅ 14 tests for expectancy |

---

## Success Criteria

Before going live:
- [x] System correctly blocks trades in untradable conditions
- [x] Cooldowns prevent revenge trading
- [x] No more than 3 trades per hour
- [x] UI clearly shows system state
- [ ] Paper trade for 24+ hours with new safeguards
- [ ] **Phase 5:** MFE/MAE data collected for 50+ trades
- [ ] **Phase 5:** Expectancy calculated with real data
- [ ] **Phase 5:** Know minimum viable position size

---

## Current Status

- [x] Multi-timeframe signal logic (3m/15m/1h)
- [x] ATR-based stops with floors
- [x] Time-based exit (30 min)
- [x] **Phase 1: Market Tradability Gate** ✅ DONE
- [x] **Phase 2: Cooldowns & Throttles** ✅ DONE
- [x] **Phase 3: Entry Confirmation** ✅ DONE
- [x] **Phase 4: UI State Display** ✅ DONE
- [x] **Phase 5: Performance Truth** ✅ DONE (MFE/MAE, slippage, expectancy)

---

## Review

### Summary of Changes

**All 4 phases completed successfully.**

#### Phase 1: Market Tradability Gate
- Created `server/strategy/tradability.ts`
- Checks: 15m ATR (0.15%-2%), ADX (>18), BB bandwidth (>0.8%)
- 20 tests passing

#### Phase 2: Cooldowns & Throttles
- Created `server/strategy/throttle.ts`
- Features: stop-loss cooldown (5min), min gap (2min), max trades/hour (3), consecutive loss pause (3)
- 21 tests passing

#### Phase 3: Entry Confirmation
- Created `server/strategy/entry-confirm.ts`
- Checks: range (volatility), momentum (EMA/MACD), exhaustion (RSI 20-80)
- 26 tests passing

#### Phase 4: UI Simplification
- Removed manual Long/Short buttons
- Added Start/Stop Bot button
- Added System Status panel showing:
  - Market tradability (green/red)
  - Throttle status (trades/hour, cooldown)
  - Entry confirmation (ready/waiting)
- Simplified settings: position size, TP%, SL%, allow longs/shorts
- Removed test mode, smart mode toggles (smart mode always on)

#### Phase 5: Performance Truth (Instrumentation)
- Created `server/diagnostics/types.ts` - Full type system for diagnostics
- Created `server/diagnostics/trade-tracker.ts` - Real-time MFE/MAE tracking
- Created `server/diagnostics/expectancy.ts` - Expectancy & metrics calculations
- Created `server/api/diagnostics.get.ts` - Performance data API
- Extended DB schema with diagnostic fields
- Wired up to trade open/close flow in `server/api/trade.post.ts`
- Added price updates to active trackers in `server/api/stream/status.get.ts`
- Updated frontend to pass signal data on trade entry
- 17 + 14 = 31 new tests passing

**Key Features Implemented:**
- MFE-before-MAE ordering detection (first favorable vs adverse)
- Time-bucketed MFE tracking (1m, 3m, 5m, 10m)
- Slippage percentile distribution (median, 90th, worst)
- R-multiple calculation
- % of trades reaching 2R threshold
- Regime tagging (trending, ranging, volatile)
- Time-of-day analysis (market hours vs off hours)
- Post-entry regime shift detection
- Expectancy calculation with fees

### Test Coverage
- **247 total tests passing** across 11 test files
- Build compiles successfully

### Architecture
Entry protection is now 3-layer:
1. **Tradability Gate** - Is the market conditions suitable?
2. **Throttle Gate** - Are we allowed to trade (cooldowns, limits)?
3. **Entry Confirmation** - Is the 1m timeframe confirming the signal?

All gates must pass for entry. Exits are always allowed (position management).
