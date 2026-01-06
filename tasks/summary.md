# SOL-USDC Scalper - How It Works

## The Big Picture

```
Price Feed → Candles → Indicators → Signals → Gates → Trade Decision
```

We watch SOL/USDC price in real-time, build candles at multiple timeframes, calculate indicators, generate signals, and only trade when ALL conditions align.

---

## 1. Price Data & Candles

**Source:** Helius WebSocket → Raydium CLMM Pool

Every price tick updates our candles:

```
1m   ████████  ← Execution (precise entries)
3m   ██████    ← Signal (decide trades)
5m   █████
10m  ████
15m  ███       ← Filter (trend confirmation)
30m  ██
1h   █         ← Filter (big picture trend)
```

Each candle has: Open, High, Low, Close, Volume

---

## 2. Multi-Timeframe Strategy

We use THREE timeframes for different purposes:

```
┌─────────────────────────────────────────────────────┐
│  3m  = SIGNAL      "Should we trade?"               │
│  15m = FILTER      "Is short-term trend aligned?"   │
│  1h  = FILTER      "Is big picture aligned?"        │
│  1m  = EXECUTION   "Best entry price"               │
└─────────────────────────────────────────────────────┘
```

### Why This Works

- **3m catches momentum** without 1m noise
- **15m/1h filters kill bad trades** (no fighting the trend)
- **1m gives precise entries** (better prices, tighter stops)

---

## 3. The Decision Flow

```
START
  │
  ▼
┌─────────────────────┐
│ Is Market Tradable? │ ← Volatility + Trend Strength check
└─────────────────────┘
  │ NO → Do nothing
  │ YES
  ▼
┌─────────────────────┐
│ Cooldown Active?    │ ← After losses, between trades
└─────────────────────┘
  │ YES → Wait
  │ NO
  ▼
┌─────────────────────┐
│ 3m Signal?          │ ← Score in top/bottom 20% historically
└─────────────────────┘
  │ NONE → Do nothing
  │ LONG or SHORT
  ▼
┌─────────────────────┐
│ 15m Filter Aligned? │ ← Must match signal direction
└─────────────────────┘
  │ NO → Do nothing
  │ YES
  ▼
┌─────────────────────┐
│ 1h Filter Aligned?  │ ← Must match signal direction
└─────────────────────┘
  │ NO → Do nothing
  │ YES
  ▼
┌─────────────────────┐
│ 1m Entry Confirm?   │ ← Good entry on execution TF
└─────────────────────┘
  │ NO → Wait for better entry
  │ YES
  ▼
  ✅ ENTER TRADE
```

---

## 4. Signal Generation (3m)

We calculate indicators on 3m candles, but think in **3 features** (not 5 indicators):

| Feature | Indicators Used | What It Tells Us |
|---------|-----------------|------------------|
| **MOMENTUM** | RSI, MACD histogram | Is price pushing in a direction? |
| **TREND** | EMA 9/21, MACD signal | What's the underlying direction? |
| **VOLATILITY** | ATR, ADX | Is there enough movement to trade? |

These combine into a **Composite Score** (-100 to +100):
- Score in **top 20% historically** = LONG signal
- Score in **bottom 20% historically** = SHORT signal
- Between = No signal

> **Note:** Use percentile thresholds, not fixed numbers. Fixed thresholds drift over time.

---

## 5. Filter Logic (15m + 1h)

Filters check if the bigger timeframes agree with our signal.

**For a LONG trade:**
```
15m: EMA9 > EMA21? → BULLISH ✓
1h:  EMA9 > EMA21? → BULLISH ✓
Both aligned? → PROCEED
```

**For a SHORT trade:**
```
15m: EMA9 < EMA21? → BEARISH ✓
1h:  EMA9 < EMA21? → BEARISH ✓
Both aligned? → PROCEED
```

**If filters don't align → NO TRADE**

---

## 6. Market Tradability Gate

Before looking at any signals, we ask:

> "Is this market worth trading right now?"

**Checks:**
1. **Volatility** - Is 15m ATR in normal range? (not too low, not extreme)
2. **Trend Strength** - Is ADX showing a tradable trend? (>20)
3. **Range State** - Are we stuck in tight compression? (avoid chop)

