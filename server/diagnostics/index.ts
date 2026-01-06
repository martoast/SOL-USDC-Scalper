// server/diagnostics/index.ts

/**
 * Trade Diagnostics Module
 *
 * Phase 5: Performance Truth
 *
 * This module provides instrumentation for measuring:
 * - Signal quality (MFE/MAE)
 * - Execution quality (slippage, fees)
 * - Regime dependency
 * - True expectancy
 *
 * IMPORTANT: This is READ-ONLY measurement.
 * No trading decisions are made based on this data.
 */

// Types
export * from './types';

// Trade tracker
export {
  startTrackingTrade,
  updateTracker,
  stopTrackingTrade,
  getActiveTracker,
  getAllActiveTrackers,
  getCompletedDiagnostics,
  getAllCompletedDiagnostics,
  clearAllDiagnostics,
  importDiagnostics,
} from './trade-tracker';

// Expectancy calculations
export {
  calculateExpectancy,
  filterByRegime,
  filterByHour,
  filterMfeFirst,
  filterRegimeShifted,
  formatExpectancyReport,
} from './expectancy';
