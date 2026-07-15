/**
 * SIGNAL VALIDATOR - Layer 1 Technical Analysis
 * 
 * Validasi ketat untuk setiap sinyal trading.
 * HARD RULES: RRR >= 2, Trend alignment, Zone proximity.
 * 
 * Output: TechnicalSignal yang sudah divalidasi atau NULL jika tidak lolos.
 */

import { CandleData } from './tradingRulesEngine';
// Indicators imported for future use
// import { Indicators } from './tradingRulesEngine';

// ==================== TYPES ====================

export interface SignalValidation {
  trend_alignment: boolean;          // H4 trend matches signal direction
  ema_order_valid: boolean;          // EMA 9 > 21 > 200 (bullish) or reverse
  zone_proximity: boolean;           // Price in/near S&D zone
  risk_reward_valid: boolean;        // RRR >= 2
  volume_confirmation: boolean;      // Volume trend supports
  atr_valid: boolean;                // ATR dalam range normal
  pattern_strength: 'weak' | 'normal' | 'strong';
}

export interface TrendContext {
  primary: 'BULLISH' | 'BEARISH' | 'SIDEWAYS';
  ema9_position: 'above' | 'below' | 'crossing';  // vs EMA21
  ema21_position: 'above' | 'below' | 'crossing'; // vs EMA200
  ema_order: 'aligned' | 'mixed';                 // all in order or not
  strength: number;                               // 0-100
  price_vs_ema200: 'above' | 'below';
}

export interface RiskRewardMetrics {
  risk_pips: number;           // entry - stopLoss
  reward_pips: number;         // takeProfit - entry  
  ratio: number;               // reward / risk
  is_valid: boolean;           // ratio >= MIN_RRR
  confidence_impact: number;   // 0-100 (higher RRR = higher confidence)
}

export interface ZoneStrengthScore {
  zone_id: string;
  strength: number;            // 0-100
  touches: number;             // How many times price touched
  rejection_count: number;     // How many times rejected
  age_factor: number;          // 0-100 (newer = higher)
  distance_factor: number;     // 0-100 (closer = higher)
  confidence_level: 'weak' | 'normal' | 'strong';
}

export interface TechnicalSignal {
  id: string;
  timestamp: number;
  symbol: string;
  timeframe: string;
  
  // Core signal data
  signal_type: 'BUY' | 'SELL';
  entry: number;
  stop_loss: number;
  take_profit_1: number;
  take_profit_2: number;
  
  // Confidence breakdown (0-100 each)
  trend_confidence: number;
  zone_confidence: number;
  riskReward_confidence: number;
  
  // Composite scores
  technical_confidence: number;      // 0-100 (weighted average)
  
  // Validation checklist
  validations: SignalValidation;
  validation_score: number;          // 0-100 (% of passed checks)
  
  // Reasoning (why this signal)
  technical_reason: string;
  reasons_list: string[];
  
  // Layer 2 & 3 (to be filled by subsequent layers)
  sentiment_boost?: number;          // -15 to +15
  market_validation?: 'ALIGNED' | 'CONFLICTING' | 'NEUTRAL';
  gemini_context?: string;           // AI explanation
  
  // Final recommendation
  recommendation: 'EXECUTE' | 'WAIT' | 'SKIP';
  quality_grade: 'A' | 'B' | 'C' | 'D' | 'F';
}

// ==================== CONSTANTS ====================

export const MIN_RRR = 2.0;                    // Minimum Risk:Reward Ratio
export const MIN_CONFIDENCE = 50;              // Minimum confidence to generate signal
export const MIN_TREND_STRENGTH = 40;          // Minimum trend strength
export const ZONE_PROXIMITY_MULTIPLIER = 2;    // Zone width multiplier for "near"

// Confidence weights for final score
export const CONFIDENCE_WEIGHTS = {
  trend: 0.40,      // 40% weight to trend alignment
  zone: 0.30,       // 30% weight to zone strength
  riskReward: 0.30  // 30% weight to RRR quality
};

// ==================== TREND DETECTION ====================

/**
 * Calculate EMA with period
 */
export function calculateEMA(data: number[], period: number): number {
  if (data.length === 0) return 0;
  if (data.length < period) {
    return data.reduce((a, b) => a + b, 0) / data.length;
  }
  
  const multiplier = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  
  for (let i = period; i < data.length; i++) {
    ema = (data[i] - ema) * multiplier + ema;
  }
  
  return ema;
}

/**
 * Detect trend context from price data
 * Returns primary trend direction and strength
 */
