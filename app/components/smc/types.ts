/**
 * SMC Strategy Types
 * ==================
 * TypeScript types untuk Smart Money Concept analysis
 */

import { CandlestickData } from '../chart/types';

// ==========================================
// INPUT TYPES
// ==========================================

export interface ZoneData {
  type: 'supply' | 'demand';
  status: 'fresh' | 'tested' | 'broken';
  high: number;
  low: number;
  strength: number;
  created_at?: number;
  tested_count?: number;
}

export interface MarketStructure {
  trend?: 'bullish' | 'bearish' | 'ranging';
  last_swing_high?: number;
  last_swing_low?: number;
  structure?: 'HH_HL' | 'LH_LL' | 'ranging';
}

export interface SMCAnalysisInput {
  ohlc_h4: CandlestickData[];
  ohlc_m15: CandlestickData[];
  supply_demand_zones?: ZoneData[];
  market_structure?: MarketStructure;
  current_volume?: number;
  symbol?: string;
}

// ==========================================
// OUTPUT TYPES
// ==========================================

export interface SMCSetup {
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  position_type: 'LONG' | 'SHORT';
  risk_pips: number;
  reward_pips_tp1: number;
  reward_pips_tp2: number;
  rrr_tp1: number;
  rrr_tp2: number;
}

export interface SMCAnalysisDetails {
  trend_h4?: string;
  poi_zone?: ZoneData;
  confirmation?: string;
  market_structure?: string;
}

export interface SMCAnalysisResult {
  decision: 'ENTRY' | 'NO_TRADE';
  confidence_score: number;
  logic: string;
  setup?: SMCSetup;
  analysis?: SMCAnalysisDetails;
  warnings?: string[];
  timestamp?: string;
}

// ==========================================
// HOOK STATE TYPES
// ==========================================

export interface SMCState {
  isAnalyzing: boolean;
  lastResult: SMCAnalysisResult | null;
  error: string | null;
  serviceStatus: 'online' | 'offline' | 'fallback';
  analysisCount: number;
}

export interface SMCActions {
  analyze: (input: SMCAnalysisInput) => Promise<SMCAnalysisResult>;
  clearResult: () => void;
  checkServiceStatus: () => Promise<void>;
}

export type UseSMCReturn = SMCState & SMCActions;

// ==========================================
// CONSTANTS
// ==========================================

export const SMC_CONFIG = {
  MIN_H4_CANDLES: 200,
  MIN_M15_CANDLES: 20,
  MIN_ZONE_STRENGTH: 60,
  MIN_RRR: 2.0,
  MIN_CONFIDENCE: 60,
  AUTO_ANALYZE_INTERVAL: 60000, // 1 minute
} as const;

export const DECISION_COLORS = {
  ENTRY: '#26A65B', // Green
  NO_TRADE: '#E85C5C', // Red
} as const;

export const CONFIDENCE_THRESHOLDS = {
  HIGH: 80, // 80-100: High confidence
  MEDIUM: 60, // 60-79: Medium confidence
  LOW: 40, // 40-59: Low confidence
  VERY_LOW: 0, // 0-39: Very low confidence
} as const;

export function getConfidenceLevel(score: number): 'high' | 'medium' | 'low' | 'very_low' {
  if (score >= CONFIDENCE_THRESHOLDS.HIGH) return 'high';
  if (score >= CONFIDENCE_THRESHOLDS.MEDIUM) return 'medium';
  if (score >= CONFIDENCE_THRESHOLDS.LOW) return 'low';
  return 'very_low';
}

export function getConfidenceColor(score: number): string {
  const level = getConfidenceLevel(score);
  switch (level) {
    case 'high': return '#26A65B';
    case 'medium': return '#F0B90B';
    case 'low': return '#E85C5C';
    default: return '#8B8B8B';
  }
}
