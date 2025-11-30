// server/api/test/debug-pool.get.ts

export default defineEventHandler(async () => {
  const config = useRuntimeConfig();
  const apiKey = config.heliusApiKey;

  // CORRECT vault addresses from pool data!
  const SOL_VAULT = 'DQyrAcCrDXQ7NeoqGgDCZwBvWDcYmFCjSb9JtteuvPpz';
  const USDC_VAULT = 'HLmqeL62xR1QoZ1HKKbXRrdN1p3phKpxRMb2VVopvBBz';

  try {
    // Fetch SOL vault
    const solRes = await fetch(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTokenAccountBalance',
        params: [SOL_VAULT]
      })
    });
    const solData = await solRes.json();

    // Fetch USDC vault
    const usdcRes = await fetch(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'getTokenAccountBalance',
        params: [USDC_VAULT]
      })
    });
    const usdcData = await usdcRes.json();

    // Get Raydium API for comparison
    const raydiumRes = await fetch(
      'https://api-v3.raydium.io/pools/info/ids?ids=58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2'
    );
    const raydiumData = await raydiumRes.json();
    const poolInfo = raydiumData?.data?.[0];

    const solAmount = parseFloat(solData?.result?.value?.uiAmountString || '0');
    const usdcAmount = parseFloat(usdcData?.result?.value?.uiAmountString || '0');
    const price = usdcAmount / solAmount;

    return {
      success: true,
      vaults: {
        solVault: SOL_VAULT,
        usdcVault: USDC_VAULT,
      },
      raw: {
        solResponse: solData,
        usdcResponse: usdcData,
      },
      calculated: {
        solAmount,
        usdcAmount,
        price: price.toFixed(4),
      },
      raydiumApi: {
        solReserve: poolInfo?.mintAmountA,
        usdcReserve: poolInfo?.mintAmountB,
        price: poolInfo?.price?.toFixed(4),
      },
      match: Math.abs(price - poolInfo?.price) < 1 ? '✅ PRICES MATCH!' : '❌ MISMATCH'
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
});