export function detectTrendContext(closes: number[]): TrendContext {
  if (closes.length < 200) {
    return { 
      primary: 'SIDEWAYS', 
      ema9_position: 'crossing', 
      ema21_position: 'crossing', 
      ema_order: 'mixed', 
      strength: 0,
      price_vs_ema200: 'above'
    };
  }

  // Calculate EMAs
  const ema9 = calculateEMA(closes, 9);
  const ema21 = calculateEMA(closes, 21);
  const ema200 = calculateEMA(closes, 200);
  const currentClose = closes[closes.length - 1];

  // Determine EMA positions
  const ema9Pos: 'above' | 'below' | 'crossing' = 
    Math.abs(ema9 - ema21) / ema21 < 0.001 ? 'crossing' :
    ema9 > ema21 ? 'above' : 'below';
    
  const ema21Pos: 'above' | 'below' | 'crossing' = 
    Math.abs(ema21 - ema200) / ema200 < 0.001 ? 'crossing' :
    ema21 > ema200 ? 'above' : 'below';

  // Price position relative to EMA200
  const priceVsEma200: 'above' | 'below' = currentClose > ema200 ? 'above' : 'below';

  // Determine primary trend and EMA order
  let primary: 'BULLISH' | 'BEARISH' | 'SIDEWAYS';
  let ema_order: 'aligned' | 'mixed';

  if (ema9Pos === 'above' && ema21Pos === 'above' && priceVsEma200 === 'above') {
    primary = 'BULLISH';
    ema_order = 'aligned';  // 9 > 21 > 200
  } else if (ema9Pos === 'below' && ema21Pos === 'below' && priceVsEma200 === 'below') {
    primary = 'BEARISH';
    ema_order = 'aligned';  // 9 < 21 < 200
  } else {
    primary = 'SIDEWAYS';
    ema_order = 'mixed';
  }

  // Calculate trend strength (0-100)
  const strength = calculateTrendStrength(ema9, ema21, ema200, currentClose);

  return {
    primary,
    ema9_position: ema9Pos,
    ema21_position: ema21Pos,
    ema_order,
    strength,
    price_vs_ema200: priceVsEma200
  };
}

/**
 * Calculate trend strength based on EMA separation
 */
function calculateTrendStrength(ema9: number, ema21: number, ema200: number, close: number): number {
  // Distance between EMAs as percentage
  const dist9_21 = Math.abs(ema9 - ema21) / ema21 * 100;
  const dist21_200 = Math.abs(ema21 - ema200) / ema200 * 100;
  const distPrice_200 = Math.abs(close - ema200) / ema200 * 100;
  
  // Stronger trend if EMAs are more separated and price is far from EMA200
  const rawStrength = (dist9_21 * 3 + dist21_200 * 2 + distPrice_200 * 1) / 6 * 20;
  
  return Math.min(100, Math.max(0, rawStrength));
}

// ==================== RISK/REWARD VALIDATION ====================

/**
 * Validate Risk:Reward ratio
 * HARD RULE: Must be >= MIN_RRR (2.0)
 */
export function validateRiskReward(
  entry: number,
  stopLoss: number,
  takeProfit: number,
  minRatio: number = MIN_RRR
): RiskRewardMetrics {
  
  // Calculate pips (normalize based on price magnitude)
  const pipMultiplier = entry > 100 ? 100 : 10000;  // Crypto vs Forex
  const risk_pips = Math.abs(entry - stopLoss) * pipMultiplier;
  const reward_pips = Math.abs(takeProfit - entry) * pipMultiplier;
  
  // Calculate ratio
  const ratio = risk_pips > 0 ? reward_pips / risk_pips : 0;
  
  // Validation
  const is_valid = ratio >= minRatio;
  
  // Confidence impact: higher RRR = higher confidence
  // 2.0 = 70%, 2.5 = 80%, 3.0 = 90%, 4.0+ = 100%
  let confidence_impact: number;
  if (ratio >= 4) confidence_impact = 100;
  else if (ratio >= 3) confidence_impact = 90;
  else if (ratio >= 2.5) confidence_impact = 80;
  else if (ratio >= 2) confidence_impact = 70;
  else confidence_impact = Math.max(0, ratio * 35);  // Below 2 = low confidence
  
  return {
    risk_pips: parseFloat(risk_pips.toFixed(2)),
    reward_pips: parseFloat(reward_pips.toFixed(2)),
    ratio: parseFloat(ratio.toFixed(2)),
    is_valid,
    confidence_impact
  };
}

/**
 * HARD RULE: Reject any signal with RRR < MIN_RRR
 */
export function shouldRejectByRRR(rrr: RiskRewardMetrics): { reject: boolean; reason: string } {
  if (!rrr.is_valid) {
    return {
      reject: true,
      reason: `RRR ${rrr.ratio} < ${MIN_RRR}. Risiko terlalu tinggi dibanding potensi profit.`
    };
  }
  return { reject: false, reason: '' };
}

// ==================== ZONE STRENGTH SCORING ====================

