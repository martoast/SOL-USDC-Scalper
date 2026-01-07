<template>
  <div class="trading-chart-container">
    <!-- Main Candlestick Chart -->
    <div ref="mainChartContainer" class="main-chart"></div>

    <!-- RSI Panel -->
    <div ref="rsiChartContainer" class="rsi-chart"></div>

    <!-- MACD Panel -->
    <div ref="macdChartContainer" class="macd-chart"></div>

    <!-- Signal Panel -->
    <div v-if="signal" class="signal-panel">
      <div class="signal-header">
        <span
          class="signal-direction"
          :class="{
            'text-green-400': signal.direction === 'LONG',
            'text-red-400': signal.direction === 'SHORT',
            'text-gray-400': signal.direction === 'NONE'
          }"
        >
          {{ signal.direction === 'LONG' ? '▲ LONG' : signal.direction === 'SHORT' ? '▼ SHORT' : '● NEUTRAL' }}
        </span>
        <span class="signal-score" :class="getScoreColor(signal.score)">
          Score: {{ signal.score?.toFixed(0) || 0 }}
        </span>
        <span class="signal-confidence">
          {{ signal.confidence?.toFixed(0) || 0 }}% confidence
        </span>
      </div>
      <div v-if="signal.reasons?.length" class="signal-reasons">
        <div v-for="(reason, idx) in signal.reasons.slice(0, 3)" :key="idx" class="reason">
          {{ reason }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import {
  createChart,
  CrosshairMode,
  LineStyle,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
} from 'lightweight-charts';
import type { IChartApi, ISeriesApi, Time } from 'lightweight-charts';

// Types
interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
}

interface SignalData {
  direction: 'LONG' | 'SHORT' | 'NONE';
  score: number;
  confidence: number;
  reasons: string[];
  shouldEnter?: boolean;
}

// Props
const props = defineProps<{
  candles: Candle[];
  indicators: any;
  signal: SignalData | null;
  timeframe: string;
}>();

// Chart refs
const mainChartContainer = ref<HTMLElement | null>(null);
const rsiChartContainer = ref<HTMLElement | null>(null);
const macdChartContainer = ref<HTMLElement | null>(null);

// Chart instances
let mainChart: IChartApi | null = null;
let rsiChart: IChartApi | null = null;
let macdChart: IChartApi | null = null;

// Series refs
let candleSeries: ISeriesApi<'Candlestick'> | null = null;
let ema9Series: ISeriesApi<'Line'> | null = null;
let ema21Series: ISeriesApi<'Line'> | null = null;
let bbUpperSeries: ISeriesApi<'Line'> | null = null;
let bbMiddleSeries: ISeriesApi<'Line'> | null = null;
let bbLowerSeries: ISeriesApi<'Line'> | null = null;
let rsiSeries: ISeriesApi<'Line'> | null = null;
let rsiOverbought: ISeriesApi<'Line'> | null = null;
let rsiOversold: ISeriesApi<'Line'> | null = null;
let macdLineSeries: ISeriesApi<'Line'> | null = null;
let macdSignalSeries: ISeriesApi<'Line'> | null = null;
let macdHistogramSeries: ISeriesApi<'Histogram'> | null = null;

// Chart options (dark theme matching existing UI)
const chartOptions = {
  layout: {
    background: { color: '#111827' },
    textColor: '#9CA3AF',
  },
  grid: {
    vertLines: { color: '#1F2937' },
    horzLines: { color: '#1F2937' },
  },
  crosshair: {
    mode: CrosshairMode.Normal,
  },
  rightPriceScale: {
    borderColor: '#374151',
  },
  timeScale: {
    borderColor: '#374151',
    timeVisible: true,
    secondsVisible: false,
  },
};

// Helper to get score color
function getScoreColor(score: number | undefined): string {
  if (!score) return 'text-gray-400';
  if (score > 30) return 'text-green-400';
  if (score < -30) return 'text-red-400';
  return 'text-yellow-400';
}

