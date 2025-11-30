// server/api/test/find-best-pool.get.ts

export default defineEventHandler(async () => {
  try {
    // Search for SOL/USDC pools
    const res = await fetch(
      'https://api-v3.raydium.io/pools/info/mint?mint1=So11111111111111111111111111111111111111112&mint2=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&poolType=all&poolSortField=volume24h&sortType=desc&pageSize=10&page=1'
    );
    const data = await res.json();

    const pools = data?.data?.data?.map((p: any) => ({
      id: p.id,
      type: p.type,
      volume24h: p.day?.volume || 0,
      volumePerMinute: ((p.day?.volume || 0) / 1440).toFixed(0),
      tvl: p.tvl,
      price: p.price,
    })) || [];

    return {
      success: true,
      pools: pools.slice(0, 5),
      recommendation: pools[0]?.id || 'No pools found'
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
});