export interface PriceZone {
  id: string;
  type: 'supply' | 'demand';
  high: number;
  low: number;
  strength: number;
  created_at: number;
  status: 'fresh' | 'tested' | 'broken';
}

/**
 * Score zone strength based on multiple factors
 */
export function scoreZoneStrength(
  zone: PriceZone,
  currentPrice: number,
  allCandles: CandleData[]
): ZoneStrengthScore {
  
  // 1. Count touches and rejections
  let touches = 0;
  let rejections = 0;
  
  for (const candle of allCandles) {
    const touchedZone = candle.low <= zone.high && candle.high >= zone.low;
    
    if (touchedZone) {
      touches++;
      
      // Rejection = price touched zone but closed away from it
      const candleBody = Math.abs(candle.close - candle.open);
      const candleRange = candle.high - candle.low;
      const rejectStrength = candleRange > 0 ? candleBody / candleRange : 0;
      
      if (rejectStrength > 0.6) {
        rejections++;
      }
    }
  }
  
  // 2. Age factor (newer zones = more relevant)
  const zoneAge = Date.now() - zone.created_at;
  const maxAge = 7 * 24 * 60 * 60 * 1000;  // 7 days
  const age_factor = Math.max(30, 100 - (zoneAge / maxAge) * 70);
  
  // 3. Distance factor (closer = better)
  const zoneCenter = (zone.high + zone.low) / 2;
  const distancePercent = Math.abs(currentPrice - zoneCenter) / currentPrice * 100;
  const distance_factor = Math.max(0, 100 - distancePercent * 10);
  
  // 4. Calculate total strength
  const touch_score = Math.min(30, touches * 6);           // Each touch = +6, max 30
  const rejection_score = Math.min(30, rejections * 10);   // Each rejection = +10, max 30
  const age_score = age_factor * 0.2;                      // Max 20
  const dist_score = distance_factor * 0.2;                // Max 20
  
  const strength = Math.min(100, touch_score + rejection_score + age_score + dist_score);
  
  // 5. Determine confidence level
  let confidence_level: 'weak' | 'normal' | 'strong';
  if (strength >= 70) confidence_level = 'strong';
  else if (strength >= 45) confidence_level = 'normal';
  else confidence_level = 'weak';
  
  return {
    zone_id: zone.id,
    strength: parseFloat(strength.toFixed(1)),
    touches,
    rejection_count: rejections,
    age_factor: parseFloat(age_factor.toFixed(1)),
    distance_factor: parseFloat(distance_factor.toFixed(1)),
    confidence_level
  };
}

/**
 * Check if price is near a zone
 */
export function isNearZone(
  price: number, 
  zone: PriceZone, 
  multiplier: number = ZONE_PROXIMITY_MULTIPLIER
): boolean {
  const zoneWidth = zone.high - zone.low;
  const tolerance = zoneWidth * multiplier;
  return price >= zone.low - tolerance && price <= zone.high + tolerance;
}

// ==================== SWING DETECTION ====================

/**
 * Find recent swing low from candle data
 */
export function findSwingLow(candles: CandleData[], lookback: number = 10): number {
  if (candles.length < lookback) {
    return Math.min(...candles.map(c => c.low));
  }
  
  const recentCandles = candles.slice(-lookback);
  return Math.min(...recentCandles.map(c => c.low));
}

/**
 * Find recent swing high from candle data
 */
export function findSwingHigh(candles: CandleData[], lookback: number = 10): number {
  if (candles.length < lookback) {
    return Math.max(...candles.map(c => c.high));
  }
  
  const recentCandles = candles.slice(-lookback);
  return Math.max(...recentCandles.map(c => c.high));
}

// ==================== ATR CALCULATION ====================

/**
 * Calculate ATR (Average True Range)
 */
export function calculateATR(candles: CandleData[], period: number = 14): number {
  if (candles.length < period + 1) {
    // Fallback: use average range
    const ranges = candles.map(c => c.high - c.low);
    return ranges.reduce((a, b) => a + b, 0) / ranges.length;
  }
  
  const trueRanges: number[] = [];
  
  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const prevClose = candles[i - 1].close;
    
    const tr = Math.max(
      current.high - current.low,
      Math.abs(current.high - prevClose),
      Math.abs(current.low - prevClose)
    );
    
    trueRanges.push(tr);
  }
  
  // EMA-style ATR
  return calculateEMA(trueRanges.slice(-period * 2), period);
}

// ==================== VALIDATION CHECKLIST ====================

/**
 * Run all validation checks and return results
 */
