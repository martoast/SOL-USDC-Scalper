// server/engine/raydium-clmm-parser.ts

/**
 * Raydium Concentrated Liquidity Market Maker (CLMM) Pool Parser
 * 
 * Parses raw pool account data to extract current price
 * 
 * Pool: SOL/USDC
 * Address: 2QdhepnKRTLjjSqPL1PtKNwqrUkoLee5Gqs8bvZhRdMv
 */

// SOL/USDC pool on Raydium CLMM
export const SOL_USDC_POOL = '2QdhepnKRTLjjSqPL1PtKNwqrUkoLee5Gqs8bvZhRdMv';

// Token decimals
const SOL_DECIMALS = 9;
const USDC_DECIMALS = 6;

// CLMM pool account layout offsets
// Based on Raydium CLMM program structure
const LAYOUT = {
  DISCRIMINATOR: 0,           // 8 bytes
  BUMP: 8,                    // 1 byte  
  AMM_CONFIG: 9,              // 32 bytes
  OWNER: 41,                  // 32 bytes
  TOKEN_MINT_0: 73,           // 32 bytes (SOL)
  TOKEN_MINT_1: 105,          // 32 bytes (USDC)
  TOKEN_VAULT_0: 137,         // 32 bytes
  TOKEN_VAULT_1: 169,         // 32 bytes
  OBSERVATION_KEY: 201,       // 32 bytes
  MINT_DECIMALS_0: 233,       // 1 byte
  MINT_DECIMALS_1: 234,       // 1 byte
  TICK_SPACING: 235,          // 2 bytes
  LIQUIDITY: 237,             // 16 bytes (u128)
  SQRT_PRICE_X64: 253,        // 16 bytes (u128) ← THIS IS WHAT WE NEED
  TICK_CURRENT: 269,          // 4 bytes (i32)
  // ... more fields after
};

export interface PoolState {
  sqrtPriceX64: bigint;
  liquidity: bigint;
  tickCurrent: number;
  price: number;
  invertedPrice: number;
}

/**
 * Parse raw account data from Raydium CLMM pool
 */
export function parseClmmPool(data: Buffer): PoolState | null {
  try {
    if (data.length < 300) {
      console.error('[CLMM Parser] Data too short:', data.length);
      return null;
    }

    // Read sqrtPriceX64 (u128 = 16 bytes, little-endian)
    const sqrtPriceBytes = data.slice(LAYOUT.SQRT_PRICE_X64, LAYOUT.SQRT_PRICE_X64 + 16);
    const sqrtPriceX64 = bytesToBigInt(sqrtPriceBytes);

    // Read liquidity (u128)
    const liquidityBytes = data.slice(LAYOUT.LIQUIDITY, LAYOUT.LIQUIDITY + 16);
    const liquidity = bytesToBigInt(liquidityBytes);

    // Read tick current (i32)
    const tickCurrent = data.readInt32LE(LAYOUT.TICK_CURRENT);

    // Calculate price from sqrtPriceX64
    const { price, invertedPrice } = calculatePrice(sqrtPriceX64);

    return {
      sqrtPriceX64,
      liquidity,
      tickCurrent,
      price,           // USDC per SOL (what we want)
      invertedPrice,   // SOL per USDC
    };
  } catch (e) {
    console.error('[CLMM Parser] Parse error:', e);
    return null;
  }
}

/**
 * Convert 16 bytes (little-endian) to BigInt
 */
function bytesToBigInt(bytes: Buffer): bigint {
  let result = BigInt(0);
  for (let i = bytes.length - 1; i >= 0; i--) {
    result = (result << BigInt(8)) + BigInt(bytes[i]);
  }
  return result;
}

/**
 * Calculate price from sqrtPriceX64
 * 
 * sqrtPriceX64 = sqrt(price) * 2^64
 * 
 * To get price:
 * 1. sqrtPrice = sqrtPriceX64 / 2^64
 * 2. price = sqrtPrice^2
 * 3. Adjust for decimals
 */
function calculatePrice(sqrtPriceX64: bigint): { price: number; invertedPrice: number } {
  // Convert to number for calculation
  // We lose some precision but it's fine for our use case
  const Q64 = BigInt(2) ** BigInt(64);
  
  // sqrtPrice as a decimal
  const sqrtPriceNum = Number(sqrtPriceX64) / Number(Q64);
  
  // Square to get raw price
  const rawPrice = sqrtPriceNum * sqrtPriceNum;
  
  // Adjust for decimal difference
  // Token0 = SOL (9 decimals), Token1 = USDC (6 decimals)
  // Price is in terms of token1/token0
  const decimalAdjustment = Math.pow(10, SOL_DECIMALS - USDC_DECIMALS);
  
  const price = rawPrice * decimalAdjustment;
  const invertedPrice = 1 / price;

  return { price, invertedPrice };
}

/**
 * Validate price is reasonable
 */
export function validatePrice(price: number): boolean {
  // SOL should be between $1 and $10000
  return price > 1 && price < 10000;
}