**Concrete Example — NO TRADE:**
```
15m ATR = 0.15% (below 25th percentile for last 100 candles)
ADX = 12 (no trend)
→ Market: NOT TRADABLE
→ Reason: Low volatility chop — wait for breakout
```

**If not tradable → Do nothing, show reason in UI**

---

## 7. Cooldowns & Throttles

**Prevent revenge trading and overtrading:**

| Rule | Value |
|------|-------|
| After stop-loss | Wait 5-10 minutes |
| Between any trades | Wait 2 minutes minimum |
| Max trades per hour | 3 |
| After 3 consecutive losses | Pause trading |

---

## 8. Entry & Exit

### Entry Confirmation (1m) - Binary Checks Only

Before entering, these must ALL pass:

| Check | Rule |
|-------|------|
| **Range Check** | 1m candle range < 2× ATR (not a spike) |
| **Momentum Check** | 1m shows continuation in signal direction |
| **No Exhaustion** | 1m RSI not at extreme (20-80 range) |

> Keep execution dumb. It should not "think" — just validate.

### Position Sizing

**Primary:** ATR-based (adapts to volatility)
- TP = 2-3× ATR
- SL = 1-1.5× ATR

**Floor only:** (never go below this)
- TP minimum = 1.2% (covers fees)
- SL minimum = 0.5%
- SL maximum = 2% (risk cap)

> ATR decides. Percent is a safety net, not the rule.

### Expected Trade Behavior

> **"If price does not show favorable excursion within 5 minutes, the thesis is invalid."**

Momentum trades should:
- Move quickly, OR
- Die quickly

If neither happens → the setup was wrong.

### Exit (whichever comes first)
1. **Take Profit** - Price hits ATR-based target ✅
2. **Stop Loss** - Price hits ATR-based stop ❌
3. **Trailing Stop** - Lock in profits as price moves
4. **Time Stop** - No favorable movement after 10-15 min
5. **Strong Reversal** - Score flips hard against us (±40) — *confirmation only, not primary*

> Primary exits are TP/SL/Trailing. Strong Reversal is a safety net for when momentum completely dies.

---

## 9. What The UI Shows

```
┌────────────────────────────────────────┐
│  Market: TRADABLE ✓                    │
│  1h Filter: BULLISH ✓                  │
│  15m Filter: BULLISH ✓                 │
│  3m Signal: LONG (Score: +28)          │
│  Status: Ready to trade                │
└────────────────────────────────────────┘
```

Or when blocked:

```
┌────────────────────────────────────────┐
│  Market: NOT TRADABLE                  │
│  Reason: Low volatility (chop)         │
│  Status: Waiting for conditions        │
└────────────────────────────────────────┘
```

---

## 10. Simple Example

**Scenario: Looking to go LONG**

```
1. Market Tradable?
   → 15m ATR normal, ADX = 28 ✓

2. 3m Signal?
   → Score = +32, Confidence = 71%
   → LONG signal ✓

3. 15m Filter?
   → EMA9 > EMA21
   → BULLISH ✓

4. 1h Filter?
   → EMA9 > EMA21
   → BULLISH ✓

5. All aligned!
   → Enter LONG at $137.50
   → Stop Loss: $136.80 (-0.5%)
   → Take Profit: $139.20 (+1.2%)

6. Wait for exit condition...
```

---

## Key Principles

1. **Trade WITH the trend** - Filters ensure this
2. **Only trade when worth it** - Tradability gate
3. **Don't overtrade** - Cooldowns and limits
4. **Let winners run** - No panic exits
5. **Cut losers quick** - ATR-based stops
6. **Trust the system** - UI shows why decisions are made

---

## What This System IS and ISN'T

**This is:**
- Execution + discipline alpha
- A system that survives by NOT trading bad setups
- Professional-grade risk management

**This is NOT:**
- Prediction alpha (we don't outsmart the market)
- High-frequency (we trade infrequently, with quality)
- Magic (fees and slippage still matter)

> Returns come from discipline and execution, not from better predictions.

---

## One Sentence Summary

> We trade SOL-USDC by generating momentum signals on 3m candles, allowing trades only when 15m and 1h trends align and the market is tradable, and executing entries on 1m with strict risk controls and throttles to prevent overtrading.
