/**
 * PROBABILITY-BASED TRADING ENGINE — Public API
 * ================================================
 * 
 * Single entry point. Import from here only.
 * 
 * Usage:
 *   import { runProbabilityEngine, createDisciplineState } from '@/lib/probabilityEngine';
 *   const result = runProbabilityEngine({ symbol, timeframe, candles });
 */

export {
  runProbabilityEngine,
  createDisciplineState,
  recordTradeResult,
  resetSession,
} from './engine';

export {
  computeIndicators,
  calculateEMA,
  calculateATR,
  calculateRSI,
  calculateADX,
  detectSwingPoints,
  detectKeyLevels,
} from './indicators';

export type {
  // Core
  CandleData,
  EngineInput,
  EngineOutput,
  SignalDecision,
  PhaseResult,

  // Regime
  MarketRegime,
  RegimeAnalysis,

  // Structure
  SwingPoint,
  SwingType,
  TrendDirection,
  StructureAnalysis,

  // MTF
  TimeframeLayer,
  TimeframeConfig,
  TimeframeAnalysis,
  MTFAlignment,

  // Setup
  SetupType,
  SetupDetection,

  // Indicators
  IndicatorValues,
  IndicatorValidation,

  // Risk
  RiskParameters,
  RiskCalculation,

  // Confidence
  ConfidenceBreakdown,

  // Discipline
  DisciplineState,
  DisciplineCheck,

  // Key Levels
  KeyLevel,
  LevelType,
} from './types';
