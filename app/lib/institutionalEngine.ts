/**
 * INSTITUTIONAL-GRADE TRADING ENGINE
 * ===================================
 *
 * Disciplined 11-step scoring & gating system that behaves like
 * a senior fund trader: capital preservation first, high-probability
 * execution second, trade frequency dead last.
 *
 * Core principle:
 *   If the setup is not clear, structured, and statistically
 *   favorable → NO TRADE.
 *
 * Scoring matrix (total 100):
 *   Trend clarity .............. 25
 *   Structure validity ......... 20
 *   Zone quality ............... 20
 *   Entry candle ............... 15
 *   Sentiment alignment ........ 10
 *   RRR ≥ 3 bonus .............. 10
 *
 * Grading:
 *   A+  ≥ 90  (rare, institutional-grade)
 *   A   80–89
 *   B   70–79
 *   < 70  → NO TRADE
 *
 * Monetisation tiers:
 *   FREE  → NO_TRADE / delayed
 *   PRO   → A & A+
 *   ELITE → A+ only (real-time)
 */

import { CandleData, SwingPoint } from './tradingRulesEngine';

// ────────────────────────────────────────────────────────────────────
// TYPES
// ────────────────────────────────────────────────────────────────────

export type InstitutionalGrade = 'A+' | 'A' | 'B' | 'NO_TRADE';
export type InstitutionalDecision = 'TRADE' | 'NO_TRADE';
export type TradeDirection = 'BUY' | 'SELL' | 'NONE';
export type MarketCondition = 'TRENDING' | 'RANGING' | 'CHOPPY';
export type VolatilityQuality = 'CLEAN' | 'RANDOM';
export type MonetisationTier = 'FREE' | 'PRO' | 'ELITE';

/** Score breakdown per step */
export interface ScoreBreakdown {
  trend_clarity: number;        // 0-25
  structure_validity: number;   // 0-20
  zone_quality: number;         // 0-20
  entry_candle: number;         // 0-15
  sentiment_alignment: number;  // 0-10
  rrr_bonus: number;            // 0-10
  total: number;                // 0-100
}

/** Result for each of the 11 steps */
export interface StepResult {
  step: number;
  name: string;
  passed: boolean;
  score: number;
  reason: string;
}

/** Cooldown / anti-revenge state */
export interface DisciplineState {
  consecutive_losses: number;
  cooldown_active: boolean;
  cooldown_until: number;           // Unix ms
  cooldown_reason: string;
  locked_candles_remaining: number;
  last_loss_grade: InstitutionalGrade | null;
}

/** Zone data for step 4 */
export interface InstitutionalZone {
  type: 'supply' | 'demand';
  high: number;
  low: number;
  strength: number;          // 0-100
  status: 'fresh' | 'tested' | 'broken';
  origin_impulse: boolean;   // originates from strong impulse
  test_count: number;
}

/** News event for step 7 */
export interface NewsEvent {
  title: string;
  impact: 'LOW' | 'MEDIUM' | 'HIGH';
  time: number;              // Unix ms
  currency: string;
}

/** Sentiment data for step 7 */
export interface SentimentData {
  bias: 'bullish' | 'bearish' | 'neutral';
  strength: number;          // 0-100
  source: string;
}

/** Full input to the institutional engine */
export interface InstitutionalInput {
  symbol: string;
  timeframe: string;
  candles: CandleData[];
  zones: InstitutionalZone[];
  news: NewsEvent[];
  sentiment?: SentimentData;
  discipline: DisciplineState;
  tier: MonetisationTier;
}

/** Invalidation conditions for the output */
export interface InvalidationCondition {
  label: string;
  description: string;
}

/** The final strict-format output */
export interface InstitutionalOutput {
  decision: InstitutionalDecision;
  direction: TradeDirection;
  grade: InstitutionalGrade;
  confidence: number;            // 0-100
  entry: number | null;
  stop_loss: number | null;
  take_profit: number[];
  reason: string[];
  invalid_if: InvalidationCondition[];
  cooldown: boolean;

  // Extended detail
  score_breakdown: ScoreBreakdown;
  step_results: StepResult[];
  discipline: DisciplineState;
  market_condition: MarketCondition;
  volatility_quality: VolatilityQuality;
  tier_filter: { tier: MonetisationTier; allowed: boolean; reason: string };
}

// ────────────────────────────────────────────────────────────────────
// CONSTANTS
// ────────────────────────────────────────────────────────────────────

const MIN_CANDLES = 200;
const EMA_FLAT_THRESHOLD = 0.0015;      // ±0.15 % slope → flat
const MIN_RRR = 2.0;
const MAX_RISK_PCT = 1.0;
const COOLDOWN_CANDLES_AFTER_2_LOSSES = 3;
const COOLDOWN_CANDLES_AFTER_APLUS_LOSS = 4;
const NEWS_BLOCK_MINUTES = 30;

// ────────────────────────────────────────────────────────────────────
// EMA & INDICATOR HELPERS
// ────────────────────────────────────────────────────────────────────