export function runValidationChecks(
  signal: Partial<TechnicalSignal>,
  trend: TrendContext,
  rrr: RiskRewardMetrics,
  zoneScore: ZoneStrengthScore | null,
  atr: number,
  currentPrice: number
): SignalValidation {
  
  // Check trend alignment
  const trend_alignment = 
    (signal.signal_type === 'BUY' && trend.primary === 'BULLISH') ||
    (signal.signal_type === 'SELL' && trend.primary === 'BEARISH');
  
  // Check EMA order
  const ema_order_valid = trend.ema_order === 'aligned';
  
  // Check zone proximity
  const zone_proximity = zoneScore !== null && zoneScore.distance_factor >= 50;
  
  // Check RRR
  const risk_reward_valid = rrr.is_valid;
  
  // Check volume (placeholder - always true for now)
  const volume_confirmation = true;
  
  // Check ATR is reasonable (not too volatile, not too flat)
  const atrPercent = (atr / currentPrice) * 100;
  const atr_valid = atrPercent >= 0.1 && atrPercent <= 5;  // 0.1% to 5% is normal
  
  // Determine pattern strength from trend
  let pattern_strength: 'weak' | 'normal' | 'strong';
  if (trend.strength >= 70) pattern_strength = 'strong';
  else if (trend.strength >= 40) pattern_strength = 'normal';
  else pattern_strength = 'weak';
  
  return {
    trend_alignment,
    ema_order_valid,
    zone_proximity,
    risk_reward_valid,
    volume_confirmation,
    atr_valid,
    pattern_strength
  };
}

/**
 * Calculate validation score from checks
 */
export function calculateValidationScore(validations: SignalValidation): number {
  const checks = [
    validations.trend_alignment,
    validations.ema_order_valid,
    validations.zone_proximity,
    validations.risk_reward_valid,
    validations.volume_confirmation,
    validations.atr_valid
  ];
  
  const passed = checks.filter(Boolean).length;
  return Math.round((passed / checks.length) * 100);
}

// ==================== QUALITY GRADING ====================

/**
 * Determine signal quality grade
 */
export function determineQualityGrade(
  technicalConfidence: number,
  validationScore: number
): 'A' | 'B' | 'C' | 'D' | 'F' {
  const combinedScore = (technicalConfidence + validationScore) / 2;
  
  if (combinedScore >= 85) return 'A';
  if (combinedScore >= 70) return 'B';
  if (combinedScore >= 55) return 'C';
  if (combinedScore >= 40) return 'D';
  return 'F';
}

/**
 * Determine recommendation based on quality and validations
 */
export function determineRecommendation(
  grade: 'A' | 'B' | 'C' | 'D' | 'F',
  validations: SignalValidation
): 'EXECUTE' | 'WAIT' | 'SKIP' {
  // Critical checks that must pass
  if (!validations.risk_reward_valid) return 'SKIP';
  if (!validations.trend_alignment) return 'WAIT';
  
  // Grade-based recommendation
  if (grade === 'A' || grade === 'B') return 'EXECUTE';
  if (grade === 'C') return 'WAIT';
  return 'SKIP';
}

// ==================== REASON GENERATOR ====================

/**
 * Generate human-readable reason for the signal
 */
export function generateTechnicalReason(
  signalType: 'BUY' | 'SELL',
  trend: TrendContext,
  rrr: RiskRewardMetrics,
  zoneScore: ZoneStrengthScore | null,
  validations: SignalValidation
): { summary: string; list: string[] } {
  
  const reasons: string[] = [];
  const emoji = signalType === 'BUY' ? '📈' : '📉';
  
  // Trend reason
  if (validations.trend_alignment) {
    reasons.push(`${emoji} Trend ${trend.primary} (EMA aligned, strength ${trend.strength.toFixed(0)}%)`);
  } else {
    reasons.push(`⚠️ Trend ${trend.primary} tidak sesuai dengan signal ${signalType}`);
  }
  
  // EMA order
  if (validations.ema_order_valid) {
    const order = signalType === 'BUY' ? 'EMA9 > EMA21 > EMA200' : 'EMA9 < EMA21 < EMA200';
    reasons.push(`✓ ${order}`);
  }
  
  // Zone reason
  if (zoneScore && validations.zone_proximity) {
    reasons.push(`✓ Price dekat ${signalType === 'BUY' ? 'demand' : 'supply'} zone (strength ${zoneScore.strength.toFixed(0)}%)`);
  } else {
    reasons.push(`⚠️ Tidak ada konfirmasi zone`);
  }
  
  // RRR reason
  reasons.push(`${validations.risk_reward_valid ? '✓' : '✗'} RRR 1:${rrr.ratio.toFixed(1)} (risk ${rrr.risk_pips.toFixed(0)}p / reward ${rrr.reward_pips.toFixed(0)}p)`);
  
  // Summary
  const summary = `${signalType} signal - ${trend.primary} trend, RRR 1:${rrr.ratio.toFixed(1)}`;
  
  return { summary, list: reasons };
}
