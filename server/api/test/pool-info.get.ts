// server/api/test/pool-info.get.ts

/**
 * Fetch the actual vault addresses from the Raydium pool
 */

export default defineEventHandler(async () => {
  const config = useRuntimeConfig();
  const apiKey = config.heliusApiKey;

  const SOL_USDC_POOL = '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2';

  try {
    // Get pool account info
    const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getAccountInfo',
        params: [SOL_USDC_POOL, { encoding: 'jsonParsed' }]
      })
    });

    const poolData = await res.json();

    // Also try to get the pool via Raydium API
    const raydiumRes = await fetch(
      `https://api-v3.raydium.io/pools/info/ids?ids=${SOL_USDC_POOL}`
    );
    const raydiumData = await raydiumRes.json();

    return {
      success: true,
      poolAddress: SOL_USDC_POOL,
      onChainData: poolData,
      raydiumApi: raydiumData
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
});