// server/utils/costs.ts

/**
 * Transaction Cost Modeling for Realistic Paper Trading
 *
 * Models all the costs that eat into profits on real trades:
 * - DEX swap fees (Jupiter/Raydium)
 * - Slippage (market impact)
 * - Network priority fees
 * - Execution delay impact
 */

// ============================================================================
// COST CONFIGURATION
// ============================================================================

export interface CostConfig {
  // DEX Fees (as percentage, e.g., 0.25 = 0.25%)
  dexFeePercent: number;

  // Slippage settings
  baseSlippagePercent: number; // Minimum slippage
  volatilitySlippageMultiplier: number; // Extra slippage per 1% ATR
  sizeSlippageMultiplier: number; // Extra slippage per 1 SOL traded

  // Network fees (in USD)
  priorityFeeUsd: number;

  // Execution delay (simulates time between signal and fill)
  executionDelayMs: number;
  priceImpactPerSecond: number; // How much price moves against you per second delay
}

export const DEFAULT_COST_CONFIG: CostConfig = {
  // Jupiter/Raydium typical fees
  dexFeePercent: 0.25,

  // Slippage modeling
  baseSlippagePercent: 0.05, // 0.05% minimum slippage
  volatilitySlippageMultiplier: 0.02, // +0.02% slippage per 1% ATR
  sizeSlippageMultiplier: 0.01, // +0.01% slippage per 1 SOL (for small trades)

  // Solana priority fees (typical)
  priorityFeeUsd: 0.001, // ~0.001 USD per transaction

  // Execution modeling
  executionDelayMs: 500, // 500ms average to get transaction confirmed
  priceImpactPerSecond: 0.01, // 0.01% price movement per second against you
};

// ============================================================================
// COST CALCULATION
// ============================================================================

export interface TradeExecution {
  // Original signal price
  signalPrice: number;

  // Actual execution price (after slippage)
  executionPrice: number;

  // Cost breakdown
  costs: {
    dexFeeUsd: number;
    dexFeePercent: number;
    slippageUsd: number;
    slippagePercent: number;
    networkFeeUsd: number;
    totalCostUsd: number;
    totalCostPercent: number;
  };

  // For display
  priceImpactPercent: number;
}

/**
 * Calculate realistic execution price and costs for entry
 *
 * @param signalPrice - Price when signal was generated
 * @param direction - LONG or SHORT
 * @param sizeInSol - Position size in SOL
 * @param atrPercent - Current ATR as percentage (for volatility-based slippage)
 * @param config - Cost configuration
 */
export function calculateEntryExecution(
  signalPrice: number,
  direction: 'LONG' | 'SHORT',
  sizeInSol: number,
  atrPercent: number = 1,
  config: CostConfig = DEFAULT_COST_CONFIG
): TradeExecution {
  const tradeValueUsd = signalPrice * sizeInSol;

  // 1. Calculate slippage percentage
  const volatilitySlippage = atrPercent * config.volatilitySlippageMultiplier;
  const sizeSlippage = sizeInSol * config.sizeSlippageMultiplier;
  const totalSlippagePercent = config.baseSlippagePercent + volatilitySlippage + sizeSlippage;

  // 2. Calculate execution delay impact
  const delaySeconds = config.executionDelayMs / 1000;
  const delayImpactPercent = delaySeconds * config.priceImpactPerSecond;

  // 3. Total price impact (slippage + delay) - always against the trader
  const totalImpactPercent = totalSlippagePercent + delayImpactPercent;

  // 4. Calculate execution price (worse than signal)
  let executionPrice: number;
  if (direction === 'LONG') {
    // LONG: you pay MORE than signal price
    executionPrice = signalPrice * (1 + totalImpactPercent / 100);
  } else {
    // SHORT: you sell for LESS than signal price
    executionPrice = signalPrice * (1 - totalImpactPercent / 100);
  }

  // 5. Calculate DEX fee (on trade value)
  const dexFeeUsd = tradeValueUsd * (config.dexFeePercent / 100);

  // 6. Calculate slippage cost in USD
  const slippageUsd = Math.abs(executionPrice - signalPrice) * sizeInSol;

  // 7. Total costs
  const totalCostUsd = dexFeeUsd + slippageUsd + config.priorityFeeUsd;
  const totalCostPercent = (totalCostUsd / tradeValueUsd) * 100;

  return {
    signalPrice,
    executionPrice,
    costs: {
      dexFeeUsd,
      dexFeePercent: config.dexFeePercent,
      slippageUsd,
      slippagePercent: totalSlippagePercent,
      networkFeeUsd: config.priorityFeeUsd,
      totalCostUsd,
      totalCostPercent,
    },
    priceImpactPercent: totalImpactPercent,
  };
}

