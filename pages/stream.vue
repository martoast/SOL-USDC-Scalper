<!-- pages/stream.vue -->
<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';

interface SwapEvent {
  id: number;
  time: string;
  timestamp: number;
  type: 'BUY' | 'SELL';
  solDelta: number;
  usdcDelta: number;
  price: number;
  priceChange: number;
}

const streamStatus = ref({
  connected: false,
  swapsProcessed: 0,
  uptime: 0,
  pollCount: 0,
});

const priceData = ref({
  current: 0,
  change30s: 0,
  volume30s: 0,
});

const swapFeed = ref<SwapEvent[]>([]);
const isLoading = ref(true);

let refreshTimer: ReturnType<typeof setInterval> | null = null;
let lastPrice = 0;
let lastSwapCount = 0;
let swapId = 0;

// Stats
const stats = computed(() => {
  const buys = swapFeed.value.filter(s => s.type === 'BUY');
  const sells = swapFeed.value.filter(s => s.type === 'SELL');
  const totalVolume = swapFeed.value.reduce((acc, s) => acc + s.usdcDelta, 0);
  
  return {
    buyCount: buys.length,
    sellCount: sells.length,
    totalVolume,
    avgSize: swapFeed.value.length > 0 ? totalVolume / swapFeed.value.length : 0,
  };
});

const fetchStatus = async () => {
  try {
    const res = await fetch('/api/stream/status');
    const json = await res.json();

    if (json.success && json.data) {
      const { stream, price } = json.data;
      
      streamStatus.value = {
        connected: stream.connected,
        swapsProcessed: stream.swapsProcessed,
        uptime: stream.uptime,
        pollCount: stream.pollCount || 0,
      };

      const newPrice = price.current;
      const newSwapCount = stream.swapsProcessed;
      
      // Detect new swap
      if (newSwapCount > lastSwapCount && lastPrice > 0 && newPrice > 0) {
        const priceChange = ((newPrice - lastPrice) / lastPrice) * 100;
        const type: 'BUY' | 'SELL' = newPrice > lastPrice ? 'BUY' : 'SELL';
        
        // Estimate swap size from price impact (rough)
        const solDelta = Math.abs(priceChange) * 100; // Rough estimate
        const usdcDelta = solDelta * newPrice;
        
        swapFeed.value.unshift({
          id: ++swapId,
          time: new Date().toLocaleTimeString(),
          timestamp: Date.now(),
          type,
          solDelta: Math.abs(priceChange * 10), // Placeholder
          usdcDelta: Math.abs(priceChange * newPrice * 10), // Placeholder
          price: newPrice,
          priceChange,
        });
        
        // Keep last 100
        if (swapFeed.value.length > 100) {
          swapFeed.value = swapFeed.value.slice(0, 100);
        }
      }
      
      lastPrice = newPrice;
      lastSwapCount = newSwapCount;
      priceData.value = {
        current: price.current,
        change30s: price.change30s,
        volume30s: price.volume30s,
      };
    }
    isLoading.value = false;
  } catch (e: any) {
    isLoading.value = false;
  }
};

onMounted(() => {
  fetchStatus();
  refreshTimer = setInterval(fetchStatus, 500);
});

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer);
});

const formatDuration = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
};
</script>

