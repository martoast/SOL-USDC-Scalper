// server/api/test/historical.get.ts

/**
 * Test endpoint for historical candle fetching
 *
 * GET /api/test/historical
 *
 * Tests Birdeye/CoinGecko/DexScreener API integration
 */

import { defineEventHandler } from 'h3';
import { fetchFromBirdeye, fetchHistoricalCandles, fetchFromDexScreener, fetchAllHistoricalCandles } from '../../utils/historical-candles';

export default defineEventHandler(async () => {
  const config = useRuntimeConfig();
  const birdeyeKey = config.birdeyeApiKey || process.env.NUXT_BIRDEYE_API_KEY;

  const results: Record<string, any> = {
    success: false,
    timestamp: new Date().toISOString(),
    tests: {},
  };

  try {
    // Test 0: Birdeye (if API key available)
    if (birdeyeKey) {
      console.log('[Test] Testing Birdeye API (1m candles)...');
      const startBE = Date.now();
      const candlesBE = await fetchFromBirdeye('1m', birdeyeKey);
      const timeBE = Date.now() - startBE;

      results.tests['birdeye'] = {
        success: candlesBE.length > 0,
        count: candlesBE.length,
        fetchTimeMs: timeBE,
        hasVolume: candlesBE.length > 0 ? candlesBE[0].volume > 0 : false,
        sample: candlesBE.length > 0 ? {
          latest: {
            open: candlesBE[0].open.toFixed(2),
            high: candlesBE[0].high.toFixed(2),
            low: candlesBE[0].low.toFixed(2),
            close: candlesBE[0].close.toFixed(2),
            volume: candlesBE[0].volume.toFixed(2),
            timestamp: new Date(candlesBE[0].timestamp).toISOString(),
          },
          oldest: {
            close: candlesBE[candlesBE.length - 1].close.toFixed(2),
            timestamp: new Date(candlesBE[candlesBE.length - 1].timestamp).toISOString(),
          },
        } : null,
      };
    } else {
      results.tests['birdeye'] = {
        success: false,
        error: 'No API key - set NUXT_BIRDEYE_API_KEY',
      };
    }

    // Test 1: Fetch candles from CoinGecko
    console.log('[Test] Testing CoinGecko candle fetch...');
    const startCG = Date.now();
    const candlesCG = await fetchHistoricalCandles('30m', 48);
    const timeCG = Date.now() - startCG;

    results.tests['coinGecko'] = {
      success: candlesCG.length > 0,
      count: candlesCG.length,
      fetchTimeMs: timeCG,
      sample: candlesCG.length > 0 ? {
        latest: {
          open: candlesCG[0].open.toFixed(2),
          high: candlesCG[0].high.toFixed(2),
          low: candlesCG[0].low.toFixed(2),
          close: candlesCG[0].close.toFixed(2),
          timestamp: new Date(candlesCG[0].timestamp).toISOString(),
        },
        oldest: {
          open: candlesCG[candlesCG.length - 1].open.toFixed(2),
          close: candlesCG[candlesCG.length - 1].close.toFixed(2),
          timestamp: new Date(candlesCG[candlesCG.length - 1].timestamp).toISOString(),
        },
      } : null,
    };

    // Test 2: Fetch from DexScreener (backup)
    console.log('[Test] Testing DexScreener fetch...');
    const startDS = Date.now();
    const candlesDS = await fetchFromDexScreener();
    const timeDS = Date.now() - startDS;

    results.tests['dexScreener'] = {
      success: candlesDS.length > 0,
      count: candlesDS.length,
      fetchTimeMs: timeDS,
      sample: candlesDS.length > 0 ? {
        currentPrice: candlesDS[0].close.toFixed(2),
        timestamp: new Date(candlesDS[0].timestamp).toISOString(),
      } : null,
    };

    // Test 3: Full fetch (what happens on startup)
    console.log('[Test] Testing full historical fetch (startup simulation)...');
    const startFull = Date.now();
    const allCandles = await fetchAllHistoricalCandles();
    const timeFull = Date.now() - startFull;

    const fullSummary: Record<string, number> = {};
    let samplePrices: Record<string, string> = {};
    for (const [tf, candles] of allCandles) {
      fullSummary[tf] = candles.length;
      if (candles.length > 0) {
        samplePrices[tf] = `$${candles[0].close.toFixed(2)}`;
      }
    }

    results.tests['fullFetch'] = {
      success: allCandles.size > 0,
      timeframeCount: allCandles.size,
      totalFetchTimeMs: timeFull,
      candleCounts: fullSummary,
      latestPrices: samplePrices,
    };

    // Overall success - we just need at least one source to work
    const birdeyeSuccess = results.tests['birdeye']?.success || false;
    results.success = birdeyeSuccess || candlesCG.length > 0 || candlesDS.length > 0;

    // Summary
    const totalCandles = Object.values(fullSummary).reduce((a, b) => a + b, 0);
    const primarySource = birdeyeSuccess ? 'Birdeye (1m OHLCV with volume!)' :
                          candlesCG.length > 0 ? 'CoinGecko (30m OHLC)' : 'DexScreener (synthetic)';

    results.summary = {
      totalCandles,
      primarySource,
      birdeyeAvailable: birdeyeSuccess,
      birdeyeCandleCount: results.tests['birdeye']?.count || 0,
      currentPrice: birdeyeSuccess ? `$${results.tests['birdeye'].sample?.latest?.close}` :
                    candlesCG.length > 0 ? `$${candlesCG[0].close.toFixed(2)}` :
                    candlesDS.length > 0 ? `$${candlesDS[0].close.toFixed(2)}` : null,
      historicalRange: birdeyeSuccess ? `${results.tests['birdeye'].count} minutes of 1m data` :
                       candlesCG.length > 0 ? '24 hours of 30m candles' : '24 hours synthetic',
      readyForTrading: results.success,
    };

    console.log('[Test] ✅ Historical candle test complete');

  } catch (error: any) {
    results.success = false;
    results.error = error.message || 'Unknown error';
    console.error('[Test] ❌ Historical candle test failed:', error);
  }

  return results;
});
