// server/api/test/birdeye.get.ts

/**
 * Test Birdeye API endpoints for historical data
 *
 * GET /api/test/birdeye
 *
 * Tests multiple Birdeye endpoints to find the best one for historical candles
 */

import { defineEventHandler } from 'h3';

// SOL token address
const SOL_ADDRESS = 'So11111111111111111111111111111111111111112';

interface TestResult {
  endpoint: string;
  success: boolean;
  statusCode?: number;
  error?: string;
  dataPoints?: number;
  sample?: any;
  fetchTimeMs: number;
}

export default defineEventHandler(async () => {
  const config = useRuntimeConfig();
  const apiKey = config.birdeyeApiKey || process.env.NUXT_BIRDEYE_API_KEY;

  if (!apiKey) {
    return {
      success: false,
      error: 'No Birdeye API key found. Set NUXT_BIRDEYE_API_KEY in .env',
    };
  }

  console.log(`[Birdeye Test] Using API key: ${apiKey.slice(0, 8)}...`);

  const results: TestResult[] = [];
  const now = Math.floor(Date.now() / 1000);
  const oneDayAgo = now - 24 * 60 * 60;

  const headers = {
    'Accept': 'application/json',
    'X-API-KEY': apiKey,
  };

  // ============================================================================
  // Test 1: /defi/history_price (Historical price with interval)
  // ============================================================================
  {
    const endpoint = '/defi/history_price';
    const url = `https://public-api.birdeye.so${endpoint}?address=${SOL_ADDRESS}&address_type=token&type=1H&time_from=${oneDayAgo}&time_to=${now}`;

    console.log(`[Birdeye Test] Testing ${endpoint}...`);
    const start = Date.now();

    try {
      const response = await fetch(url, { headers });
      const fetchTime = Date.now() - start;

      if (!response.ok) {
        results.push({
          endpoint,
          success: false,
          statusCode: response.status,
          error: `${response.status} ${response.statusText}`,
          fetchTimeMs: fetchTime,
        });
      } else {
        const data = await response.json();
        const items = data.data?.items || [];

        results.push({
          endpoint,
          success: items.length > 0,
          statusCode: response.status,
          dataPoints: items.length,
          sample: items.length > 0 ? {
            first: items[0],
            last: items[items.length - 1],
          } : null,
          fetchTimeMs: fetchTime,
        });
      }
    } catch (error: any) {
      results.push({
        endpoint,
        success: false,
        error: error.message,
        fetchTimeMs: Date.now() - start,
      });
    }
  }

  // ============================================================================
  // Test 2: /defi/historical_price_unix (Price at specific timestamps)
  // ============================================================================
  {
    const endpoint = '/defi/historical_price_unix';
    // Test with a timestamp from 1 hour ago
    const oneHourAgo = now - 60 * 60;
    const url = `https://public-api.birdeye.so${endpoint}?address=${SOL_ADDRESS}&unixtime=${oneHourAgo}`;

    console.log(`[Birdeye Test] Testing ${endpoint}...`);
    const start = Date.now();

    try {
      const response = await fetch(url, { headers });
      const fetchTime = Date.now() - start;

      if (!response.ok) {
        results.push({
          endpoint,
          success: false,
          statusCode: response.status,
          error: `${response.status} ${response.statusText}`,
          fetchTimeMs: fetchTime,
        });
      } else {
        const data = await response.json();

        results.push({
          endpoint,
          success: data.success && data.data?.value !== undefined,
          statusCode: response.status,
          dataPoints: 1,
          sample: data.data,
          fetchTimeMs: fetchTime,
        });
      }
    } catch (error: any) {
      results.push({
        endpoint,
        success: false,
        error: error.message,
        fetchTimeMs: Date.now() - start,
      });
    }
  }

  // ============================================================================
  // Test 3: /defi/ohlcv (OHLCV candles - what we really want!)
  // ============================================================================
  {
    const endpoint = '/defi/ohlcv';
    const url = `https://public-api.birdeye.so${endpoint}?address=${SOL_ADDRESS}&type=1m&time_from=${oneDayAgo}&time_to=${now}`;

    console.log(`[Birdeye Test] Testing ${endpoint}...`);
    const start = Date.now();

    try {
      const response = await fetch(url, { headers });
      const fetchTime = Date.now() - start;

      if (!response.ok) {
        results.push({
          endpoint,
          success: false,
          statusCode: response.status,
          error: `${response.status} ${response.statusText}`,
          fetchTimeMs: fetchTime,
        });
      } else {
        const data = await response.json();
        const items = data.data?.items || [];

        results.push({
          endpoint,
          success: items.length > 0,
          statusCode: response.status,
          dataPoints: items.length,
          sample: items.length > 0 ? {
            latest: {
              open: items[0].o,
              high: items[0].h,
              low: items[0].l,
              close: items[0].c,
              volume: items[0].v,
              time: new Date(items[0].unixTime * 1000).toISOString(),
            },
            oldest: {
              open: items[items.length - 1].o,
              close: items[items.length - 1].c,
              time: new Date(items[items.length - 1].unixTime * 1000).toISOString(),
            },
          } : null,
          fetchTimeMs: fetchTime,
        });
      }
    } catch (error: any) {
      results.push({
        endpoint,
        success: false,
        error: error.message,
        fetchTimeMs: Date.now() - start,
      });
    }
  }

  // ============================================================================
  // Test 4: /defi/ohlcv with 5m timeframe
  // ============================================================================
  {
    const endpoint = '/defi/ohlcv (5m)';
    const url = `https://public-api.birdeye.so/defi/ohlcv?address=${SOL_ADDRESS}&type=5m&time_from=${oneDayAgo}&time_to=${now}`;

    console.log(`[Birdeye Test] Testing ${endpoint}...`);
    const start = Date.now();

    try {
      const response = await fetch(url, { headers });
      const fetchTime = Date.now() - start;

      if (!response.ok) {
        results.push({
          endpoint,
          success: false,
          statusCode: response.status,
          error: `${response.status} ${response.statusText}`,
          fetchTimeMs: fetchTime,
        });
      } else {
        const data = await response.json();
        const items = data.data?.items || [];

        results.push({
          endpoint,
          success: items.length > 0,
          statusCode: response.status,
          dataPoints: items.length,
          sample: items.length > 0 ? {
            latest: {
              open: items[0].o?.toFixed(2),
              high: items[0].h?.toFixed(2),
              low: items[0].l?.toFixed(2),
              close: items[0].c?.toFixed(2),
              time: new Date(items[0].unixTime * 1000).toISOString(),
            },
          } : null,
          fetchTimeMs: fetchTime,
        });
      }
    } catch (error: any) {
      results.push({
        endpoint,
        success: false,
        error: error.message,
        fetchTimeMs: Date.now() - start,
      });
    }
  }

  // ============================================================================
  // Test 5: /defi/price (Current price - baseline test)
  // ============================================================================
  {
    const endpoint = '/defi/price';
    const url = `https://public-api.birdeye.so${endpoint}?address=${SOL_ADDRESS}`;

    console.log(`[Birdeye Test] Testing ${endpoint}...`);
    const start = Date.now();

    try {
      const response = await fetch(url, { headers });
      const fetchTime = Date.now() - start;

      if (!response.ok) {
        results.push({
          endpoint,
          success: false,
          statusCode: response.status,
          error: `${response.status} ${response.statusText}`,
          fetchTimeMs: fetchTime,
        });
      } else {
        const data = await response.json();

        results.push({
          endpoint,
          success: data.success && data.data?.value !== undefined,
          statusCode: response.status,
          dataPoints: 1,
          sample: {
            price: `$${data.data?.value?.toFixed(2)}`,
            updateTime: data.data?.updateUnixTime
              ? new Date(data.data.updateUnixTime * 1000).toISOString()
              : null,
          },
          fetchTimeMs: fetchTime,
        });
      }
    } catch (error: any) {
      results.push({
        endpoint,
        success: false,
        error: error.message,
        fetchTimeMs: Date.now() - start,
      });
    }
  }

  // Summary
  const workingEndpoints = results.filter(r => r.success);
  const bestForOHLCV = results.find(r => r.success && r.endpoint.includes('ohlcv'));

  console.log(`[Birdeye Test] ✅ Complete. ${workingEndpoints.length}/${results.length} endpoints working`);

  return {
    success: workingEndpoints.length > 0,
    timestamp: new Date().toISOString(),
    apiKeyUsed: `${apiKey.slice(0, 8)}...`,
    results,
    summary: {
      workingEndpoints: workingEndpoints.map(r => r.endpoint),
      failedEndpoints: results.filter(r => !r.success).map(r => `${r.endpoint}: ${r.error}`),
      recommendedEndpoint: bestForOHLCV?.endpoint || workingEndpoints[0]?.endpoint || null,
      totalDataPoints: workingEndpoints.reduce((sum, r) => sum + (r.dataPoints || 0), 0),
    },
  };
});