// Calculate simple EMA for display
function calculateEMA(prices: number[], period: number): number[] {
  const result: number[] = [];
  if (prices.length < period) return result;

  const multiplier = 2 / (period + 1);

  // Start with SMA
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += prices[i];
  }
  let ema = sum / period;
  result.push(ema);

  // Calculate EMA for remaining
  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
    result.push(ema);
  }

  return result;
}

// Calculate RSI
function calculateRSI(prices: number[], period: number = 14): number[] {
  const result: number[] = [];
  if (prices.length < period + 1) return result;

  const gains: number[] = [];
  const losses: number[] = [];

  for (let i = 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? -change : 0);
  }

  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i <= gains.length; i++) {
    if (avgLoss === 0) {
      result.push(100);
    } else {
      const rs = avgGain / avgLoss;
      result.push(100 - (100 / (1 + rs)));
    }

    if (i < gains.length) {
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    }
  }

  return result;
}

// Calculate Bollinger Bands
function calculateBB(prices: number[], period: number = 20, stdDev: number = 2): { upper: number[]; middle: number[]; lower: number[] } {
  const upper: number[] = [];
  const middle: number[] = [];
  const lower: number[] = [];

  for (let i = period - 1; i < prices.length; i++) {
    const slice = prices.slice(i - period + 1, i + 1);
    const sma = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((sum, val) => sum + Math.pow(val - sma, 2), 0) / period;
    const std = Math.sqrt(variance);

    middle.push(sma);
    upper.push(sma + stdDev * std);
    lower.push(sma - stdDev * std);
  }

  return { upper, middle, lower };
}

// Calculate MACD
function calculateMACD(prices: number[], fast: number = 12, slow: number = 26, signal: number = 9): { macd: number[]; signal: number[]; histogram: number[] } {
  const emaFast = calculateEMA(prices, fast);
  const emaSlow = calculateEMA(prices, slow);

  const macdLine: number[] = [];
  const offset = slow - fast;

  for (let i = 0; i < emaSlow.length; i++) {
    macdLine.push(emaFast[i + offset] - emaSlow[i]);
  }

  const signalLine = calculateEMA(macdLine, signal);
  const histogram: number[] = [];

  const signalOffset = signal - 1;
  for (let i = 0; i < signalLine.length; i++) {
    histogram.push(macdLine[i + signalOffset] - signalLine[i]);
  }

  return { macd: macdLine, signal: signalLine, histogram };
}

