<!-- pages/test.vue -->
<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';

interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trades: number;
  timestamp: number;
}

const streamStatus = ref({
  connected: false,
  swapsProcessed: 0,
  messagesReceived: 0,
  errors: 0,
  uptime: 0,
  lastMessageAgo: 0,
  pollCount: 0,
});

const priceData = ref({
  current: 0,
  change30s: 0,
  volume30s: 0,
  timestamp: 0,
});

const candleData = ref<{
  stats: { totalCandles: number; totalTrades: number };
  priceChanges: Record<string, number>;
  current: Record<string, Candle | null>;
}>({
  stats: { totalCandles: 0, totalTrades: 0 },
  priceChanges: {},
  current: {},
});

const isLoading = ref(true);
const activeTimeframe = ref<string>('1m');
const swapHistory = ref<Array<{
  time: string;
  type: 'BUY' | 'SELL';
  price: number;
  change: number;
}>>([]);

let refreshTimer: ReturnType<typeof setInterval> | null = null;
let lastPrice = 0;
let lastSwapCount = 0;

// Timeframes for display
const timeframes = ['1s', '1m', '2m', '5m', '10m', '30m', '1h'];

// Computed stats
const buyCount = computed(() => swapHistory.value.filter(s => s.type === 'BUY').length);
const sellCount = computed(() => swapHistory.value.filter(s => s.type === 'SELL').length);
const buyPercent = computed(() => {
  const total = buyCount.value + sellCount.value;
  return total > 0 ? (buyCount.value / total) * 100 : 50;
});

const currentCandle = computed(() => {
  return candleData.value.current[activeTimeframe.value] || null;
});

const fetchStatus = async () => {
  try {
    const res = await fetch('/api/stream/status');
    const json = await res.json();

    if (json.success && json.data) {
      streamStatus.value = json.data.stream;
      const newPrice = json.data.price.current;
      const newSwapCount = json.data.stream.swapsProcessed;

      // Update candle data
      if (json.data.candles) {
        candleData.value = json.data.candles;
      }

      // Detect new swap
      if (newSwapCount > lastSwapCount && lastPrice > 0) {
        const change = ((newPrice - lastPrice) / lastPrice) * 100;
        const type = newPrice > lastPrice ? 'BUY' : 'SELL';

        swapHistory.value.unshift({
          time: new Date().toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
          }),
          type,
          price: newPrice,
          change,
        });

        if (swapHistory.value.length > 100) {
          swapHistory.value = swapHistory.value.slice(0, 100);
        }
      }

      lastPrice = newPrice;
      lastSwapCount = newSwapCount;
      priceData.value = json.data.price;
    }
    isLoading.value = false;
  } catch (e: any) {
    isLoading.value = false;
  }
};

onMounted(() => {
  fetchStatus();
  refreshTimer = setInterval(fetchStatus, 1000);
});

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer);
});

const formatDuration = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
};

const formatChange = (change: number | undefined) => {
  if (change === undefined || isNaN(change)) return '0.000';
  return change.toFixed(3);
};

const getChangeClass = (change: number | undefined) => {
  if (!change || change === 0) return 'text-gray-400';
  return change > 0 ? 'text-green-400' : 'text-red-400';
};
</script>

