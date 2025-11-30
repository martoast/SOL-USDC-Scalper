// server/plugins/helius-stream.server.ts

import { initializeStream, startStream, stopStream } from '../utils/helius-stream';

export default defineNitroPlugin((nitroApp) => {
  const config = useRuntimeConfig();
  const heliusKey = config.heliusApiKey as string;
  const jupiterKey = config.jupiterApiKey as string;

  if (!heliusKey && !jupiterKey) {
    console.log('[HeliusPlugin] No API keys found, stream disabled');
    return;
  }

  console.log('[HeliusPlugin] ✅ Helius:', heliusKey ? heliusKey.slice(0, 8) + '...' : 'NONE');
  console.log('[HeliusPlugin] ✅ Jupiter:', jupiterKey ? jupiterKey.slice(0, 8) + '...' : 'NONE');

  initializeStream(heliusKey, jupiterKey);

  setTimeout(() => {
    console.log('[HeliusPlugin] 🚀 Starting stream...');
    startStream();
  }, 2000);

  nitroApp.hooks.hook('close', () => {
    console.log('[HeliusPlugin] Shutting down...');
    stopStream();
  });
});