// Initialize all charts
function initCharts() {
  if (!mainChartContainer.value || !rsiChartContainer.value || !macdChartContainer.value) return;

  // Main candlestick chart
  mainChart = createChart(mainChartContainer.value, {
    ...chartOptions,
    height: 300,
  });

  // Add candlestick series (v5 API)
  candleSeries = mainChart.addSeries(CandlestickSeries, {
    upColor: '#10B981',
    downColor: '#EF4444',
    borderUpColor: '#10B981',
    borderDownColor: '#EF4444',
    wickUpColor: '#10B981',
    wickDownColor: '#EF4444',
  });

  // EMA lines
  ema9Series = mainChart.addSeries(LineSeries, {
    color: '#3B82F6',
    lineWidth: 1,
    title: 'EMA9',
  });

  ema21Series = mainChart.addSeries(LineSeries, {
    color: '#F59E0B',
    lineWidth: 1,
    title: 'EMA21',
  });

  // Bollinger Bands
  bbUpperSeries = mainChart.addSeries(LineSeries, {
    color: '#8B5CF6',
    lineWidth: 1,
    lineStyle: LineStyle.Dashed,
  });

  bbMiddleSeries = mainChart.addSeries(LineSeries, {
    color: '#8B5CF680',
    lineWidth: 1,
  });

  bbLowerSeries = mainChart.addSeries(LineSeries, {
    color: '#8B5CF6',
    lineWidth: 1,
    lineStyle: LineStyle.Dashed,
  });

  // RSI chart
  rsiChart = createChart(rsiChartContainer.value, {
    ...chartOptions,
    height: 100,
  });

  rsiSeries = rsiChart.addSeries(LineSeries, {
    color: '#10B981',
    lineWidth: 2,
    title: 'RSI',
  });

  // RSI overbought/oversold lines
  rsiOverbought = rsiChart.addSeries(LineSeries, {
    color: '#EF444480',
    lineWidth: 1,
    lineStyle: LineStyle.Dashed,
  });

  rsiOversold = rsiChart.addSeries(LineSeries, {
    color: '#10B98180',
    lineWidth: 1,
    lineStyle: LineStyle.Dashed,
  });

  // MACD chart
  macdChart = createChart(macdChartContainer.value, {
    ...chartOptions,
    height: 100,
  });

  macdLineSeries = macdChart.addSeries(LineSeries, {
    color: '#3B82F6',
    lineWidth: 1,
    title: 'MACD',
  });

  macdSignalSeries = macdChart.addSeries(LineSeries, {
    color: '#F59E0B',
    lineWidth: 1,
    title: 'Signal',
  });

  macdHistogramSeries = macdChart.addSeries(HistogramSeries, {
    color: '#10B981',
  });

  // Sync time scales (with null safety)
  mainChart.timeScale().subscribeVisibleTimeRangeChange(() => {
    try {
      const range = mainChart?.timeScale().getVisibleRange();
      if (range && range.from && range.to) {
        rsiChart?.timeScale().setVisibleRange(range);
        macdChart?.timeScale().setVisibleRange(range);
      }
    } catch {
      // Ignore errors during sync - chart may not be fully initialized
    }
  });

  // Initial data load
  updateChartData();
}

// Update chart with new data
function updateChartData() {
  if (!props.candles || props.candles.length === 0) return;

  // Sort and deduplicate by timestamp (chart requires unique ascending timestamps)
  const sorted = [...props.candles].sort((a, b) => a.timestamp - b.timestamp);
  const deduped: Candle[] = [];
  let lastTimestamp = 0;
  for (const candle of sorted) {
    if (candle.timestamp > lastTimestamp) {
      deduped.push(candle);
      lastTimestamp = candle.timestamp;
    }
  }

  if (deduped.length === 0) return;

  const prices = deduped.map(c => c.close);
  const timestamps = deduped.map(c => c.timestamp);

  // Transform candles for chart
  const chartData = deduped.map(c => ({
    time: (c.timestamp / 1000) as Time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }));

  // Update candlesticks
  candleSeries?.setData(chartData);

  // Calculate and update EMAs
  if (prices.length >= 9) {
    const ema9 = calculateEMA(prices, 9);
    const ema9Data = ema9.map((val, idx) => ({
      time: (timestamps[idx + 8] / 1000) as Time,
      value: val,
    }));
    ema9Series?.setData(ema9Data);
  }

  if (prices.length >= 21) {
    const ema21 = calculateEMA(prices, 21);
    const ema21Data = ema21.map((val, idx) => ({
      time: (timestamps[idx + 20] / 1000) as Time,
      value: val,
    }));
    ema21Series?.setData(ema21Data);
  }

  // Calculate and update Bollinger Bands
  if (prices.length >= 20) {
    const bb = calculateBB(prices, 20, 2);
    const bbOffset = 19;

    const bbUpperData = bb.upper.map((val, idx) => ({
      time: (timestamps[idx + bbOffset] / 1000) as Time,
      value: val,
    }));
    const bbMiddleData = bb.middle.map((val, idx) => ({
      time: (timestamps[idx + bbOffset] / 1000) as Time,
      value: val,
    }));
    const bbLowerData = bb.lower.map((val, idx) => ({
      time: (timestamps[idx + bbOffset] / 1000) as Time,
      value: val,
    }));

    bbUpperSeries?.setData(bbUpperData);
    bbMiddleSeries?.setData(bbMiddleData);
    bbLowerSeries?.setData(bbLowerData);
  }

  // Calculate and update RSI
  if (prices.length >= 15) {
    const rsi = calculateRSI(prices, 14);
    const rsiOffset = 14;

    const rsiData = rsi.map((val, idx) => ({
      time: (timestamps[idx + rsiOffset] / 1000) as Time,
      value: val,
    }));
    rsiSeries?.setData(rsiData);

    // Overbought/oversold reference lines
    const ob = timestamps.slice(rsiOffset).map(t => ({
      time: (t / 1000) as Time,
      value: 70,
    }));
    const os = timestamps.slice(rsiOffset).map(t => ({
      time: (t / 1000) as Time,
      value: 30,
    }));
    rsiOverbought?.setData(ob);
    rsiOversold?.setData(os);
  }

  // Calculate and update MACD
  if (prices.length >= 35) {
    const macd = calculateMACD(prices, 12, 26, 9);
    const macdOffset = 25;
    const signalOffset = macdOffset + 8;

    const macdLineData = macd.macd.map((val, idx) => ({
      time: (timestamps[idx + macdOffset] / 1000) as Time,
      value: val,
    }));
    macdLineSeries?.setData(macdLineData);

    const signalData = macd.signal.map((val, idx) => ({
      time: (timestamps[idx + signalOffset] / 1000) as Time,
      value: val,
    }));
    macdSignalSeries?.setData(signalData);

    const histData = macd.histogram.map((val, idx) => ({
      time: (timestamps[idx + signalOffset] / 1000) as Time,
      value: val,
      color: val >= 0 ? '#10B981' : '#EF4444',
    }));
    macdHistogramSeries?.setData(histData);
  }

  // Add signal markers
  updateSignalMarkers();

  // Fit content (with error handling)
  try {
    mainChart?.timeScale().fitContent();
    rsiChart?.timeScale().fitContent();
    macdChart?.timeScale().fitContent();
  } catch {
    // Ignore fit errors when chart is initializing
  }
}

