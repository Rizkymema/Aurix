/**
 * PROBABILITY-BASED TRADING ENGINE — Type Definitions
 * ====================================================
 * 
 * Sistem trading profesional berbasis probabilitas dan 
 * manajemen risiko ketat. Fokus: struktur market, prediksi arah,
 * entry probabilitas tinggi, risk management presisi.
 * 
 * Prinsip: Jika data tidak ideal → WAIT.
 */

// ─────────────────────────────────────────────
// CORE CANDLE & TIMEFRAME TYPES
// ─────────────────────────────────────────────

export interface CandleData {
  time: number;     // Unix timestamp in SECONDS
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export type TimeframeLayer = 'HTF' | 'MTF' | 'LTF';

export interface TimeframeConfig {
  htf: string;   // e.g. '4h' or '1d'
  mtf: string;   // e.g. '1h'
  ltf: string;   // e.g. '15m' or '5m'
}

/** Default MTF mappings per LTF */
export const DEFAULT_MTF_MAP: Record<string, TimeframeConfig> = {
  '1m':  { htf: '1h',  mtf: '15m', ltf: '1m' },
  '5m':  { htf: '4h',  mtf: '1h',  ltf: '5m' },
  '15m': { htf: '4h',  mtf: '1h',  ltf: '15m' },
  '30m': { htf: '1d',  mtf: '4h',  ltf: '30m' },
  '1h':  { htf: '1d',  mtf: '4h',  ltf: '1h' },
  '4h':  { htf: '1d',  mtf: '4h',  ltf: '4h' },  // HTF uses daily
  '1d':  { htf: '1d',  mtf: '1d',  ltf: '1d' },
};

// ─────────────────────────────────────────────
// MARKET REGIME
// ─────────────────────────────────────────────

export type MarketRegime =
  | 'TRENDING_BULLISH'
  | 'TRENDING_BEARISH'
  | 'RANGING'
  | 'HIGH_VOLATILITY_EXPANSION'
  | 'LOW_VOLATILITY_COMPRESSION'
  | 'UNCLEAR';

export interface RegimeAnalysis {
  regime: MarketRegime;
  confidence: number;        // 0-100
  adx: number;
  atr: number;
  atrPercent: number;
  atrExpanding: boolean;
  structure: 'HH_HL' | 'LH_LL' | 'MIXED' | 'FLAT';
  description: string;
}

// ─────────────────────────────────────────────
// STRUCTURE & SWING 
// ─────────────────────────────────────────────

export type SwingType = 'HH' | 'HL' | 'LH' | 'LL';

export interface SwingPoint {
  type: SwingType;
  price: number;
  time: number;
  index: number;
}

export type TrendDirection = 'BULLISH' | 'BEARISH' | 'SIDEWAYS';

export interface StructureAnalysis {
  trend: TrendDirection;
  swingPoints: SwingPoint[];
  lastSwingHigh: number;
  lastSwingLow: number;
  structureIntact: boolean;  // No BOS against trend
  description: string;
}

// ─────────────────────────────────────────────
// MULTI-TIMEFRAME ALIGNMENT
// ─────────────────────────────────────────────

export interface TimeframeAnalysis {
  layer: TimeframeLayer;
  timeframe: string;
  trend: TrendDirection;
  regime: MarketRegime;
  ema50: number;
  ema200: number;
  adx: number;
  rsi: number;
  atr: number;
  structure: StructureAnalysis;
}

export interface MTFAlignment {
  aligned: boolean;
  htf: TimeframeAnalysis;
  mtf: TimeframeAnalysis;
  ltf: TimeframeAnalysis;
  direction: TrendDirection;  // Consensus direction or SIDEWAYS
  reason: string;
}

// ─────────────────────────────────────────────
// KEY LEVELS
// ─────────────────────────────────────────────

export type LevelType = 'SUPPORT' | 'RESISTANCE' | 'SUPPLY_ZONE' | 'DEMAND_ZONE';

export interface KeyLevel {
  type: LevelType;
  price: number;
  priceHigh?: number;  // For zones (upper boundary)
  strength: number;    // 0-100
  touchCount: number;
  description: string;
}

// ─────────────────────────────────────────────
// SETUP & ENTRY LOGIC
// ─────────────────────────────────────────────

export type SetupType =
  | 'PULLBACK_EMA50'
  | 'BREAKOUT_RETEST'
  | 'SR_REJECTION'
  | 'RANGE_BOUNDARY_REJECTION'
  | 'FAKE_BREAKOUT_RECLAIM'
  | 'NONE';

export interface SetupDetection {
  valid: boolean;
  type: SetupType;
  regime: 'TRENDING' | 'RANGING';
  entryPrice: number;
  reason: string;
}

// ─────────────────────────────────────────────
// INDICATOR VALIDATION
// ─────────────────────────────────────────────

export interface IndicatorValues {
  ema50: number;
  ema200: number;
  rsi: number;
  adx: number;
  atr: number;
  atrSma: number;  // ATR SMA for expansion check
}

export interface IndicatorValidation {
  valid: boolean;
  emaAligned: boolean;
  rsiValid: boolean;
  adxValid: boolean;
  rsiValue: number;
  adxValue: number;
  reasons: string[];
}

// ─────────────────────────────────────────────
// RISK MANAGEMENT
// ─────────────────────────────────────────────

export interface RiskParameters {
  accountBalance: number;
  riskPercent: number;        // 1-2%
  maxTradesPerSession: number;
  currentSessionTrades: number;
  consecutiveLosses: number;
}

export interface RiskCalculation {
  valid: boolean;
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  riskRewardRatio: number;
  positionSize: number;
  riskAmount: number;
  potentialReward: number;
  reason: string;
}

// ─────────────────────────────────────────────
// CONFIDENCE SCORING
// ─────────────────────────────────────────────

export interface ConfidenceBreakdown {
  regimeClarity: number;       // 0-15
  htfAlignment: number;        // 0-20
  mtfSetupQuality: number;     // 0-15
  ltfConfirmation: number;     // 0-10
  indicatorConfluence: number; // 0-15
  keyLevelValidation: number;  // 0-15
  riskRewardViability: number; // 0-10
  total: number;               // 0-100
}

// ─────────────────────────────────────────────
// DISCIPLINE & SESSION
// ─────────────────────────────────────────────

export interface DisciplineState {
  tradesThisSession: number;
  consecutiveLosses: number;
  isPaused: boolean;
  pauseReason: string;
  lastTradeTime: number;
  sessionStart: number;
}

export interface DisciplineCheck {
  canTrade: boolean;
  reason: string;
  tradesRemaining: number;
}

// ─────────────────────────────────────────────
// FINAL ENGINE OUTPUT
// ─────────────────────────────────────────────

export type SignalDecision = 'BUY' | 'SELL' | 'WAIT';

export interface PhaseResult {
  phase: number;
  name: string;
  passed: boolean;
  reason: string;
}

export interface EngineOutput {
  // === REQUIRED OUTPUT ===
  marketRegime: MarketRegime;
  htfTrendDirection: TrendDirection;
  setupType: SetupType;
  signal: SignalDecision;
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  riskRewardRatio: number;
  positionSize: number;
  confidenceScore: number;      // 0-100
  technicalJustification: string;
  estimatedExpectedValue: number; // EV = (winRate × avgWin) - (lossRate × avgLoss)

  // === DETAIL ===
  symbol: string;
  timeframe: string;
  timestamp: number;
  phases: PhaseResult[];
  confidenceBreakdown: ConfidenceBreakdown;
  indicators: IndicatorValues;
  mtfAlignment: MTFAlignment | null;
  regime: RegimeAnalysis;
  structure: StructureAnalysis;
  keyLevels: KeyLevel[];
  risk: RiskCalculation | null;
  discipline: DisciplineCheck;
}

// ─────────────────────────────────────────────
// ENGINE INPUT
// ─────────────────────────────────────────────

export interface EngineInput {
  symbol: string;
  timeframe: string;
  candles: CandleData[];          // LTF candles (min 200)
  htfCandles?: CandleData[];      // HTF candles (min 100)
  mtfCandles?: CandleData[];      // MTF candles (min 100)
  accountBalance?: number;        // Default 10000
  riskPercent?: number;           // Default 1
  discipline?: DisciplineState;
}
