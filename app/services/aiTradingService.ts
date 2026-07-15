/**
 * AI TRADING SYSTEM CORE - Frontend Integration
 * =============================================
 * Service untuk mengakses AI Trading System Core API dari frontend.
 * 
 * Sistem ini menggunakan:
 * - INSTITUTIONAL-GRADE 11-step scoring engine
 * - Multi-timeframe hierarchy (H4 > H1 > M15 > M5/M1)
 * - Market structure detection (HH-HL / LH-LL)
 * - Supply/Demand zone validation
 * - News filter integration
 * - Strict RRR validation (min 1:2)
 * - Discipline & Anti-Revenge (cooldown after losses)
 * - Hybrid AI Validation (Step 11)
 */

import { CandlestickData } from '../components/chart/types';
import type {
  InstitutionalOutput,
  AIValidationResult,
} from '../lib/unifiedSignalGenerator';

// API Configuration
const BOT_API_URL = process.env.NEXT_PUBLIC_BOT_API_URL || 'http://localhost:8001';

// ==================== TYPES ====================

export interface AISignalRequest {
  symbol: string;
  h4_candles: CandlestickData[];
  h1_candles: CandlestickData[];
  m15_candles: CandlestickData[];
  m5_candles?: CandlestickData[];
  zones?: ZoneData[];
}

export interface ZoneData {
  type: 'supply' | 'demand';
  high: number;
  low: number;
  strength: number;
  timeframe: string;
  status: 'fresh' | 'tested' | 'broken';
}

export interface TrendAnalysis {
  h4_trend: string | null;
  h4_structure: string | null;
  h1_structure: string | null;
  hierarchy_aligned: boolean;
}

export interface EntryZone {
  description: string | null;
  type: string | null;
  strength: number;
}

export interface TradeLevels {
  entry: number | null;
  stop_loss: number | null;
  take_profit_1: number | null;
  take_profit_2: number | null;
}

export interface RiskReward {
  risk_pips: number;
  reward_pips_tp1: number;
  reward_pips_tp2: number;
  rrr_tp1: number;
  rrr_tp2: number;
}

export interface Validation {
  validity_score: number;
  quality_grade: string;
}

export interface EntryConfirmation {
  pattern: string | null;
  timeframe: string;
}

export interface NewsFilter {
  clear: boolean;
  upcoming: string[];
}

export interface AITradingSignal {
  // Common fields
  status: 'VALID' | 'NO_TRADE' | 'PENDING';
  signal_id: string;
  timestamp: string;
  symbol: string;
  
  // For NO_TRADE
  rejection_reasons?: string[];
  
  // For VALID signals
  direction?: 'BUY' | 'SELL';
  trend_analysis?: TrendAnalysis;
  entry_zone?: EntryZone;
  trade_levels?: TradeLevels;
  risk_reward?: RiskReward;
  validation?: Validation;
  entry_confirmation?: EntryConfirmation;
  news_filter?: NewsFilter;
  why_this_signal?: string;
  technical_reasons?: string[];
  
  // Analysis details (both)
  h4_trend?: string | null;
  h4_structure?: string | null;
  hierarchy_aligned?: boolean;
  news_clear?: boolean;
  upcoming_news?: string[];
}

export interface AISignalResponse {
  success: boolean;
  signal: AITradingSignal | null;
  error?: string;
  timestamp: string;
}

export interface AISystemStatus {
  status: string;
  version: string;
  min_rrr: number;
  min_validity_score: number;
  news_buffer_minutes: number;
  timestamp: string;
}

export interface QuickCheckResult {
  symbol: string;
  hierarchy_aligned: boolean;
  can_trade: boolean;
  suggested_direction: 'BUY' | 'SELL' | null;
  h4_trend: string;
  h1_trend: string;
  price_position: string;
  reasons: string[];
  timestamp: string;
}

// ==================== API SERVICE ====================

class AITradingService {
  private baseUrl: string;

  constructor(baseUrl: string = BOT_API_URL) {
    this.baseUrl = baseUrl;
  }