// Update signal markers on chart
// Note: In lightweight-charts v5, markers are handled differently
// For now, we show signals in the signal panel below the chart
function updateSignalMarkers() {
  // Markers API changed in v5 - signal display is handled by the signal panel
}

// Watch for data changes
watch(() => props.candles, updateChartData, { deep: true });
watch(() => props.signal, updateSignalMarkers, { deep: true });

// Handle resize
let resizeObserver: ResizeObserver | null = null;

function handleResize() {
  if (mainChartContainer.value && mainChart) {
    mainChart.applyOptions({ width: mainChartContainer.value.clientWidth });
  }
  if (rsiChartContainer.value && rsiChart) {
    rsiChart.applyOptions({ width: rsiChartContainer.value.clientWidth });
  }
  if (macdChartContainer.value && macdChart) {
    macdChart.applyOptions({ width: macdChartContainer.value.clientWidth });
  }
}

onMounted(() => {
  initCharts();

  // Setup resize observer
  if (mainChartContainer.value) {
    resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(mainChartContainer.value);
  }
});

onUnmounted(() => {
  resizeObserver?.disconnect();
  mainChart?.remove();
  rsiChart?.remove();
  macdChart?.remove();
});
</script>

<style scoped>
.trading-chart-container {
  @apply bg-gray-900 rounded-xl border border-gray-800 overflow-hidden;
}

.main-chart {
  @apply w-full;
}

.rsi-chart {
  @apply w-full border-t border-gray-800;
}

.macd-chart {
  @apply w-full border-t border-gray-800;
}

.signal-panel {
  @apply p-3 border-t border-gray-800 bg-gray-900/50;
}

.signal-header {
  @apply flex items-center gap-4 text-sm font-medium;
}

.signal-direction {
  @apply font-bold;
}

.signal-score {
  @apply px-2 py-0.5 rounded bg-gray-800;
}

.signal-confidence {
  @apply text-gray-500;
}

.signal-reasons {
  @apply mt-2 space-y-1;
}

.reason {
  @apply text-xs text-gray-400 pl-2 border-l-2 border-gray-700;
}
</style>