/**
 * Calculate realistic execution price and costs for exit
 *
 * @param signalPrice - Price when exit signal was generated
 * @param direction - LONG or SHORT (original position direction)
 * @param sizeInSol - Position size in SOL
 * @param atrPercent - Current ATR as percentage
 * @param config - Cost configuration
 */
export function calculateExitExecution(
  signalPrice: number,
  direction: 'LONG' | 'SHORT',
  sizeInSol: number,
  atrPercent: number = 1,
  config: CostConfig = DEFAULT_COST_CONFIG
): TradeExecution {
  const tradeValueUsd = signalPrice * sizeInSol;

  // 1. Calculate slippage percentage
  const volatilitySlippage = atrPercent * config.volatilitySlippageMultiplier;
  const sizeSlippage = sizeInSol * config.sizeSlippageMultiplier;
  const totalSlippagePercent = config.baseSlippagePercent + volatilitySlippage + sizeSlippage;

  // 2. Calculate execution delay impact
  const delaySeconds = config.executionDelayMs / 1000;
  const delayImpactPercent = delaySeconds * config.priceImpactPerSecond;

  // 3. Total price impact
  const totalImpactPercent = totalSlippagePercent + delayImpactPercent;

  // 4. Calculate execution price (worse than signal for exits too)
  let executionPrice: number;
  if (direction === 'LONG') {
    // Closing LONG = selling, you get LESS than signal price
    executionPrice = signalPrice * (1 - totalImpactPercent / 100);
  } else {
    // Closing SHORT = buying back, you pay MORE than signal price
    executionPrice = signalPrice * (1 + totalImpactPercent / 100);
  }

  // 5. Calculate costs
  const dexFeeUsd = tradeValueUsd * (config.dexFeePercent / 100);
  const slippageUsd = Math.abs(executionPrice - signalPrice) * sizeInSol;
  const totalCostUsd = dexFeeUsd + slippageUsd + config.priorityFeeUsd;
  const totalCostPercent = (totalCostUsd / tradeValueUsd) * 100;

  return {
    signalPrice,
    executionPrice,
    costs: {
      dexFeeUsd,
      dexFeePercent: config.dexFeePercent,
      slippageUsd,
      slippagePercent: totalSlippagePercent,
      networkFeeUsd: config.priorityFeeUsd,
      totalCostUsd,
      totalCostPercent,
    },
    priceImpactPercent: totalImpactPercent,
  };
}

/**
 * Calculate total round-trip costs (entry + exit)
 *
 * This is the minimum profit needed to break even!
 */
export function calculateRoundTripCosts(
  price: number,
  sizeInSol: number,
  atrPercent: number = 1,
  config: CostConfig = DEFAULT_COST_CONFIG
): {
  totalCostUsd: number;
  totalCostPercent: number;
  breakEvenMovePercent: number;
} {
  const entry = calculateEntryExecution(price, 'LONG', sizeInSol, atrPercent, config);
  const exit = calculateExitExecution(price, 'LONG', sizeInSol, atrPercent, config);

  const totalCostUsd = entry.costs.totalCostUsd + exit.costs.totalCostUsd;
  const tradeValueUsd = price * sizeInSol;
  const totalCostPercent = (totalCostUsd / tradeValueUsd) * 100;

  return {
    totalCostUsd,
    totalCostPercent,
    breakEvenMovePercent: totalCostPercent, // Price must move this much just to break even
  };
}

/**
 * Calculate net P&L after all costs
 */
export function calculateNetPnL(
  grossPnlUsd: number,
  entryCosts: TradeExecution['costs'],
  exitCosts: TradeExecution['costs']
): {
  grossPnlUsd: number;
  totalFeesUsd: number;
  netPnlUsd: number;
  feesAtePercent: number; // What % of gross profit went to fees
} {
  const totalFeesUsd = entryCosts.totalCostUsd + exitCosts.totalCostUsd;
  const netPnlUsd = grossPnlUsd - totalFeesUsd;

  // Calculate what percentage of gross profit went to fees
  let feesAtePercent = 0;
  if (grossPnlUsd > 0) {
    feesAtePercent = (totalFeesUsd / grossPnlUsd) * 100;
  }

  return {
    grossPnlUsd,
    totalFeesUsd,
    netPnlUsd,
    feesAtePercent,
  };
}

/**
 * Get cost summary for display
 */
export function getCostSummary(config: CostConfig = DEFAULT_COST_CONFIG): string {
  const roundTrip = calculateRoundTripCosts(100, 0.1, 1, config);

  return (
    `Cost Model: DEX ${config.dexFeePercent}% + ~${config.baseSlippagePercent}% slippage\n` +
    `Round-trip cost: ~${roundTrip.totalCostPercent.toFixed(3)}%\n` +
    `Break-even move: ${roundTrip.breakEvenMovePercent.toFixed(3)}%`
  );
}
