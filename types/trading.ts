// In types/trading.ts, make sure TokenData has these fields:

export interface TokenData {
  address: string;
  symbol: string;
  name: string;
  price: number;
  priceNative?: number;
  logoURI?: string;
  
  // Price changes
  priceChange1m?: number;
  priceChange5m?: number;
  priceChange1h?: number;
  priceChange24h?: number;
  
  // Volume
  volume1m?: number;
  volume5m?: number;
  volume1h?: number;
  volume24h?: number;
  
  // Transactions
  txns1m?: { buys: number; sells: number };
  txns5m?: { buys: number; sells: number };
  txns1h?: { buys: number; sells: number };
  
  // Buy pressure
  buyPressure1m?: number;
  buyPressure5m?: number;
  buyPressure1h?: number;
  
  // Liquidity
  liquidity?: number;
  fdv?: number;
  marketCap?: number;
  
  // Age
  ageMs?: number;
  ageMinutes?: number;
  isNewborn?: boolean;
  
  // Metadata
  pairAddress?: string;
  pairCreatedAt?: number;
  source?: string;
  dataQuality?: string;
  discoveredAt?: number;
  lastUpdate?: number;
}