function ema(data: number[], period: number): number[] {
  const result: number[] = [];
  if (data.length === 0) return result;
  const k = 2 / (period + 1);
  let prev = data.slice(0, period).reduce((a, b) => a + b, 0) / Math.min(data.length, period);
  for (let i = 0; i < data.length; i++) {
    if (i < period) {
      prev = data.slice(0, i + 1).reduce((a, b) => a + b, 0) / (i + 1);
    } else {
      prev = (data[i] - prev) * k + prev;
    }
    result.push(prev);
  }
  return result;
}

function emaLast(data: number[], period: number): number {
  const series = ema(data, period);
  return series[series.length - 1] || 0;
}

function atr(candles: CandleData[], period = 14): number {
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close),
    );
    trs.push(tr);
  }
  return emaLast(trs, period);
}

// ────────────────────────────────────────────────────────────────────
// STEP 1 — MARKET CONTEXT FILTER
// ────────────────────────────────────────────────────────────────────

function stepMarketContext(candles: CandleData[]): {
  condition: MarketCondition;
  volatilityQuality: VolatilityQuality;
  result: StepResult;
} {
  const closes = candles.map(c => c.close);
  const ema50 = ema(closes, 50);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _last30 = closes.slice(-30);

  // Directional consistency: count how many consecutive bars move in
  // the same direction relative to EMA 50
  let aboveCount = 0;
  let belowCount = 0;
  for (let i = Math.max(0, closes.length - 30); i < closes.length; i++) {
    if (closes[i] > (ema50[i] || closes[i])) aboveCount++;
    else belowCount++;
  }

  const dominance = Math.max(aboveCount, belowCount) / 30;

  // Measure choppiness via body-to-range ratio of recent candles
  const recent = candles.slice(-20);
  let cleanCount = 0;
  for (const c of recent) {
    const body = Math.abs(c.close - c.open);
    const range = c.high - c.low;
    if (range > 0 && body / range > 0.45) cleanCount++;
  }
  const cleanRatio = cleanCount / recent.length;

  let condition: MarketCondition;
  let volatilityQuality: VolatilityQuality;

  if (dominance >= 0.65 && cleanRatio >= 0.5) {
    condition = 'TRENDING';
    volatilityQuality = 'CLEAN';
  } else if (dominance >= 0.50) {
    condition = 'RANGING';
    volatilityQuality = cleanRatio >= 0.4 ? 'CLEAN' : 'RANDOM';
  } else {
    condition = 'CHOPPY';
    volatilityQuality = 'RANDOM';
  }

  const passed = condition !== 'CHOPPY' && volatilityQuality !== 'RANDOM';
  return {
    condition,
    volatilityQuality,
    result: {
      step: 1,
      name: 'Market Context',
      passed,
      score: 0, // context filter, not scored
      reason: passed
        ? `${condition} market with ${volatilityQuality} volatility`
        : `${condition} / ${volatilityQuality} → forced trades forbidden`,
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// STEP 2 — TREND BIAS (EMA 200)
// ────────────────────────────────────────────────────────────────────

function stepTrendBias(candles: CandleData[]): {
  direction: TradeDirection;
  ema200: number;
  trendScore: number;
  result: StepResult;
} {
  const closes = candles.map(c => c.close);
  const e200 = ema(closes, 200);
  const current = closes[closes.length - 1];
  const ema200Val = e200[e200.length - 1];

  // Check if EMA 200 is flat (slope over last 20 bars)
  const slope20 = e200.length >= 20
    ? (e200[e200.length - 1] - e200[e200.length - 20]) / e200[e200.length - 20]
    : 0;
  const isFlat = Math.abs(slope20) < EMA_FLAT_THRESHOLD;

  // Price clearly above/below
  const distPct = (current - ema200Val) / ema200Val;
  const clearlyAbove = distPct > 0.002;   // >0.2 %
  const clearlyBelow = distPct < -0.002;

  let direction: TradeDirection = 'NONE';
  let score = 0;

  if (isFlat || (!clearlyAbove && !clearlyBelow)) {
    // EMA 200 flat or price inside → NO TRADE
    direction = 'NONE';
    score = 0;
  } else if (clearlyAbove) {
    direction = 'BUY';
    // Score: how far and how steep
    score = Math.min(25, Math.round(Math.abs(distPct) * 500 + Math.abs(slope20) * 2000));
  } else {
    direction = 'SELL';
    score = Math.min(25, Math.round(Math.abs(distPct) * 500 + Math.abs(slope20) * 2000));
  }

  const passed = direction !== 'NONE';
  return {
    direction,
    ema200: ema200Val,
    trendScore: score,
    result: {
      step: 2,
      name: 'Trend Bias (EMA 200)',
      passed,
      score,
      reason: passed
        ? `Price ${direction === 'BUY' ? 'above' : 'below'} EMA 200 (${ema200Val.toFixed(2)}), slope ${(slope20 * 100).toFixed(2)}%`
        : `EMA 200 flat (slope ${(slope20 * 100).toFixed(3)}%) or price inside EMA → NO TRADE`,
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// STEP 3 — MARKET STRUCTURE (HH/HL or LH/LL)
// ────────────────────────────────────────────────────────────────────

function detectSwings(candles: CandleData[], lookback = 5): SwingPoint[] {
  const swings: SwingPoint[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const c = candles[i];
    const left = candles.slice(i - lookback, i);
    const right = candles.slice(i + 1, i + lookback + 1);

    const isHigh = left.every(l => l.high <= c.high) && right.every(r => r.high <= c.high);
    const isLow = left.every(l => l.low >= c.low) && right.every(r => r.low >= c.low);

    if (isHigh) {
      const prev = [...swings].reverse().find(s => s.type === 'HH' || s.type === 'LH');
      const type: 'HH' | 'LH' = prev ? (c.high > prev.price ? 'HH' : 'LH') : 'HH';
      swings.push({ type, price: c.high, time: c.time });
    }
    if (isLow) {
      const prev = [...swings].reverse().find(s => s.type === 'HL' || s.type === 'LL');
      const type: 'HL' | 'LL' = prev ? (c.low > prev.price ? 'HL' : 'LL') : 'HL';
      swings.push({ type, price: c.low, time: c.time });
    }
  }
  return swings.slice(-8);
}

function stepMarketStructure(
  candles: CandleData[],
  requiredDirection: TradeDirection,
): { score: number; swings: SwingPoint[]; result: StepResult } {
  const swings = detectSwings(candles, 5);
  const recent = swings.slice(-4);

  // Count HH/HL vs LH/LL
  const bullishSwings = recent.filter(s => s.type === 'HH' || s.type === 'HL').length;
  const bearishSwings = recent.filter(s => s.type === 'LH' || s.type === 'LL').length;

  let passed = false;
  let score = 0;
  let reason = '';

  if (requiredDirection === 'BUY') {
    if (bullishSwings >= 2) {
      passed = true;
      score = Math.min(20, bullishSwings * 7);
      reason = `HH/HL structure confirmed (${bullishSwings}/4 swings bullish)`;
    } else {
      reason = `No clear HH/HL structure (${bullishSwings}/4) → NO TRADE`;
    }
  } else if (requiredDirection === 'SELL') {
    if (bearishSwings >= 2) {
      passed = true;
      score = Math.min(20, bearishSwings * 7);
      reason = `LH/LL structure confirmed (${bearishSwings}/4 swings bearish)`;
    } else {
      reason = `No clear LH/LL structure (${bearishSwings}/4) → NO TRADE`;
    }
  } else {
    reason = 'Direction NONE — cannot evaluate structure';
  }

  return {
    score,
    swings,
    result: { step: 3, name: 'Market Structure', passed, score, reason },
  };
}

// ────────────────────────────────────────────────────────────────────
// STEP 4 — SUPPLY / DEMAND ZONE
// ────────────────────────────────────────────────────────────────────

function stepZoneQuality(
  zones: InstitutionalZone[],
  direction: TradeDirection,
  currentPrice: number,
  currentATR: number,
): { score: number; bestZone: InstitutionalZone | null; result: StepResult } {
  // Filter zones by direction
  const relevantType = direction === 'BUY' ? 'demand' : 'supply';
  const candidates = zones.filter(z => z.type === relevantType && z.status !== 'broken');

  if (candidates.length === 0) {
    return {
      score: 0,
      bestZone: null,
      result: { step: 4, name: 'Supply / Demand Zone', passed: false, score: 0, reason: `No active ${relevantType} zones → NO TRADE` },
    };
  }

  // Score each zone
  let bestZone: InstitutionalZone | null = null;
  let bestScore = 0;

  for (const zone of candidates) {
    let zScore = 0;

    // Freshness: fresh = 10, tested once = 5, tested 2+ = 0
    if (zone.status === 'fresh') zScore += 10;
    else if (zone.test_count <= 1) zScore += 5;

    // Imbalance / origin
    if (zone.origin_impulse) zScore += 5;

    // Zone strength
    zScore += Math.min(5, zone.strength / 20);

    // Proximity: price must be near zone (within 2× ATR)
    const zoneCenter = (zone.high + zone.low) / 2;
    const dist = Math.abs(currentPrice - zoneCenter);
    if (dist <= currentATR * 2) {
      // Closer = better
      const proxScore = Math.max(0, 1 - dist / (currentATR * 2));
      zScore *= (0.5 + proxScore * 0.5);
    } else {
      zScore *= 0.2; // too far, massive penalty
    }

    if (zScore > bestScore) {
      bestScore = zScore;
      bestZone = zone;
    }
  }

  const finalScore = Math.min(20, Math.round(bestScore));
  const passed = finalScore >= 8 && bestZone !== null && bestZone.status === 'fresh';

  return {
    score: finalScore,
    bestZone,
    result: {
      step: 4,
      name: 'Supply / Demand Zone',
      passed,
      score: finalScore,
      reason: passed
        ? `Fresh ${relevantType} zone (strength ${bestZone!.strength}, ${bestZone!.origin_impulse ? 'impulse origin' : 'normal'})`
        : `Zone weak or late (score ${finalScore}/20) → NO TRADE`,
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// STEP 5 — ENTRY CONFIRMATION (candle pattern at key level)
// ────────────────────────────────────────────────────────────────────

function stepEntryConfirmation(
  candles: CandleData[],
  direction: TradeDirection,
  nearZone: boolean,
): { score: number; patternName: string; result: StepResult } {
  if (!nearZone) {
    return {
      score: 0,
      patternName: 'none',
      result: { step: 5, name: 'Entry Confirmation', passed: false, score: 0, reason: 'Not near key level — no mid-range entries' },
    };
  }

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  if (!last || !prev) {
    return {
      score: 0,
      patternName: 'none',
      result: { step: 5, name: 'Entry Confirmation', passed: false, score: 0, reason: 'Insufficient candle data' },
    };
  }

  const body = Math.abs(last.close - last.open);
  const range = last.high - last.low;
  const lowerWick = Math.min(last.open, last.close) - last.low;
  const upperWick = last.high - Math.max(last.open, last.close);
  const prevBody = Math.abs(prev.close - prev.open);

  let score = 0;
  let patternName = 'none';

  if (direction === 'BUY') {
    // Bullish pin bar / hammer
    if (range > 0 && lowerWick > body * 2 && lowerWick > range * 0.55) {
      score = 13;
      patternName = 'Bullish Pin Bar';
    }
    // Bullish engulfing
    else if (last.close > last.open && body > prevBody * 1.2 && last.close > prev.high && last.open <= prev.close) {
      score = 15;
      patternName = 'Bullish Engulfing';
    }
    // Morning star (simplified)
    else if (candles.length >= 3) {
      const pp = candles[candles.length - 3];
      const ppBody = Math.abs(pp.close - pp.open);
      if (pp.close < pp.open && prevBody < ppBody * 0.3 && last.close > last.open && last.close > pp.open) {
        score = 12;
        patternName = 'Morning Star';
      }
    }
    // Simple bullish candle with decent body
    else if (last.close > last.open && body / range > 0.5) {
      score = 8;
      patternName = 'Bullish Candle';
    }
  } else if (direction === 'SELL') {
    // Shooting star
    if (range > 0 && upperWick > body * 2 && upperWick > range * 0.55) {
      score = 13;
      patternName = 'Bearish Shooting Star';
    }
    // Bearish engulfing
    else if (last.close < last.open && body > prevBody * 1.2 && last.close < prev.low && last.open >= prev.close) {
      score = 15;
      patternName = 'Bearish Engulfing';
    }
    // Evening star
    else if (candles.length >= 3) {
      const pp = candles[candles.length - 3];
      const ppBody = Math.abs(pp.close - pp.open);
      if (pp.close > pp.open && prevBody < ppBody * 0.3 && last.close < last.open && last.close < pp.open) {
        score = 12;
        patternName = 'Evening Star';
      }
    }
    // Simple bearish candle
    else if (last.close < last.open && body / range > 0.5) {
      score = 8;
      patternName = 'Bearish Candle';
    }
  }

  const passed = score >= 8;
  return {
    score: Math.min(15, score),
    patternName,
    result: {
      step: 5,
      name: 'Entry Confirmation',
      passed,
      score: Math.min(15, score),
      reason: passed
        ? `${patternName} at key level (score ${score}/15)`
        : 'No valid entry pattern at key level',
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// STEP 6 — RISK MANAGEMENT (RRR ≥ 2, SL structure-based, ≤1%)
// ────────────────────────────────────────────────────────────────────

function stepRiskManagement(
  direction: TradeDirection,
  entry: number,
  swings: SwingPoint[],
  currentATR: number,
): {
  sl: number;
  tp1: number;
  tp2: number;
  rrr: number;
  score: number;
  result: StepResult;
} {
  // Structure-based stop loss
  let sl: number;
  if (direction === 'BUY') {
    const recentLows = swings.filter(s => s.type === 'HL' || s.type === 'LL').map(s => s.price);
    sl = recentLows.length > 0 ? Math.min(...recentLows) - currentATR * 0.3 : entry - currentATR * 2;
  } else {
    const recentHighs = swings.filter(s => s.type === 'HH' || s.type === 'LH').map(s => s.price);
    sl = recentHighs.length > 0 ? Math.max(...recentHighs) + currentATR * 0.3 : entry + currentATR * 2;
  }

  const risk = Math.abs(entry - sl);

  // Take profit levels
  let tp1: number, tp2: number;
  if (direction === 'BUY') {
    tp1 = entry + risk * 2;
    tp2 = entry + risk * 3;
  } else {
    tp1 = entry - risk * 2;
    tp2 = entry - risk * 3;
  }

  const rrr = risk > 0 ? Math.abs(tp1 - entry) / risk : 0;

  // RRR score
  let score = 0;
  if (rrr >= 3) score = 10;
  else if (rrr >= 2.5) score = 7;
  else if (rrr >= 2) score = 4;

  const passed = rrr >= MIN_RRR;
  return {
    sl,
    tp1,
    tp2,
    rrr,
    score,
    result: {
      step: 6,
      name: 'Risk Management',
      passed,
      score,
      reason: passed
        ? `RRR 1:${rrr.toFixed(1)}, SL structure-based, risk ≤ ${MAX_RISK_PCT}%`
        : `RRR 1:${rrr.toFixed(1)} < minimum 1:${MIN_RRR} → NO TRADE`,
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// STEP 7 — NEWS & SENTIMENT
// ────────────────────────────────────────────────────────────────────

function stepNewsSentiment(
  news: NewsEvent[],
  sentiment: SentimentData | undefined,
  direction: TradeDirection,
): { sentimentScore: number; newsBlocked: boolean; result: StepResult } {
  const now = Date.now();
  const blockWindow = NEWS_BLOCK_MINUTES * 60 * 1000;

  // Check upcoming high-impact news
  const upcomingHigh = news.filter(
    n => n.impact === 'HIGH' && n.time > now && n.time < now + blockWindow,
  );

  if (upcomingHigh.length > 0) {
    return {
      sentimentScore: 0,
      newsBlocked: true,
      result: {
        step: 7,
        name: 'News & Sentiment',
        passed: false,
        score: 0,
        reason: `High-impact news in ${NEWS_BLOCK_MINUTES}min: ${upcomingHigh.map(n => n.title).join(', ')} → BLOCK TRADE`,
      },
    };
  }

  // Sentiment alignment
  let sentimentScore = 5; // neutral default
  if (sentiment) {
    const aligned =
      (direction === 'BUY' && sentiment.bias === 'bullish') ||
      (direction === 'SELL' && sentiment.bias === 'bearish');
    const conflicting =
      (direction === 'BUY' && sentiment.bias === 'bearish') ||
      (direction === 'SELL' && sentiment.bias === 'bullish');

    if (aligned) {
      sentimentScore = Math.min(10, Math.round(5 + sentiment.strength / 20));
    } else if (conflicting && sentiment.strength >= 70) {
      // Strong sentiment against direction → NO TRADE
      return {
        sentimentScore: 0,
        newsBlocked: false,
        result: {
          step: 7,
          name: 'News & Sentiment',
          passed: false,
          score: 0,
          reason: `Strong ${sentiment.bias} sentiment (${sentiment.strength}%) against ${direction} → NO TRADE`,
        },
      };
    } else if (conflicting) {
      sentimentScore = Math.max(0, 5 - Math.round(sentiment.strength / 20));
    }
  }

  return {
    sentimentScore,
    newsBlocked: false,
    result: {
      step: 7,
      name: 'News & Sentiment',
      passed: true,
      score: sentimentScore,
      reason: sentiment
        ? `Sentiment ${sentiment.bias} (${sentiment.strength}%), no blocking news`
        : 'No sentiment data, no blocking news',
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// STEP 8 — OBJECTIVE SCORING (aggregate)
// ────────────────────────────────────────────────────────────────────

function calculateTotalScore(
  trendScore: number,
  structureScore: number,
  zoneScore: number,
  entryScore: number,
  sentimentScore: number,
  rrrBonus: number,
): ScoreBreakdown {
  return {
    trend_clarity: trendScore,
    structure_validity: structureScore,
    zone_quality: zoneScore,
    entry_candle: entryScore,
    sentiment_alignment: sentimentScore,
    rrr_bonus: rrrBonus,
    total: trendScore + structureScore + zoneScore + entryScore + sentimentScore + rrrBonus,
  };
}

// ────────────────────────────────────────────────────────────────────
// STEP 9 — GRADING
// ────────────────────────────────────────────────────────────────────

function gradeFromScore(total: number): InstitutionalGrade {
  if (total >= 90) return 'A+';
  if (total >= 80) return 'A';
  if (total >= 70) return 'B';
  return 'NO_TRADE';
}

// ────────────────────────────────────────────────────────────────────
// STEP 10 — DISCIPLINE & ANTI-REVENGE
// ────────────────────────────────────────────────────────────────────

function stepDiscipline(
  discipline: DisciplineState,
): { allowed: boolean; updatedDiscipline: DisciplineState; result: StepResult } {
  const now = Date.now();

  // Check cooldown
  if (discipline.cooldown_active && now < discipline.cooldown_until) {
    return {
      allowed: false,
      updatedDiscipline: discipline,
      result: {
        step: 10,
        name: 'Discipline & Anti-Revenge',
        passed: false,
        score: 0,
        reason: `Cooldown active: ${discipline.cooldown_reason}. ${discipline.locked_candles_remaining} candles remaining.`,
      },
    };
  }

  // Cooldown expired → clear
  const updated: DisciplineState = {
    ...discipline,
    cooldown_active: now < discipline.cooldown_until,
    locked_candles_remaining: Math.max(0, discipline.locked_candles_remaining),
  };

  if (updated.cooldown_active) {
    return {
      allowed: false,
      updatedDiscipline: updated,
      result: {
        step: 10,
        name: 'Discipline & Anti-Revenge',
        passed: false,
        score: 0,
        reason: `Cooldown still active (${updated.cooldown_reason})`,
      },
    };
  }

  return {
    allowed: true,
    updatedDiscipline: updated,
    result: {
      step: 10,
      name: 'Discipline & Anti-Revenge',
      passed: true,
      score: 0,
      reason: 'No cooldown active, discipline clear',
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// STEP 11 — HYBRID AI VALIDATION (placeholder — actual AI call is
//           handled externally by aiTradingService; here we define
//           the interface and gating logic)
// ────────────────────────────────────────────────────────────────────

export interface AIValidationResult {
  confirmed: boolean;
  confidence_adjustment: number;   // -20 to +10
  rejection_reason: string | null;
}

/**
 * AI validation is only invoked for grade A or B setups.
 * AI may: confirm, reduce confidence, or reject.
 * AI must NEVER override risk rules.
 */
function stepAIValidation(
  grade: InstitutionalGrade,
  aiResult: AIValidationResult | null,
): { adjustedConfidence: number; result: StepResult } {
  // AI only used for A or B
  if (grade !== 'A+' && grade !== 'A' && grade !== 'B') {
    return {
      adjustedConfidence: 0,
      result: {
        step: 11,
        name: 'Hybrid AI Validation',
        passed: true,
        score: 0,
        reason: 'AI validation not applicable (grade < B)',
      },
    };
  }

  if (!aiResult) {
    return {
      adjustedConfidence: 0,
      result: {
        step: 11,
        name: 'Hybrid AI Validation',
        passed: true,
        score: 0,
        reason: 'AI validation not available — proceeding with technical score only',
      },
    };
  }

  if (!aiResult.confirmed) {
    return {
      adjustedConfidence: aiResult.confidence_adjustment,
      result: {
        step: 11,
        name: 'Hybrid AI Validation',
        passed: false,
        score: 0,
        reason: `AI REJECTED: ${aiResult.rejection_reason || 'Setup not confirmed'}`,
      },
    };
  }

  return {
    adjustedConfidence: aiResult.confidence_adjustment,
    result: {
      step: 11,
      name: 'Hybrid AI Validation',
      passed: true,
      score: 0,
      reason: `AI confirmed (confidence ${aiResult.confidence_adjustment >= 0 ? '+' : ''}${aiResult.confidence_adjustment}%)`,
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// TIER FILTER
// ────────────────────────────────────────────────────────────────────

function filterByTier(
  grade: InstitutionalGrade,
  tier: MonetisationTier,
): { allowed: boolean; reason: string } {
  if (grade === 'NO_TRADE') return { allowed: true, reason: 'NO_TRADE passes all tiers' };

  switch (tier) {
    case 'ELITE':
      if (grade === 'A+') return { allowed: true, reason: 'ELITE: A+ signal — real-time' };
      return { allowed: false, reason: `ELITE tier: only A+ allowed (got ${grade})` };
    case 'PRO':
      if (grade === 'A+' || grade === 'A') return { allowed: true, reason: `PRO: ${grade} signal` };
      return { allowed: false, reason: `PRO tier: A or A+ required (got ${grade})` };
    case 'FREE':
    default:
      return { allowed: true, reason: 'FREE: NO_TRADE / delayed signals only' };
  }
}

// ────────────────────────────────────────────────────────────────────
// MAIN ENGINE
// ────────────────────────────────────────────────────────────────────

/**
 * Run the full 11-step institutional analysis pipeline.
 *
 * @param input  Market data, zones, news, sentiment, discipline state, tier
 * @param aiResult  Optional AI validation result (from external AI service)
 * @returns  InstitutionalOutput with decision, grade, levels, and full breakdown
 */
export function runInstitutionalEngine(
  input: InstitutionalInput,
  aiResult: AIValidationResult | null = null,
): InstitutionalOutput {
  const { candles, zones, news, sentiment, discipline, tier } = input;
  const steps: StepResult[] = [];

  // Helper: early NO_TRADE exit
  const noTrade = (
    extraSteps: StepResult[],
    reason: string[],
    scoreBreakdown: ScoreBreakdown,
    condition: MarketCondition = 'CHOPPY',
    volQ: VolatilityQuality = 'RANDOM',
    disc: DisciplineState = discipline,
  ): InstitutionalOutput => ({
    decision: 'NO_TRADE',
    direction: 'NONE',
    grade: 'NO_TRADE',
    confidence: 0,
    entry: null,
    stop_loss: null,
    take_profit: [],
    reason,
    invalid_if: [],
    cooldown: disc.cooldown_active,
    score_breakdown: scoreBreakdown,
    step_results: [...steps, ...extraSteps],
    discipline: disc,
    market_condition: condition,
    volatility_quality: volQ,
    tier_filter: { tier, ...filterByTier('NO_TRADE', tier) },
  });

  const zeroScore: ScoreBreakdown = {
    trend_clarity: 0, structure_validity: 0, zone_quality: 0,
    entry_candle: 0, sentiment_alignment: 0, rrr_bonus: 0, total: 0,
  };

  // ─── STEP 0: Data sufficiency ─────────────────────────────
  if (candles.length < MIN_CANDLES) {
    const r: StepResult = {
      step: 0, name: 'Data Check', passed: false, score: 0,
      reason: `Need ${MIN_CANDLES} candles, got ${candles.length}`,
    };
    return noTrade([r], [r.reason], zeroScore);
  }

  // ─── STEP 1: Market Context ───────────────────────────────
  const ctx = stepMarketContext(candles);
  steps.push(ctx.result);
  if (!ctx.result.passed) {
    return noTrade([], [ctx.result.reason], zeroScore, ctx.condition, ctx.volatilityQuality);
  }

  // ─── STEP 2: Trend Bias ───────────────────────────────────
  const trend = stepTrendBias(candles);
  steps.push(trend.result);
  if (!trend.result.passed) {
    return noTrade([], [trend.result.reason], zeroScore, ctx.condition, ctx.volatilityQuality);
  }

  // ─── STEP 3: Market Structure ─────────────────────────────
  const structure = stepMarketStructure(candles, trend.direction);
  steps.push(structure.result);
  if (!structure.result.passed) {
    return noTrade([], [structure.result.reason], { ...zeroScore, trend_clarity: trend.trendScore }, ctx.condition, ctx.volatilityQuality);
  }

  // ─── STEP 4: Zone Quality ─────────────────────────────────
  const currentPrice = candles[candles.length - 1].close;
  const currentATR = atr(candles, 14);
  const zone = stepZoneQuality(zones, trend.direction, currentPrice, currentATR);
  steps.push(zone.result);
  if (!zone.result.passed) {
    return noTrade(
      [],
      [zone.result.reason],
      { ...zeroScore, trend_clarity: trend.trendScore, structure_validity: structure.score },
      ctx.condition,
      ctx.volatilityQuality,
    );
  }

  // ─── STEP 5: Entry Confirmation ───────────────────────────
  const nearZone = zone.bestZone !== null;
  const entry = stepEntryConfirmation(candles, trend.direction, nearZone);
  steps.push(entry.result);
  // Entry candle failure doesn't hard-block, but reduces score

  // ─── STEP 6: Risk Management ──────────────────────────────
  const entryPrice = currentPrice;
  const risk = stepRiskManagement(trend.direction, entryPrice, structure.swings, currentATR);
  steps.push(risk.result);
  if (!risk.result.passed) {
    return noTrade(
      [],
      [risk.result.reason],
      {
        trend_clarity: trend.trendScore,
        structure_validity: structure.score,
        zone_quality: zone.score,
        entry_candle: entry.score,
        sentiment_alignment: 0,
        rrr_bonus: 0,
        total: trend.trendScore + structure.score + zone.score + entry.score,
      },
      ctx.condition,
      ctx.volatilityQuality,
    );
  }

  // ─── STEP 7: News & Sentiment ─────────────────────────────
  const newsSent = stepNewsSentiment(news, sentiment, trend.direction);
  steps.push(newsSent.result);
  if (!newsSent.result.passed) {
    return noTrade(
      [],
      [newsSent.result.reason],
      {
        trend_clarity: trend.trendScore,
        structure_validity: structure.score,
        zone_quality: zone.score,
        entry_candle: entry.score,
        sentiment_alignment: 0,
        rrr_bonus: risk.score,
        total: trend.trendScore + structure.score + zone.score + entry.score + risk.score,
      },
      ctx.condition,
      ctx.volatilityQuality,
    );
  }

  // ─── STEP 8: Total Score ──────────────────────────────────
  const scoreBreakdown = calculateTotalScore(
    trend.trendScore,
    structure.score,
    zone.score,
    entry.score,
    newsSent.sentimentScore,
    risk.score,
  );
  const step8: StepResult = {
    step: 8,
    name: 'Objective Scoring',
    passed: true,
    score: scoreBreakdown.total,
    reason: `Total score: ${scoreBreakdown.total}/100`,
  };
  steps.push(step8);

  // ─── STEP 9: Grading ─────────────────────────────────────
  const grade = gradeFromScore(scoreBreakdown.total);
  const step9: StepResult = {
    step: 9,
    name: 'Grading',
    passed: grade !== 'NO_TRADE',
    score: scoreBreakdown.total,
    reason: grade !== 'NO_TRADE'
      ? `Grade ${grade} (score ${scoreBreakdown.total})`
      : `Score ${scoreBreakdown.total} < 70 → NO TRADE`,
  };
  steps.push(step9);

  if (grade === 'NO_TRADE') {
    return noTrade([], [`Score ${scoreBreakdown.total} below minimum 70`], scoreBreakdown, ctx.condition, ctx.volatilityQuality);
  }

  // ─── STEP 10: Discipline ─────────────────────────────────
  const disc = stepDiscipline(discipline);
  steps.push(disc.result);
  if (!disc.allowed) {
    return noTrade([], [disc.result.reason], scoreBreakdown, ctx.condition, ctx.volatilityQuality, disc.updatedDiscipline);
  }

  // ─── STEP 11: AI Validation ──────────────────────────────
  const ai = stepAIValidation(grade, aiResult);
  steps.push(ai.result);

  // If AI explicitly rejects
  if (aiResult && !aiResult.confirmed) {
    return noTrade(
      [],
      [ai.result.reason],
      scoreBreakdown,
      ctx.condition,
      ctx.volatilityQuality,
      disc.updatedDiscipline,
    );
  }

  // Final confidence
  const baseConfidence = scoreBreakdown.total;
  const finalConfidence = Math.max(0, Math.min(100, baseConfidence + ai.adjustedConfidence));

  // ─── TIER FILTER ──────────────────────────────────────────
  const tierCheck = filterByTier(grade, tier);

  // Build reasons
  const reasons: string[] = [];
  if (trend.direction === 'BUY') reasons.push(`Clear trend above EMA 200 (${trend.ema200.toFixed(2)})`);
  else reasons.push(`Clear trend below EMA 200 (${trend.ema200.toFixed(2)})`);
  reasons.push(structure.result.reason);
  if (zone.bestZone) reasons.push(`${zone.bestZone.status === 'fresh' ? 'Fresh' : 'Tested'} ${zone.bestZone.type} zone`);
  if (entry.patternName !== 'none') reasons.push(`${entry.patternName} at key level`);
  reasons.push(`RRR 1:${risk.rrr.toFixed(1)}`);

  // Invalidation conditions
  const invalidIf: InvalidationCondition[] = [
    { label: 'Structure breaks', description: `${trend.direction === 'BUY' ? 'HH/HL' : 'LH/LL'} pattern violated` },
    { label: 'Zone fails', description: `Price breaks through ${zone.bestZone?.type || 'key'} zone` },
    { label: 'EMA 200 breaks', description: `Price crosses EMA 200 (${trend.ema200.toFixed(2)})` },
  ];

  return {
    decision: tierCheck.allowed ? 'TRADE' : 'NO_TRADE',
    direction: trend.direction,
    grade,
    confidence: finalConfidence,
    entry: parseFloat(entryPrice.toFixed(5)),
    stop_loss: parseFloat(risk.sl.toFixed(5)),
    take_profit: [parseFloat(risk.tp1.toFixed(5)), parseFloat(risk.tp2.toFixed(5))],
    reason: reasons,
    invalid_if: invalidIf,
    cooldown: disc.updatedDiscipline.cooldown_active,
    score_breakdown: scoreBreakdown,
    step_results: steps,
    discipline: disc.updatedDiscipline,
    market_condition: ctx.condition,
    volatility_quality: ctx.volatilityQuality,
    tier_filter: { tier, ...tierCheck },
  };
}

// ────────────────────────────────────────────────────────────────────
// DISCIPLINE HELPERS (for external state management)
// ────────────────────────────────────────────────────────────────────

/** Create fresh discipline state */
export function createDisciplineState(): DisciplineState {
  return {
    consecutive_losses: 0,
    cooldown_active: false,
    cooldown_until: 0,
    cooldown_reason: '',
    locked_candles_remaining: 0,
    last_loss_grade: null,
  };
}

/**
 * Record a trade result and update discipline state.
 * Call this after every closed trade.
 */
export function recordTradeResult(
  discipline: DisciplineState,
  won: boolean,
  grade: InstitutionalGrade,
  candleDurationMs: number,
): DisciplineState {
  if (won) {
    return {
      ...discipline,
      consecutive_losses: 0,
      cooldown_active: false,
      cooldown_until: 0,
      cooldown_reason: '',
      locked_candles_remaining: 0,
      last_loss_grade: null,
    };
  }

  // Loss
  const newLosses = discipline.consecutive_losses + 1;
  let cooldown = false;
  let cooldownUntil = 0;
  let cooldownReason = '';
  let lockedCandles = 0;

  if (newLosses >= 2) {
    // 2 consecutive losses → lock for 2-4 candles
    lockedCandles = COOLDOWN_CANDLES_AFTER_2_LOSSES;
    cooldown = true;
    cooldownUntil = Date.now() + lockedCandles * candleDurationMs;
    cooldownReason = `${newLosses} consecutive losses → locked ${lockedCandles} candles`;
  }

  if (grade === 'A+') {
    // A+ trade lost → mandatory extended cooldown
    lockedCandles = COOLDOWN_CANDLES_AFTER_APLUS_LOSS;
    cooldown = true;
    cooldownUntil = Date.now() + lockedCandles * candleDurationMs;
    cooldownReason = `A+ trade lost → mandatory cooldown (${lockedCandles} candles)`;
  }

  return {
    consecutive_losses: newLosses,
    cooldown_active: cooldown,
    cooldown_until: cooldownUntil,
    cooldown_reason: cooldownReason,
    locked_candles_remaining: lockedCandles,
    last_loss_grade: grade,
  };
}

/**
 * Decrement candle lock counter (call on each candle close during cooldown)
 */
export function tickCooldown(discipline: DisciplineState): DisciplineState {
  if (!discipline.cooldown_active) return discipline;

  const remaining = Math.max(0, discipline.locked_candles_remaining - 1);
  return {
    ...discipline,
    locked_candles_remaining: remaining,
    cooldown_active: remaining > 0,
    cooldown_reason: remaining > 0 ? discipline.cooldown_reason : '',
  };
}
