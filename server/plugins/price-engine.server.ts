// server/plugins/price-engine.server.ts

/**
 * Price Engine Plugin
 * Starts real-time WebSocket price tracking on server boot
 */

import { createPriceEngine } from '../engine';

export default defineNitroPlugin((nitro) => {
  const config = useRuntimeConfig();
  
  const heliusKey = config.heliusApiKey || process.env.NUXT_HELIUS_API_KEY;

  if (!heliusKey) {
    console.error('[PriceEngine] ❌ No Helius API key! Set NUXT_HELIUS_API_KEY in .env');
    return;
  }

  console.log(`[PriceEngine] 🔑 Using Helius key: ${heliusKey.slice(0, 8)}...`);
  
  const engine = createPriceEngine(heliusKey);
  
  // Start after short delay
  setTimeout(() => {
    engine.start();
  }, 1000);

  // Cleanup on shutdown
  nitro.hooks.hook('close', () => {
    console.log('[PriceEngine] Shutting down...');
    engine.stop();
  });
});