<template>
  <div class="min-h-screen bg-gray-950 text-white">
    <!-- Header Bar -->
    <div class="bg-gray-900 border-b border-gray-800 px-4 py-3">
      <div class="max-w-7xl mx-auto flex items-center justify-between">
        <div class="flex items-center gap-4">
          <div class="flex items-center gap-2">
            <div
              class="w-2 h-2 rounded-full"
              :class="streamStatus.connected ? 'bg-green-500 animate-pulse' : 'bg-red-500'"
            />
            <span class="font-bold">SOL/USDC Stream</span>
          </div>
          <div class="text-2xl font-bold">
            ${{ priceData.current.toFixed(2) }}
          </div>
          <div 
            class="text-sm font-medium px-2 py-0.5 rounded"
            :class="priceData.change30s >= 0 ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'"
          >
            {{ priceData.change30s >= 0 ? '+' : '' }}{{ priceData.change30s.toFixed(3) }}%
          </div>
        </div>
        <div class="flex items-center gap-6 text-sm">
          <div>
            <span class="text-gray-400">Swaps:</span>
            <span class="text-purple-400 font-bold ml-1">{{ streamStatus.swapsProcessed }}</span>
          </div>
          <div>
            <span class="text-gray-400">Vol:</span>
            <span class="text-yellow-400 font-bold ml-1">${{ priceData.volume30s.toFixed(0) }}</span>
          </div>
          <div class="text-gray-500">
            {{ formatDuration(streamStatus.uptime) }}
          </div>
        </div>
      </div>
    </div>

    <div class="max-w-7xl mx-auto p-4">
      <div v-if="isLoading" class="text-center py-20 text-gray-500">Loading...</div>

      <div v-else class="grid grid-cols-4 gap-4">
        <!-- Stats Sidebar -->
        <div class="col-span-1 space-y-4">
          <!-- Buy/Sell Ratio -->
          <div class="bg-gray-900 rounded-lg p-4 border border-gray-800">
            <div class="text-xs text-gray-400 mb-3">Buy/Sell Ratio</div>
            <div class="flex gap-2 mb-2">
              <div 
                class="h-2 rounded-full bg-green-500"
                :style="{ width: `${stats.buyCount / (stats.buyCount + stats.sellCount || 1) * 100}%` }"
              />
              <div 
                class="h-2 rounded-full bg-red-500 flex-1"
              />
            </div>
            <div class="flex justify-between text-sm">
              <span class="text-green-400">{{ stats.buyCount }} buys</span>
              <span class="text-red-400">{{ stats.sellCount }} sells</span>
            </div>
          </div>

          <!-- Volume Stats -->
          <div class="bg-gray-900 rounded-lg p-4 border border-gray-800 space-y-3">
            <div class="text-xs text-gray-400">Session Stats</div>
            <div class="flex justify-between text-sm">
              <span class="text-gray-400">Total Volume</span>
              <span class="font-bold">${{ stats.totalVolume.toFixed(0) }}</span>
            </div>
            <div class="flex justify-between text-sm">
              <span class="text-gray-400">Avg Size</span>
              <span class="font-bold">${{ stats.avgSize.toFixed(0) }}</span>
            </div>
            <div class="flex justify-between text-sm">
              <span class="text-gray-400">Polls</span>
              <span>{{ streamStatus.pollCount }}</span>
            </div>
          </div>

          <!-- Links -->
          <div class="bg-gray-900 rounded-lg p-4 border border-gray-800">
            <div class="text-xs text-gray-400 mb-3">Links</div>
            <div class="space-y-2">
              <a 
                href="https://raydium.io/swap/?inputMint=sol&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
                target="_blank"
                class="block text-sm text-blue-400 hover:text-blue-300"
              >
                Trade on Raydium →
              </a>
              <a 
                href="https://birdeye.so/token/So11111111111111111111111111111111111111112?chain=solana"
                target="_blank"
                class="block text-sm text-blue-400 hover:text-blue-300"
              >
                View on Birdeye →
              </a>
            </div>
          </div>
        </div>

        <!-- Swap Feed -->
        <div class="col-span-3 bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
          <div class="bg-gray-800 px-4 py-2 flex items-center justify-between">
            <span class="font-medium">Live Swaps</span>
            <span class="text-sm text-gray-400">{{ swapFeed.length }} events</span>
          </div>
          
          <div class="max-h-[calc(100vh-200px)] overflow-y-auto">
            <table class="w-full text-sm">
              <thead class="bg-gray-800/50 text-gray-400 text-xs sticky top-0">
                <tr>
                  <th class="px-4 py-2 text-left">Time</th>
                  <th class="px-4 py-2 text-left">Type</th>
                  <th class="px-4 py-2 text-right">Price</th>
                  <th class="px-4 py-2 text-right">Change</th>
                  <th class="px-4 py-2 text-right">Est. USD</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-800">
                <tr v-if="swapFeed.length === 0">
                  <td colspan="5" class="text-center py-12 text-gray-500">
                    Waiting for swaps...
                  </td>
                </tr>
                <tr
                  v-for="swap in swapFeed"
                  :key="swap.id"
                  class="hover:bg-gray-800/30 transition-colors"
                  :class="swap.type === 'BUY' ? 'bg-green-900/5' : 'bg-red-900/5'"
                >
                  <td class="px-4 py-2 text-gray-400 font-mono text-xs">
                    {{ swap.time }}
                  </td>
                  <td class="px-4 py-2">
                    <span 
                      class="px-2 py-0.5 rounded text-xs font-bold"
                      :class="swap.type === 'BUY' ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'"
                    >
                      {{ swap.type }}
                    </span>
                  </td>
                  <td class="px-4 py-2 text-right font-mono">
                    ${{ swap.price.toFixed(4) }}
                  </td>
                  <td class="px-4 py-2 text-right">
                    <span 
                      class="font-medium"
                      :class="swap.priceChange >= 0 ? 'text-green-400' : 'text-red-400'"
                    >
                      {{ swap.priceChange >= 0 ? '+' : '' }}{{ swap.priceChange.toFixed(4) }}%
                    </span>
                  </td>
                  <td class="px-4 py-2 text-right text-yellow-400 font-mono">
                    ${{ swap.usdcDelta.toFixed(0) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>