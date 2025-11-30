/**
 * Transaction Fee Calculator for Devnet Simulation
 *
 * When trading on devnet, we simulate realistic PumpFun trading fees
 * to make paper trading results accurate.
 *
 * Fee Structure (PumpFun):
 * - Trading Fee: 1% - 1.25% swap fee (we use 1.125% average)
 * - Network Fee: ~0.000005 SOL (negligible, ~$0.001)
 * - Token Creation: 0.02 SOL (one-time, not per trade)
 * - Graduation Fee: 1.5 SOL (only when token hits $90k mcap)
 */

export interface FeeCalculation {
  grossAmount: number;      // Amount before fees
  tradingFee: number;        // PumpFun platform fee (1.125%)
  networkFee: number;        // Solana network fee (~$0.001)
  totalFees: number;         // Sum of all fees
  netAmount: number;         // Amount after fees
  feePercentage: number;     // Total fee as percentage
}

// Fee constants
const PUMPFUN_TRADING_FEE_PERCENT = 1.125; // Average of 1%-1.25% range
const SOLANA_NETWORK_FEE_USD = 0.001;       // ~5000 lamports at $200 SOL

/**
 * Calculate fees for a buy transaction
 * @param investmentAmount - USD amount user is investing
 * @param isDevnet - Whether we're on devnet (fees only apply on devnet for simulation)
 */
export function calculateBuyFees(
  investmentAmount: number,
  isDevnet: boolean
): FeeCalculation {
  if (!isDevnet) {
    // On mainnet, assume actual blockchain execution (no simulation fees)
    return {
      grossAmount: investmentAmount,
      tradingFee: 0,
      networkFee: 0,
      totalFees: 0,
      netAmount: investmentAmount,
      feePercentage: 0,
    };
  }

  // Devnet simulation: apply realistic fees
  const tradingFee = investmentAmount * (PUMPFUN_TRADING_FEE_PERCENT / 100);
  const networkFee = SOLANA_NETWORK_FEE_USD;
  const totalFees = tradingFee + networkFee;
  const netAmount = investmentAmount - totalFees;

  return {
    grossAmount: investmentAmount,
    tradingFee,
    networkFee,
    totalFees,
    netAmount,
    feePercentage: (totalFees / investmentAmount) * 100,
  };
}

/**
 * Calculate fees for a sell transaction
 * @param saleProceeds - USD value of tokens being sold (before fees)
 * @param isDevnet - Whether we're on devnet (fees only apply on devnet for simulation)
 */
export function calculateSellFees(
  saleProceeds: number,
  isDevnet: boolean
): FeeCalculation {
  if (!isDevnet) {
    // On mainnet, assume actual blockchain execution (no simulation fees)
    return {
      grossAmount: saleProceeds,
      tradingFee: 0,
      networkFee: 0,
      totalFees: 0,
      netAmount: saleProceeds,
      feePercentage: 0,
    };
  }

  // Devnet simulation: apply realistic fees
  const tradingFee = saleProceeds * (PUMPFUN_TRADING_FEE_PERCENT / 100);
  const networkFee = SOLANA_NETWORK_FEE_USD;
  const totalFees = tradingFee + networkFee;
  const netAmount = saleProceeds - totalFees;

  return {
    grossAmount: saleProceeds,
    tradingFee,
    networkFee,
    totalFees,
    netAmount,
    feePercentage: (totalFees / saleProceeds) * 100,
  };
}

/**
 * Calculate total round-trip fee percentage (buy + sell)
 * This is the minimum profit needed to break even
 */
export function calculateRoundTripFeePercentage(isDevnet: boolean): number {
  if (!isDevnet) return 0;

  // Each trade has ~1.125% fee, so round trip is ~2.25%
  // Plus 2x network fees (negligible)
  return (PUMPFUN_TRADING_FEE_PERCENT * 2);
}

/**
 * Helper to format fee breakdown for logging
 */
export function formatFeeBreakdown(calc: FeeCalculation): string {
  return (
    `Gross: $${calc.grossAmount.toFixed(2)} | ` +
    `Fees: $${calc.totalFees.toFixed(4)} (${calc.feePercentage.toFixed(2)}%) | ` +
    `Net: $${calc.netAmount.toFixed(2)}`
  );
}