  /**
   * Get AI Trading System status
   */
  async getStatus(): Promise<AISystemStatus> {
    try {
      const response = await fetch(`${this.baseUrl}/api/ai-signal/status`);
      
      if (!response.ok) {
        throw new Error(`Status check failed: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[AI Trading] Status check error:', error);
      throw error;
    }
  }

  /**
   * 🎯 MAIN METHOD: Analyze market and get trading signal
   * 
   * @param request Analysis request with candle data
   * @returns Trading signal (VALID or NO_TRADE)
   */
  async analyze(request: AISignalRequest): Promise<AISignalResponse> {
    console.log(`[AI Trading] Analyzing ${request.symbol}...`);
    console.log(`[AI Trading] Data: H4=${request.h4_candles.length}, H1=${request.h1_candles.length}, M15=${request.m15_candles.length}`);

    try {
      // Convert candle format if needed
      const formattedRequest = {
        symbol: request.symbol,
        h4_candles: this.formatCandles(request.h4_candles),
        h1_candles: this.formatCandles(request.h1_candles),
        m15_candles: this.formatCandles(request.m15_candles),
        m5_candles: request.m5_candles ? this.formatCandles(request.m5_candles) : undefined,
        zones: request.zones
      };

      const response = await fetch(`${this.baseUrl}/api/ai-signal/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formattedRequest),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || `Analysis failed: ${response.statusText}`);
      }

      const result: AISignalResponse = await response.json();
      
      if (result.signal) {
        console.log(`[AI Trading] Signal: ${result.signal.status}`);
        if (result.signal.status === 'VALID') {
          console.log(`[AI Trading] Direction: ${result.signal.direction}`);
          console.log(`[AI Trading] Entry: ${result.signal.trade_levels?.entry}`);
          console.log(`[AI Trading] Validity: ${result.signal.validation?.validity_score}/100`);
        } else {
          console.log(`[AI Trading] Rejection: ${result.signal.rejection_reasons?.join(', ')}`);
        }
      }

      return result;
    } catch (error) {
      console.error('[AI Trading] Analysis error:', error);
      return {
        success: false,
        signal: null,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Quick hierarchy check without full analysis
   */
  async quickCheck(
    symbol: string,
    h4Trend: string,
    h1Trend: string,
    pricePosition: string
  ): Promise<QuickCheckResult> {
    try {
      const params = new URLSearchParams({
        symbol,
        h4_trend: h4Trend,
        h1_trend: h1Trend,
        price_position: pricePosition
      });

      const response = await fetch(
        `${this.baseUrl}/api/ai-signal/quick-check?${params}`,
        { method: 'POST' }
      );

      if (!response.ok) {
        throw new Error(`Quick check failed: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[AI Trading] Quick check error:', error);
      throw error;
    }
  }

  /**
   * Format candles to API format
   */
  private formatCandles(candles: CandlestickData[]): Array<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }> {
    return candles.map(c => ({
      time: typeof c.time === 'number' ? c.time : Math.floor(new Date(c.time).getTime() / 1000),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume || 0
    }));
  }

  /**
   * Step 11 — Hybrid AI Validation
   *
   * Called ONLY for grade A or B setups from the institutional engine.
   * AI may: confirm, reduce confidence, or reject.
   * AI must NEVER override risk rules.
   */
  async validateWithAI(
    signal: InstitutionalOutput,
    h4Candles: CandlestickData[],
    h1Candles: CandlestickData[],
  ): Promise<AIValidationResult> {
    // Only validate grade A/B
    if (signal.grade !== 'A+' && signal.grade !== 'A' && signal.grade !== 'B') {
      return { confirmed: true, confidence_adjustment: 0, rejection_reason: null };
    }

    try {
      const request: AISignalRequest = {
        symbol: signal.direction === 'NONE' ? 'UNKNOWN' : 'BTCUSDT',
        h4_candles: h4Candles,
        h1_candles: h1Candles,
        m15_candles: [], // not required for validation
      };

      const response = await this.analyze(request);

      if (!response.success || !response.signal) {
        // AI unavailable — don't block, just return neutral
        return { confirmed: true, confidence_adjustment: 0, rejection_reason: null };
      }

      const aiSignal = response.signal;

      // AI confirms if direction matches and validity is decent
      if (aiSignal.status === 'VALID' && aiSignal.direction === signal.direction) {
        const boost = Math.min(10, Math.round(
          ((aiSignal.validation?.validity_score || 50) - 50) / 5
        ));
        return {
          confirmed: true,
          confidence_adjustment: boost,
          rejection_reason: null,
        };
      }

      // AI says NO_TRADE or conflicting direction
      if (aiSignal.status === 'NO_TRADE') {
        return {
          confirmed: false,
          confidence_adjustment: -15,
          rejection_reason: aiSignal.rejection_reasons?.[0] || 'AI rejects setup',
        };
      }

      // Direction mismatch
      if (aiSignal.direction && aiSignal.direction !== signal.direction) {
        return {
          confirmed: false,
          confidence_adjustment: -20,
          rejection_reason: `AI direction ${aiSignal.direction} conflicts with ${signal.direction}`,
        };
      }

      return { confirmed: true, confidence_adjustment: 0, rejection_reason: null };
    } catch (err) {
      console.error('[AI Validation] Error:', err);
      // AI failure → don't block the trade
      return { confirmed: true, confidence_adjustment: 0, rejection_reason: null };
    }
  }
}

// ==================== SINGLETON INSTANCE ====================

export const aiTradingService = new AITradingService();

// ==================== HELPER FUNCTIONS ====================

/**
 * Parse AI signal for display
 */
export function parseSignalForDisplay(signal: AITradingSignal): {
  isValid: boolean;
  direction: string;
  entry: string;
  stopLoss: string;
  takeProfit1: string;
  takeProfit2: string;
  riskPips: string;
  rrrTP1: string;
  validityScore: number;
  grade: string;
  reasons: string[];
  explanation: string;
} {
  if (signal.status !== 'VALID') {
    return {
      isValid: false,
      direction: 'NO TRADE',
      entry: '-',
      stopLoss: '-',
      takeProfit1: '-',
      takeProfit2: '-',
      riskPips: '-',
      rrrTP1: '-',
      validityScore: 0,
      grade: 'F',
      reasons: signal.rejection_reasons || ['Unknown reason'],
      explanation: signal.why_this_signal || 'No trade signal generated'
    };
  }

  const levels = signal.trade_levels;
  const rr = signal.risk_reward;
  const validation = signal.validation;

  return {
    isValid: true,
    direction: signal.direction || 'UNKNOWN',
    entry: levels?.entry?.toFixed(5) || '-',
    stopLoss: levels?.stop_loss?.toFixed(5) || '-',
    takeProfit1: levels?.take_profit_1?.toFixed(5) || '-',
    takeProfit2: levels?.take_profit_2?.toFixed(5) || '-',
    riskPips: rr?.risk_pips?.toFixed(1) || '-',
    rrrTP1: rr?.rrr_tp1 ? `1:${rr.rrr_tp1.toFixed(1)}` : '-',
    validityScore: validation?.validity_score || 0,
    grade: validation?.quality_grade || 'F',
    reasons: signal.technical_reasons || [],
    explanation: signal.why_this_signal || ''
  };
}

/**
 * Get grade color based on quality grade (supports institutional grades)
 */
export function getGradeColor(grade: string): string {
  switch (grade) {
    case 'A+':
      return '#FFD700'; // Gold — rare, institutional
    case 'A':
      return '#26A65B'; // Green
    case 'B':
      return '#3B82F6'; // Blue
    case 'C':
      return '#F59E0B'; // Yellow
    case 'D':
      return '#F97316'; // Orange
    case 'NO_TRADE':
    case 'F':
    default:
      return '#E85C5C'; // Red
  }
}

/**
 * Get direction color
 */
export function getDirectionColor(direction: string): string {
  switch (direction) {
    case 'BUY':
      return '#26A65B'; // Green
    case 'SELL':
      return '#E85C5C'; // Red
    default:
      return '#6B7280'; // Gray
  }
}

/**
 * Format signal for logging
 */
export function formatSignalLog(signal: AITradingSignal): string {
  if (signal.status !== 'VALID') {
    return `[NO TRADE] ${signal.symbol} - ${signal.rejection_reasons?.[0] || 'Unknown reason'}`;
  }

  return `[${signal.direction}] ${signal.symbol} @ ${signal.trade_levels?.entry?.toFixed(5)} | SL: ${signal.trade_levels?.stop_loss?.toFixed(5)} | TP1: ${signal.trade_levels?.take_profit_1?.toFixed(5)} | Score: ${signal.validation?.validity_score}/100`;
}

// ==================== INSTITUTIONAL OUTPUT HELPERS ====================

/**
 * Parse InstitutionalOutput for display in UI components
 */
export function parseInstitutionalForDisplay(output: InstitutionalOutput): {
  isValid: boolean;
  decision: string;
  direction: string;
  grade: string;
  gradeColor: string;
  confidence: number;
  entry: string;
  stopLoss: string;
  takeProfits: string[];
  reasons: string[];
  invalidIf: string[];
  cooldown: boolean;
  cooldownReason: string;
  scoreBreakdown: {
    label: string;
    value: number;
    max: number;
  }[];
  stepResults: {
    step: number;
    name: string;
    passed: boolean;
    reason: string;
  }[];
  marketCondition: string;
  tierAllowed: boolean;
  tierReason: string;
} {
  const isValid = output.decision === 'TRADE';

  return {
    isValid,
    decision: output.decision,
    direction: output.direction,
    grade: output.grade,
    gradeColor: getGradeColor(output.grade),
    confidence: output.confidence,
    entry: output.entry?.toFixed(5) ?? '-',
    stopLoss: output.stop_loss?.toFixed(5) ?? '-',
    takeProfits: output.take_profit.map(tp => tp.toFixed(5)),
    reasons: output.reason,
    invalidIf: output.invalid_if.map(c => `${c.label}: ${c.description}`),
    cooldown: output.cooldown,
    cooldownReason: output.discipline.cooldown_reason,
    scoreBreakdown: [
      { label: 'Trend Clarity', value: output.score_breakdown.trend_clarity, max: 25 },
      { label: 'Structure', value: output.score_breakdown.structure_validity, max: 20 },
      { label: 'Zone Quality', value: output.score_breakdown.zone_quality, max: 20 },
      { label: 'Entry Candle', value: output.score_breakdown.entry_candle, max: 15 },
      { label: 'Sentiment', value: output.score_breakdown.sentiment_alignment, max: 10 },
      { label: 'RRR Bonus', value: output.score_breakdown.rrr_bonus, max: 10 },
    ],
    stepResults: output.step_results.map(s => ({
      step: s.step,
      name: s.name,
      passed: s.passed,
      reason: s.reason,
    })),
    marketCondition: `${output.market_condition} / ${output.volatility_quality}`,
    tierAllowed: output.tier_filter.allowed,
    tierReason: output.tier_filter.reason,
  };
}

export default aiTradingService;
