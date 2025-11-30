# 🤖 SOL/USDC Scalper

A real-time SOL/USDC momentum scalping bot built with Nuxt 3. Features live price streaming, candle building, and automated trading with a beautiful mobile-first UI.

![Status](https://img.shields.io/badge/status-active-green)
![Framework](https://img.shields.io/badge/framework-Nuxt%203-00DC82)
![API](https://img.shields.io/badge/price%20feed-Jupiter-purple)

---

## 📊 System Architecture
```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              JUPITER QUOTE API                                   │
│                         https://lite-api.jup.ag/swap/v1/quote                   │
│                                                                                 │
│                         Real-time SOL → USDC quotes                             │
│                         Rate: 1 request every 2 seconds                         │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           HELIUS STREAM (server)                                 │
│                         server/utils/helius-stream.ts                           │
│                                                                                 │
│  • Polls Jupiter API every 2 seconds                                           │
│  • Detects price changes (> 0.001%)                                            │
│  • Feeds prices to Candle Engine                                               │
│  • Tracks 30-second price history                                              │
│  • Handles rate limiting with 60s backoff                                      │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           SOL CANDLE ENGINE                                      │
│                         server/utils/sol-candles.ts                             │
│                                                                                 │
│  Builds OHLCV candles from price updates:                                       │
│  ┌──────────┬─────────────┬──────────────────────────────────┐                 │
│  │ Timeframe │ Max Stored  │ Duration Covered                 │                 │
│  ├──────────┼─────────────┼──────────────────────────────────┤                 │
│  │ 1s       │ 120 candles │ 2 minutes                        │                 │
│  │ 1m       │ 60 candles  │ 1 hour                           │                 │
│  │ 2m       │ 60 candles  │ 2 hours                          │                 │
│  │ 5m       │ 60 candles  │ 5 hours                          │                 │
│  │ 10m      │ 60 candles  │ 10 hours                         │                 │
│  │ 30m      │ 48 candles  │ 24 hours                         │                 │
│  │ 1h       │ 48 candles  │ 48 hours                         │                 │
│  └──────────┴─────────────┴──────────────────────────────────┘                 │
│                                                                                 │
│  Each candle contains: open, high, low, close, volume, trades, timestamp       │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              API LAYER                                           │
│                                                                                 │
│  GET  /api/stream/status   → Price, candles, stream health                     │
│  GET  /api/stream/candles  → Candle data by timeframe                          │
│  GET  /api/portfolio       → Active trades + history + stats                   │
│  POST /api/trade           → Open/close positions                              │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (Nuxt 3)                                   │
│                              pages/index.vue                                    │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                         PRICE DISPLAY                                    │   │
│  │  • Current SOL/USDC price with 4 decimal precision                      │   │
│  │  • 30-second price change indicator                                     │   │
│  │  • Timeframe buttons (1m, 5m, 10m, 1h) with price changes              │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                         TRADING ENGINE                                   │   │
│  │  • Test Mode: Random entries for testing                                │   │
│  │  • Live Mode: Entry on price change threshold                           │   │
│  │  • Auto TP/SL exits                                                     │   │
│  │  • Manual entry/exit controls                                           │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                         POSITION TRACKING                                │   │
│  │  • Real-time P&L calculation                                            │   │
│  │  • Entry/current/target/stop prices                                     │   │
│  │  • Hold time tracking                                                   │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                         STATS & HISTORY                                  │   │
│  │  • Total trades, win rate, total P&L                                    │   │
│  │  • Trade history with entry/exit prices                                 │   │
│  │  • Console logs for debugging                                           │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           PERSISTENCE LAYER                                      │
│                           data/trades.json                                      │
│                                                                                 │
│  {                                                                              │
│    "activeTrades": [...],   // Currently open positions                        │
│    "history": [...]         // Closed trades with P&L                          │
│  }                                                                              │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 📁 Project Structure
```
├── pages/
│   ├── index.vue              # Main trading dashboard
│   └── test.vue               # Stream testing page
│
├── server/
│   ├── api/
│   │   ├── stream/
│   │   │   ├── status.get.ts  # Price + candles + stream stats
│   │   │   └── candles.get.ts # Candle data by timeframe
│   │   ├── portfolio.get.ts   # Get trades + stats
│   │   └── trade.post.ts      # Open/close positions
│   │
│   ├── plugins/
│   │   └── helius-stream.server.ts  # Auto-start stream on boot
│   │
│   └── utils/
│       ├── helius-stream.ts   # Jupiter price polling
│       ├── sol-candles.ts     # OHLCV candle building
│       └── db.ts              # JSON file persistence
│
├── data/
│   └── trades.json            # Persisted trades
│
├── nuxt.config.ts             # Nuxt configuration
└── package.json               # Dependencies
```

---

## 🔧 Key Files Explained

### `server/utils/helius-stream.ts`
The heart of the price feed system. Polls Jupiter's quote API every 2 seconds to get real-time SOL/USDC prices.

**Key functions:**
- `startStream()` - Begins polling loop
- `stopStream()` - Stops polling
- `fetchPrice()` - Gets quote from Jupiter, updates candle engine
- `getCurrentPrice()` - Returns latest price data
- `getPriceChange30s()` - Returns 30-second price change %

**Rate limiting:**
- Polls every 2 seconds (30 req/min, under 60/min limit)
- 60-second backoff on 429 errors

### `server/utils/sol-candles.ts`
Builds OHLCV candles from price updates. Maintains candles for 7 timeframes simultaneously.

**Key functions:**
- `updatePrice(price, timestamp)` - Updates all timeframe candles
- `getCandles(timeframe, limit)` - Get candle history
- `getCurrentCandle(timeframe)` - Get current open candle
- `getPriceChange(timeframe)` - Calculate % change for timeframe
- `getAllPriceChanges()` - Get changes for all timeframes

**Candle structure:**
```typescript
interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trades: number;
  timestamp: number;
}
```

### `server/utils/db.ts`
Simple JSON file persistence for trades.

**Key functions:**
- `getDb()` - Load trades from file
- `saveDb(data)` - Save trades to file

**Data structure:**
```typescript
interface Database {
  activeTrades: Trade[];
  history: Trade[];
}
```

### `server/api/trade.post.ts`
Handles opening and closing positions.

**Actions:**
- `OPEN` - Creates new trade, adds to activeTrades
- `CLOSE` - Calculates P&L, moves to history

### `server/api/stream/status.get.ts`
Returns complete system status including price, candles, and stream health.

**Response:**
```typescript
{
  success: true,
  data: {
    stream: { connected, swapsProcessed, uptime, errors },
    price: { current, change30s, volume30s },
    candles: { stats, priceChanges, current }
  }
}
```

### `pages/index.vue`
Main trading dashboard with all UI components.

**Features:**
- Real-time price display
- Timeframe price change buttons
- Position card with live P&L
- Stats row (trades, win rate, P&L, W/L)
- Tabs: Candles, Trades history, Console logs
- Settings modal for configuration

**Trading modes:**
- **Test Mode**: Random entries (configurable chance %)
- **Live Mode**: Entry on price change threshold

---

## ⚙️ Configuration

### Environment Variables
```bash
# .env
NUXT_HELIUS_API_KEY=your-helius-key      # Optional (for future use)
NUXT_JUPITER_API_KEY=your-jupiter-key    # Optional (for higher rate limits)
NUXT_PUBLIC_SOLANA_NETWORK=devnet        # devnet or mainnet
```

### Trading Settings (UI Configurable)

| Setting | Default | Description |
|---------|---------|-------------|
| Entry Threshold | 0.1% | Price change % to trigger entry (live mode) |
| Take Profit | 0.05% | Exit when P&L reaches this % |
| Stop Loss | -0.03% | Exit when P&L drops to this % |
| Position Size | 0.1 SOL | Amount per trade |
| Entry Timeframe | 1m | Timeframe for entry signals |
| Test Entry Chance | 20% | Random entry probability (test mode) |
| Test Exit After | 10s | Auto-exit delay (test mode) |

---

## 🚀 Getting Started

### 1. Install Dependencies
```bash
yarn install
```

### 2. Create Data Directory
```bash
mkdir -p data
echo '{"activeTrades":[],"history":[]}' > data/trades.json
```

### 3. Run Development Server
```bash
yarn dev
```

### 4. Open Dashboard
```
http://localhost:3000
```

### 5. Test the System
1. Click **▶ Start** to begin auto-trading in test mode
2. Watch random trades execute
3. Check P&L updating in stats
4. Click **⚙️** to adjust settings
5. Toggle off **Test Mode** for real signals

---

## 💰 Trading Logic

### Entry Conditions

**Test Mode:**
- Random roll each second
- If roll < testEntryChance%, enter position

**Live Mode:**
- Monitor selected timeframe's price change
- If priceChange >= entryThreshold%, enter position

### Exit Conditions

**Take Profit:**
- Current P&L >= takeProfitPercent → Exit

**Stop Loss:**
- Current P&L <= stopLossPercent → Exit

**Test Mode Auto-Exit:**
- Hold time >= testExitAfterSeconds → Exit

**Manual:**
- Click "Close" button → Exit at current price

### P&L Calculation
```typescript
const currentValue = solAmount * currentPrice;
const pnlUsd = currentValue - usdAmount;
const pnlPercent = (pnlUsd / usdAmount) * 100;
```

---

## 📈 Data Flow
```
Jupiter API
    │
    ▼ (every 2s)
fetchPrice()
    │
    ├──► updatePrice() ──► Candle Engine
    │                          │
    │                          ▼
    │                    Build/update candles
    │                    for all timeframes
    │
    ▼
Frontend polls /api/stream/status (every 1s)
    │
    ├──► Update price display
    ├──► Update candle data
    └──► Trading engine checks signals
              │
              ├──► Entry? ──► POST /api/trade (OPEN)
              │                    │
              │                    ▼
              │               Save to trades.json
              │
              └──► Exit? ──► POST /api/trade (CLOSE)
                                  │
                                  ▼
                             Calculate P&L
                             Move to history
                             Update stats
```

---

## 🔒 Rate Limits

| Service | Limit | Our Usage |
|---------|-------|-----------|
| Jupiter Lite API | 60 req/min | ~30 req/min (1 every 2s) |
| Frontend polling | - | 60 req/min (1 every 1s) |

**Backoff strategy:**
- On 429 error, pause for 60 seconds
- Auto-resume after backoff

---

## 📱 Mobile Support

The UI is designed mobile-first with:
- Responsive grid layouts
- Touch-friendly buttons
- Sticky header
- Scrollable trade history
- Modal settings panel

---

## 🧪 Testing

### Test Mode Features
- Random entries to test full trade flow
- Configurable entry probability
- Auto-exit after configurable time
- All trades saved to history

### Stream Test Page
Visit `/test` to see:
- Raw price feed
- All timeframe candles
- Swap detection logs

---

## 📝 API Reference

### GET /api/stream/status
Returns current price, candle data, and stream health.

### GET /api/stream/candles?timeframe=1m&limit=50
Returns candle history for specified timeframe.

### GET /api/portfolio
Returns active trades, history, and calculated stats.

### POST /api/trade
```json
// Open position
{
  "action": "OPEN",
  "trade": {
    "symbol": "SOL/USDC",
    "entryPrice": 136.50,
    "amount": 13.65
  }
}

// Close position
{
  "action": "CLOSE",
  "tradeId": "abc123",
  "exitPrice": 136.60,
  "pnl": 0.01,
  "reason": "TAKE_PROFIT"
}
```

---

## 🛠️ Tech Stack

- **Framework**: Nuxt 3
- **Styling**: Tailwind CSS
- **Price Feed**: Jupiter Quote API
- **Persistence**: JSON file
- **Language**: TypeScript

---

## ⚠️ Disclaimer

This bot is for educational and testing purposes only. Trading cryptocurrencies carries significant risk. This is a paper trading system - no real trades are executed. Never trade with money you cannot afford to lose.

---

## 📄 License

MIT