<template>
  <div class="min-h-screen bg-black text-white">
    <!-- Status Bar -->
    <div class="bg-gray-900/80 backdrop-blur-sm border-b border-gray-800 px-4 py-2 sticky top-0 z-10">
      <div class="flex items-center justify-between max-w-2xl mx-auto">
        <div class="flex items-center gap-2">
          <div
            class="w-2 h-2 rounded-full"
            :class="streamStatus.connected ? 'bg-green-500 animate-pulse' : 'bg-red-500'"
          />
          <span class="text-sm font-medium">SOL/USDC</span>
        </div>
        <div class="flex items-center gap-3 text-xs text-gray-400">
          <span>{{ formatDuration(streamStatus.uptime) }}</span>
          <span class="text-purple-400 font-medium">{{ candleData.stats.totalCandles }} candles</span>
        </div>
      </div>
    </div>

    <div v-if="isLoading" class="flex items-center justify-center h-[80vh]">
      <div class="text-gray-500">Loading...</div>
    </div>

    <div v-else class="max-w-2xl mx-auto px-4 py-4 space-y-4">

      <!-- Price Card -->
      <div class="bg-gradient-to-br from-gray-900 to-gray-950 rounded-2xl p-5 border border-gray-800">
        <div class="flex items-start justify-between mb-2">
          <div class="text-gray-400 text-sm">SOL Price</div>
          <div
            class="px-2 py-0.5 rounded-full text-xs font-bold"
            :class="priceData.change30s >= 0 ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'"
          >
            {{ priceData.change30s >= 0 ? '↑' : '↓' }} {{ Math.abs(priceData.change30s).toFixed(3) }}%
          </div>
        </div>

        <!-- Big Price -->
        <div class="flex items-baseline gap-1 mb-4">
          <span class="text-4xl font-bold tracking-tight">${{ Math.floor(priceData.current) }}</span>
          <span class="text-2xl text-gray-400">.{{ (priceData.current % 1).toFixed(4).slice(2) }}</span>
        </div>

        <!-- Timeframe Price Changes -->
        <div class="grid grid-cols-4 gap-2 mb-4">
          <button
            v-for="tf in ['1m', '5m', '10m', '1h']"
            :key="tf"
            @click="activeTimeframe = tf"
            class="p-2 rounded-lg text-center transition-all"
            :class="activeTimeframe === tf ? 'bg-blue-600' : 'bg-gray-800 hover:bg-gray-700'"
          >
            <div class="text-xs text-gray-400">{{ tf }}</div>
            <div
              class="text-sm font-bold"
              :class="getChangeClass(candleData.priceChanges[tf])"
            >
              {{ candleData.priceChanges[tf] >= 0 ? '+' : '' }}{{ formatChange(candleData.priceChanges[tf]) }}%
            </div>
          </button>
        </div>

        <!-- Buy/Sell Stats -->
        <div class="grid grid-cols-2 gap-3">
          <div class="bg-black/30 rounded-xl p-3 text-center">
            <div class="text-green-400 text-lg font-bold">{{ buyCount }}</div>
            <div class="text-xs text-gray-500">Buys</div>
          </div>
          <div class="bg-black/30 rounded-xl p-3 text-center">
            <div class="text-red-400 text-lg font-bold">{{ sellCount }}</div>
            <div class="text-xs text-gray-500">Sells</div>
          </div>
        </div>

        <!-- Buy/Sell Bar -->
        <div class="mt-4">
          <div class="flex gap-1 h-2 rounded-full overflow-hidden bg-gray-800">
            <div
              class="bg-green-500 transition-all duration-300"
              :style="{ width: `${buyPercent}%` }"
            />
            <div class="bg-red-500 flex-1" />
          </div>
          <div class="flex justify-between text-xs text-gray-500 mt-1">
            <span>{{ buyPercent.toFixed(0) }}% buys</span>
            <span>{{ (100 - buyPercent).toFixed(0) }}% sells</span>
          </div>
        </div>
      </div>

      <!-- Current Candle Card -->
      <div class="bg-gray-900/50 rounded-2xl border border-gray-800 p-4">
        <div class="flex items-center justify-between mb-3">
          <span class="font-medium">Current {{ activeTimeframe }} Candle</span>
          <span class="text-xs text-gray-500">{{ candleData.stats.totalTrades }} trades</span>
        </div>

        <div v-if="currentCandle" class="grid grid-cols-4 gap-3">
          <div class="bg-black/30 rounded-lg p-3 text-center">
            <div class="text-xs text-gray-500 mb-1">Open</div>
            <div class="font-mono text-sm">${{ currentCandle.open.toFixed(2) }}</div>
          </div>
          <div class="bg-black/30 rounded-lg p-3 text-center">
            <div class="text-xs text-gray-500 mb-1">High</div>
            <div class="font-mono text-sm text-green-400">${{ currentCandle.high.toFixed(2) }}</div>
          </div>
          <div class="bg-black/30 rounded-lg p-3 text-center">
            <div class="text-xs text-gray-500 mb-1">Low</div>
            <div class="font-mono text-sm text-red-400">${{ currentCandle.low.toFixed(2) }}</div>
          </div>
          <div class="bg-black/30 rounded-lg p-3 text-center">
            <div class="text-xs text-gray-500 mb-1">Close</div>
            <div class="font-mono text-sm">${{ currentCandle.close.toFixed(2) }}</div>
          </div>
        </div>

        <div v-else class="text-center py-8 text-gray-600">
          <div class="text-xl mb-2">📊</div>
          <div>Waiting for candle data...</div>
        </div>

        <!-- Candle Visual -->
        <div v-if="currentCandle" class="mt-4 flex items-center justify-center">
          <div class="relative h-24 w-16 flex items-center justify-center">
            <!-- Wick -->
            <div
              class="absolute w-0.5 bg-gray-500"
              :style="{
                top: '0%',
                bottom: '0%',
              }"
            />
            <!-- Body -->
            <div
              class="absolute w-8 rounded"
              :class="currentCandle.close >= currentCandle.open ? 'bg-green-500' : 'bg-red-500'"
              :style="{
                top: `${Math.min(
                  (1 - (Math.max(currentCandle.open, currentCandle.close) - currentCandle.low) / (currentCandle.high - currentCandle.low || 1)) * 100,
                  95
                )}%`,
                bottom: `${Math.min(
                  ((Math.min(currentCandle.open, currentCandle.close) - currentCandle.low) / (currentCandle.high - currentCandle.low || 1)) * 100,
                  95
                )}%`,
              }"
            />
          </div>
          <div class="ml-4 text-sm">
            <div class="text-gray-400">Range</div>
            <div class="font-mono">
              ${{ (currentCandle.high - currentCandle.low).toFixed(4) }}
            </div>
            <div class="text-xs text-gray-500">
              {{ currentCandle.trades }} trades
            </div>
          </div>
        </div>
      </div>

      <!-- All Timeframes -->
      <div class="bg-gray-900/50 rounded-2xl border border-gray-800 overflow-hidden">
        <div class="px-4 py-3 border-b border-gray-800">
          <span class="font-medium">All Timeframes</span>
        </div>
        <div class="divide-y divide-gray-800/50">
          <div
            v-for="tf in timeframes"
            :key="tf"
            class="px-4 py-3 flex items-center justify-between"
            :class="activeTimeframe === tf ? 'bg-blue-900/20' : ''"
            @click="activeTimeframe = tf"
          >
            <div class="flex items-center gap-3">
              <div class="w-12 text-sm font-medium">{{ tf }}</div>
              <div
                class="text-sm font-bold"
                :class="getChangeClass(candleData.priceChanges[tf])"
              >
                {{ candleData.priceChanges[tf] >= 0 ? '+' : '' }}{{ formatChange(candleData.priceChanges[tf]) }}%
              </div>
            </div>
            <div class="text-xs text-gray-500">
              {{ candleData.current[tf]?.trades || 0 }} trades
            </div>
          </div>
        </div>
      </div>

      <!-- Live Feed -->
      <div class="bg-gray-900/50 rounded-2xl border border-gray-800 overflow-hidden">
        <div class="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
          <span class="font-medium">Live Feed</span>
          <span class="text-xs text-gray-500">{{ swapHistory.length }} events</span>
        </div>

        <div class="divide-y divide-gray-800/50 max-h-[40vh] overflow-y-auto">
          <div v-if="swapHistory.length === 0" class="text-center py-12 text-gray-600">
            <div class="text-2xl mb-2">📡</div>
            <div>Waiting for price changes...</div>
          </div>

          <div
            v-for="(swap, i) in swapHistory"
            :key="i"
            class="px-4 py-2 flex items-center justify-between"
            :class="i === 0 ? 'bg-gray-800/30' : ''"
          >
            <div class="flex items-center gap-3">
              <div
                class="w-7 h-7 rounded-full flex items-center justify-center text-xs"
                :class="swap.type === 'BUY' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'"
              >
                {{ swap.type === 'BUY' ? '↑' : '↓' }}
              </div>
              <div>
                <div class="font-mono text-sm">${{ swap.price.toFixed(4) }}</div>
                <div class="text-xs text-gray-500">{{ swap.time }}</div>
              </div>
            </div>
            <div
              class="font-mono text-sm font-medium"
              :class="swap.change >= 0 ? 'text-green-400' : 'text-red-400'"
            >
              {{ swap.change >= 0 ? '+' : '' }}{{ swap.change.toFixed(4) }}%
            </div>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="flex items-center justify-center gap-6 text-xs text-gray-500 py-2">
        <div class="flex items-center gap-1">
          <span class="w-1.5 h-1.5 rounded-full bg-green-500"></span>
          Jupiter API
        </div>
        <div>{{ streamStatus.errors }} errors</div>
        <div>{{ streamStatus.pollCount }} polls</div>
      </div>
    </div>
  </div>
</template>