// server/api/test/check-api-updates.get.ts

export default defineEventHandler(async () => {
  const SOL_USDC_POOL = '3ucNos4NbumPLZNWztqGHNFFgkHeRMBQAVemeeomsUxv';
  
  const results = [];
  
  // Fetch 5 times with 500ms gap
  for (let i = 0; i < 5; i++) {
    const start = Date.now();
    const res = await fetch(
      `https://api-v3.raydium.io/pools/info/ids?ids=${SOL_USDC_POOL}`
    );
    const data = await res.json();
    const price = data?.data?.[0]?.price;
    
    results.push({
      attempt: i + 1,
      price: price?.toFixed(6),
      latency: Date.now() - start,
      time: new Date().toISOString()
    });
    
    if (i < 4) await new Promise(r => setTimeout(r, 500));
  }
  
  return {
    results,
    allSame: results.every(r => r.price === results[0].price),
    note: 'If all prices are the same, the API is caching'
  };
});