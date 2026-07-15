/**
 * UNIFIED SMART SIGNAL GENERATOR
 * 
 * 3-Layer Intelligence System:
 * - Layer 1: Technical Analysis (FREE, ~10ms)
 * - Layer 2: Sentiment Validation (KOL API, 2 credits)
 * - Layer 3: AI Context (Gemini, optional)
 * 
 * Menghasilkan signal yang sudah tervalidasi dengan confidence score.
 */

import {
  TechnicalSignal,
  PriceZone,
  ZoneStrengthScore,
  detectTrendContext,
  validateRiskReward,
  shouldRejectByRRR,
  scoreZoneStrength,
  isNearZone,
  findSwingLow,
  findSwingHigh,
  calculateATR,
  runValidationChecks,
  calculateValidationScore,
  determineQualityGrade,
  determineRecommendation,
  generateTechnicalReason,
  MIN_RRR,
  MIN_CONFIDENCE,
  MIN_TREND_STRENGTH,
  CONFIDENCE_WEIGHTS
} from './signalValidator';

import { CandleData } from './tradingRulesEngine';
import { getMarketSentiment, MarketSentiment } from './kolAPI';

// ==================== TYPES ====================

export interface UnifiedSignal extends TechnicalSignal {
  // Layer 2 additions
  sentiment?: MarketSentiment;
  sentiment_aligned: boolean;
  
  // Layer 3 additions (optional)
  ai_explanation?: string;
  
  // Final combined score
  final_confidence: number;
  layer_breakdown: {
    layer1_technical: number;
    layer2_sentiment: number;
    layer3_ai: number;
  };
}

export interface SignalGeneratorConfig {
  enableLayer2: boolean;      // Enable sentiment validation
  enableLayer3: boolean;      // Enable AI context (Gemini)
  minConfidence: number;      // Minimum confidence to generate signal
  minRRR: number;             // Minimum risk:reward ratio
  strictMode: boolean;        // Reject if ANY check fails
}

export const DEFAULT_CONFIG: SignalGeneratorConfig = {
  enableLayer2: true,
  enableLayer3: false,        // Off by default to save API credits
  minConfidence: MIN_CONFIDENCE,
  minRRR: MIN_RRR,
  strictMode: false
};

// ==================== LAYER 1: TECHNICAL ANALYSIS ====================

/**
 * Generate technical signal from candle data
 * This is the core analysis - FREE, runs in ~10ms
 */
export async function generateTechnicalSignal(
  candles: CandleData[],
  zones: PriceZone[],
  symbol: string,
  timeframe: string
): Promise<TechnicalSignal | null> {
  
  console.log(`[Layer 1] Generating technical signal for ${symbol} ${timeframe}...`);
  const startTime = Date.now();
  
  // STEP 1: Validate minimum data
  if (candles.length < 50) {
    console.log('[Layer 1] Not enough candles for analysis');
    return null;
  }
  
  // STEP 2: Get closes for EMA calculation
  const closes = candles.map(c => c.close);
  
  // STEP 3: Detect trend context
  const trend = detectTrendContext(closes);
  console.log(`[Layer 1] Trend: ${trend.primary} (Strength: ${trend.strength.toFixed(1)}%)`);
  
  // Check minimum trend strength
  if (trend.strength < MIN_TREND_STRENGTH && trend.primary !== 'SIDEWAYS') {
    console.log('[Layer 1] Trend strength too weak');
    // Don't reject, just note it
  }
  
  // STEP 4: Get current price and determine signal type
  const lastCandle = candles[candles.length - 1];
  const entry = lastCandle.close;
  
  // Determine signal type based on trend
  let signal_type: 'BUY' | 'SELL';
  if (trend.primary === 'BULLISH') {
    signal_type = 'BUY';
  } else if (trend.primary === 'BEARISH') {
    signal_type = 'SELL';
  } else {
    console.log('[Layer 1] Sideways trend - waiting for direction');
    return null;
  }
  
  // STEP 5: Calculate ATR for volatility
  const atr = calculateATR(candles, 14);
  console.log(`[Layer 1] ATR: ${atr.toFixed(5)}`);
  
  // STEP 6: Find stop loss using swing detection
  const swingLookback = 15;
  const swingLow = findSwingLow(candles, swingLookback);
  const swingHigh = findSwingHigh(candles, swingLookback);
  
  let stop_loss: number;
  let take_profit_1: number;
  let take_profit_2: number;
  
  if (signal_type === 'BUY') {
    // SL below swing low + buffer
    stop_loss = swingLow - (atr * 0.5);
    
    // TP using ATR multiples
    take_profit_1 = entry + (atr * 2);
    take_profit_2 = entry + (atr * 4);
  } else {
    // SL above swing high + buffer
    stop_loss = swingHigh + (atr * 0.5);
    
    // TP using ATR multiples
    take_profit_1 = entry - (atr * 2);
    take_profit_2 = entry - (atr * 4);
  }
  
  // STEP 7: VALIDATE RISK:REWARD (HARD RULE!)
  const rrr = validateRiskReward(entry, stop_loss, take_profit_1);
  const rrrCheck = shouldRejectByRRR(rrr);
  
  if (rrrCheck.reject) {
    console.log(`[Layer 1] REJECTED: ${rrrCheck.reason}`);
    return null;
  }
  
  console.log(`[Layer 1] RRR OK: 1:${rrr.ratio} (Risk: ${rrr.risk_pips.toFixed(1)}p, Reward: ${rrr.reward_pips.toFixed(1)}p)`);
  
  // STEP 8: Check zone proximity
  let nearestZone: PriceZone | null = null;
  let zoneScore: ZoneStrengthScore | null = null;
  
  for (const zone of zones) {
    // Match zone type with signal type
    const zoneMatchesSignal = 
      (signal_type === 'BUY' && zone.type === 'demand') ||
      (signal_type === 'SELL' && zone.type === 'supply');
    
    if (zoneMatchesSignal && isNearZone(entry, zone)) {
      const score = scoreZoneStrength(zone, entry, candles);
      
      if (!zoneScore || score.strength > zoneScore.strength) {
        zoneScore = score;
        nearestZone = zone;
      }
    }
  }
  
  if (zoneScore) {
    console.log(`[Layer 1] Zone found: ${nearestZone?.type} (strength: ${zoneScore.strength}%)`);
  } else {
    console.log('[Layer 1] No confirming zone nearby');
  }
  
  // STEP 9: Calculate confidence scores
  const trend_confidence = trend.strength;
  const zone_confidence = zoneScore ? zoneScore.strength : 30;  // Lower if no zone
  const riskReward_confidence = rrr.confidence_impact;
  
  // Technical confidence = weighted average
  const technical_confidence = Math.round(
    (trend_confidence * CONFIDENCE_WEIGHTS.trend) +
    (zone_confidence * CONFIDENCE_WEIGHTS.zone) +
    (riskReward_confidence * CONFIDENCE_WEIGHTS.riskReward)
  );
  
  // STEP 10: Run validation checks
  const validations = runValidationChecks(
    { signal_type },
    trend,
    rrr,
    zoneScore,
    atr,
    entry
  );
  
  const validation_score = calculateValidationScore(validations);
  
  // STEP 11: Determine quality and recommendation
  const quality_grade = determineQualityGrade(technical_confidence, validation_score);
  const recommendation = determineRecommendation(quality_grade, validations);
  
  // STEP 12: Generate reason
  const { summary, list } = generateTechnicalReason(
    signal_type,
    trend,
    rrr,
    zoneScore,
    validations
  );
  
  // STEP 13: Build signal object
  const signal: TechnicalSignal = {
    id: `${symbol}-${Date.now()}`,
    timestamp: Date.now(),
    symbol,
    timeframe,
    
    signal_type,
    entry: parseFloat(entry.toFixed(5)),
    stop_loss: parseFloat(stop_loss.toFixed(5)),
    take_profit_1: parseFloat(take_profit_1.toFixed(5)),
    take_profit_2: parseFloat(take_profit_2.toFixed(5)),
    
    trend_confidence,
    zone_confidence,
    riskReward_confidence,
    technical_confidence,
    
    validations,
    validation_score,
    
    technical_reason: summary,
    reasons_list: list,
    
    recommendation,
    quality_grade
  };
  
  const elapsed = Date.now() - startTime;
  console.log(`[Layer 1] ✅ Signal generated in ${elapsed}ms | ${signal_type} @ ${entry} | Confidence: ${technical_confidence}% | Grade: ${quality_grade}`);
  
  return signal;
}

// ==================== LAYER 2: SENTIMENT VALIDATION ====================

/**
 * Apply sentiment validation to technical signal
 * Uses KOL API (2 credits per call)
 */
export async function applySentimentValidation(
  signal: TechnicalSignal
): Promise<{ boostedSignal: TechnicalSignal; sentiment: MarketSentiment }> {
  
  console.log(`[Layer 2] Fetching sentiment for ${signal.symbol}...`);
  const startTime = Date.now();
  
  // Fetch sentiment from KOL API
  const sentiment = await getMarketSentiment(signal.symbol);
  
  console.log(`[Layer 2] Sentiment: ${sentiment.sentiment} (${sentiment.confidence}%), Fear/Greed: ${sentiment.fear_greed_index}`);
  
  // Calculate sentiment boost/penalty
  let sentiment_boost = 0;
  let market_validation: 'ALIGNED' | 'CONFLICTING' | 'NEUTRAL' = 'NEUTRAL';
  
  // Check alignment between signal and sentiment
  const signalBullish = signal.signal_type === 'BUY';
  const sentimentBullish = sentiment.sentiment === 'BULLISH';
  const sentimentBearish = sentiment.sentiment === 'BEARISH';
  
  if (signalBullish && sentimentBullish) {
    // BUY signal + BULLISH sentiment = ALIGNED
    market_validation = 'ALIGNED';
    sentiment_boost = Math.min(15, sentiment.confidence * 0.15);  // Up to +15%
    console.log(`[Layer 2] ✅ ALIGNED: Bullish signal matches bullish sentiment (+${sentiment_boost.toFixed(1)}%)`);
  } 
  else if (!signalBullish && sentimentBearish) {
    // SELL signal + BEARISH sentiment = ALIGNED
    market_validation = 'ALIGNED';
    sentiment_boost = Math.min(15, sentiment.confidence * 0.15);
    console.log(`[Layer 2] ✅ ALIGNED: Bearish signal matches bearish sentiment (+${sentiment_boost.toFixed(1)}%)`);
  }
  else if ((signalBullish && sentimentBearish) || (!signalBullish && sentimentBullish)) {
    // Signal conflicts with sentiment
    market_validation = 'CONFLICTING';
    sentiment_boost = -Math.min(10, sentiment.confidence * 0.10);  // Up to -10%
    console.log(`[Layer 2] ⚠️ CONFLICTING: Signal berlawanan dengan sentiment (${sentiment_boost.toFixed(1)}%)`);
  }
  else {
    // Neutral sentiment
    market_validation = 'NEUTRAL';
    sentiment_boost = 0;
    console.log(`[Layer 2] 📊 NEUTRAL: Sentiment tidak mempengaruhi signal`);
  }
  
  // Apply Fear & Greed modifier
  const fearGreed = sentiment.fear_greed_index || 50;
  
  if (fearGreed <= 20) {
    // Extreme Fear - be cautious with SELL, opportunity for BUY
    if (signalBullish) {
      sentiment_boost += 5;  // Potential bottom
      console.log(`[Layer 2] 😰 Extreme Fear + BUY = Potential reversal opportunity (+5%)`);
    } else {
      sentiment_boost -= 5;  // Risky to sell at extreme fear
      console.log(`[Layer 2] 😰 Extreme Fear + SELL = Risky (-5%)`);
    }
  } 
  else if (fearGreed >= 80) {
    // Extreme Greed - be cautious with BUY, opportunity for SELL
    if (!signalBullish) {
      sentiment_boost += 5;  // Potential top
      console.log(`[Layer 2] 🤑 Extreme Greed + SELL = Potential reversal opportunity (+5%)`);
    } else {
      sentiment_boost -= 5;  // Risky to buy at extreme greed
      console.log(`[Layer 2] 🤑 Extreme Greed + BUY = Risky (-5%)`);
    }
  }
  
  // Apply whale activity modifier
  if (sentiment.whale_activity) {
    const whalesBuying = sentiment.whale_activity === 'BUYING';
    const whalesSelling = sentiment.whale_activity === 'SELLING';
    
    if ((signalBullish && whalesBuying) || (!signalBullish && whalesSelling)) {
      sentiment_boost += 3;
      console.log(`[Layer 2] 🐋 Whale activity supports signal (+3%)`);
    } else if ((signalBullish && whalesSelling) || (!signalBullish && whalesBuying)) {
      sentiment_boost -= 3;
      console.log(`[Layer 2] 🐋 Whale activity conflicts with signal (-3%)`);
    }
  }
  
  // Clamp boost between -15 and +15
  sentiment_boost = Math.max(-15, Math.min(15, sentiment_boost));
  
  // Apply boost to signal
  const boostedConfidence = Math.max(0, Math.min(100, signal.technical_confidence + sentiment_boost));
  
  // Update recommendation if sentiment significantly changes things
  let newRecommendation = signal.recommendation;
  let newGrade = signal.quality_grade;
  
  if (market_validation === 'CONFLICTING' && signal.recommendation === 'EXECUTE') {
    newRecommendation = 'WAIT';  // Downgrade if conflicting
    console.log(`[Layer 2] ⚠️ Recommendation downgraded to WAIT due to conflicting sentiment`);
  } else if (market_validation === 'ALIGNED' && signal.recommendation === 'WAIT' && boostedConfidence >= 65) {
    newRecommendation = 'EXECUTE';  // Upgrade if aligned and confidence improved
    console.log(`[Layer 2] ✅ Recommendation upgraded to EXECUTE due to aligned sentiment`);
  }
  
  // Recalculate grade with new confidence
  const combinedScore = (boostedConfidence + signal.validation_score) / 2;
  if (combinedScore >= 85) newGrade = 'A';
  else if (combinedScore >= 70) newGrade = 'B';
  else if (combinedScore >= 55) newGrade = 'C';
  else if (combinedScore >= 40) newGrade = 'D';
  else newGrade = 'F';
  
  const boostedSignal: TechnicalSignal = {
    ...signal,
    sentiment_boost,
    market_validation,
    technical_confidence: boostedConfidence,
    quality_grade: newGrade,
    recommendation: newRecommendation,
    reasons_list: [
      ...signal.reasons_list,
      `📊 Sentiment: ${sentiment.sentiment} (${sentiment.confidence}%), Fear/Greed: ${fearGreed}`,
      `${market_validation === 'ALIGNED' ? '✅' : market_validation === 'CONFLICTING' ? '⚠️' : '📊'} Market validation: ${market_validation} (${sentiment_boost >= 0 ? '+' : ''}${sentiment_boost.toFixed(1)}%)`
    ]
  };
  
  const elapsed = Date.now() - startTime;
  console.log(`[Layer 2] ✅ Sentiment applied in ${elapsed}ms | Boost: ${sentiment_boost >= 0 ? '+' : ''}${sentiment_boost.toFixed(1)}% | New confidence: ${boostedConfidence}%`);
  
  return { boostedSignal, sentiment };
}

// ==================== LAYER 3: AI CONTEXT (OPTIONAL) ====================

/**
 * Generate AI explanation for the signal
 * Uses Gemini API (optional, costs credits)
 */
export async function generateAIContext(
  signal: TechnicalSignal,
  sentiment?: MarketSentiment
): Promise<string> {
  
  console.log(`[Layer 3] Generating AI explanation...`);
  
  // Build context for AI (used for future Gemini integration)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _context = `
Signal: ${signal.signal_type} ${signal.symbol}
Entry: ${signal.entry}
Stop Loss: ${signal.stop_loss}
Take Profit 1: ${signal.take_profit_1}
Take Profit 2: ${signal.take_profit_2}
RRR: 1:${((Math.abs(signal.take_profit_1 - signal.entry)) / Math.abs(signal.entry - signal.stop_loss)).toFixed(2)}

Technical Analysis:
- Trend Confidence: ${signal.trend_confidence}%
- Zone Confidence: ${signal.zone_confidence}%
- RRR Confidence: ${signal.riskReward_confidence}%
- Overall Technical: ${signal.technical_confidence}%

Validations:
- Trend Alignment: ${signal.validations.trend_alignment ? 'Yes' : 'No'}
- EMA Order Valid: ${signal.validations.ema_order_valid ? 'Yes' : 'No'}
- Zone Proximity: ${signal.validations.zone_proximity ? 'Yes' : 'No'}
- RRR Valid: ${signal.validations.risk_reward_valid ? 'Yes' : 'No'}

${sentiment ? `
Market Sentiment:
- Sentiment: ${sentiment.sentiment} (${sentiment.confidence}%)
- Fear & Greed: ${sentiment.fear_greed_index}
- Whale Activity: ${sentiment.whale_activity}
- Volume Trend: ${sentiment.volume_trend}
` : ''}

Quality: Grade ${signal.quality_grade}
Recommendation: ${signal.recommendation}
`;

  // For now, return a formatted explanation without calling Gemini
  // This can be replaced with actual Gemini API call when needed
  const explanation = `
📊 **Analisis Signal ${signal.signal_type} ${signal.symbol}**

**Mengapa signal ini ${signal.recommendation === 'EXECUTE' ? 'layak dieksekusi' : signal.recommendation === 'WAIT' ? 'perlu ditunggu' : 'harus di-skip'}:**

1. **Trend Analysis (${signal.trend_confidence}%)**
   ${signal.validations.trend_alignment 
     ? `✅ Trend ${signal.signal_type === 'BUY' ? 'BULLISH' : 'BEARISH'} ter-align dengan EMA order yang benar.`
     : `⚠️ Trend tidak sepenuhnya mendukung signal ini.`}

2. **Zone Strength (${signal.zone_confidence}%)**
   ${signal.validations.zone_proximity
     ? `✅ Price berada di dekat ${signal.signal_type === 'BUY' ? 'demand' : 'supply'} zone yang kuat.`
     : `⚠️ Tidak ada konfirmasi zone. Signal masih valid tapi less reliable.`}

3. **Risk:Reward (${signal.riskReward_confidence}%)**
   ${signal.validations.risk_reward_valid
     ? `✅ RRR >= 2.0 - Potensi profit 2x lipat dari risk.`
     : `❌ RRR < 2.0 - Risiko terlalu tinggi.`}

${sentiment ? `
4. **Market Sentiment**
   ${signal.market_validation === 'ALIGNED' 
     ? `✅ Sentiment ${sentiment.sentiment} mendukung signal ${signal.signal_type}.`
     : signal.market_validation === 'CONFLICTING'
     ? `⚠️ Sentiment ${sentiment.sentiment} berlawanan dengan signal. Hati-hati!`
     : `📊 Sentiment neutral, tidak mempengaruhi keputusan.`}
   Fear/Greed Index: ${sentiment.fear_greed_index}
` : ''}

**Kesimpulan:**
Grade ${signal.quality_grade} dengan confidence ${signal.technical_confidence}%.
${signal.recommendation === 'EXECUTE' 
  ? '✅ EXECUTE - Setup ini memenuhi kriteria trading yang baik.'
  : signal.recommendation === 'WAIT'
  ? '⏳ WAIT - Tunggu konfirmasi tambahan sebelum entry.'
  : '❌ SKIP - Setup ini tidak memenuhi kriteria minimum.'}
`.trim();

  console.log(`[Layer 3] ✅ AI explanation generated`);
  
  return explanation;
}

// ==================== MAIN: UNIFIED SIGNAL GENERATOR ====================

/**
 * Generate unified smart signal with all 3 layers
 * 
 * @param candles - Historical candle data
 * @param zones - Supply/Demand zones
 * @param symbol - Trading symbol (e.g., BTCUSDT)
 * @param timeframe - Chart timeframe (e.g., 1h, 4h)
 * @param config - Generator configuration
 */
export async function generateUnifiedSignal(
  candles: CandleData[],
  zones: PriceZone[],
  symbol: string,
  timeframe: string,
  config: SignalGeneratorConfig = DEFAULT_CONFIG
): Promise<UnifiedSignal | null> {
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🎯 UNIFIED SIGNAL GENERATOR - ${symbol} ${timeframe}`);
  console.log(`${'='.repeat(60)}`);
  
  const startTime = Date.now();
  
  // ===== LAYER 1: TECHNICAL ANALYSIS =====
  const technicalSignal = await generateTechnicalSignal(candles, zones, symbol, timeframe);
  
  if (!technicalSignal) {
    console.log(`[Unified] ❌ No valid technical signal generated`);
    return null;
  }
  
  // Check minimum confidence
  if (technicalSignal.technical_confidence < config.minConfidence) {
    console.log(`[Unified] ❌ Confidence ${technicalSignal.technical_confidence}% < minimum ${config.minConfidence}%`);
    return null;
  }
  
  let currentSignal = technicalSignal;
  let sentiment: MarketSentiment | undefined;
  
  // ===== LAYER 2: SENTIMENT VALIDATION =====
  if (config.enableLayer2) {
    const { boostedSignal, sentiment: fetchedSentiment } = await applySentimentValidation(currentSignal);
    currentSignal = boostedSignal;
    sentiment = fetchedSentiment;
  }
  
  // ===== LAYER 3: AI CONTEXT (OPTIONAL) =====
  let ai_explanation: string | undefined;
  
  if (config.enableLayer3) {
    ai_explanation = await generateAIContext(currentSignal, sentiment);
  }
  
  // ===== BUILD UNIFIED SIGNAL =====
  const unifiedSignal: UnifiedSignal = {
    ...currentSignal,
    sentiment,
    sentiment_aligned: currentSignal.market_validation === 'ALIGNED',
    ai_explanation,
    final_confidence: currentSignal.technical_confidence,
    layer_breakdown: {
      layer1_technical: technicalSignal.technical_confidence,
      layer2_sentiment: currentSignal.sentiment_boost || 0,
      layer3_ai: ai_explanation ? 100 : 0  // 100 if generated, 0 if not
    },
    gemini_context: ai_explanation
  };
  
  const elapsed = Date.now() - startTime;
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`✅ UNIFIED SIGNAL COMPLETE`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Signal: ${unifiedSignal.signal_type} @ ${unifiedSignal.entry}`);
  console.log(`Confidence: ${unifiedSignal.final_confidence}% (Grade ${unifiedSignal.quality_grade})`);
  console.log(`Recommendation: ${unifiedSignal.recommendation}`);
  console.log(`Layers: L1=${unifiedSignal.layer_breakdown.layer1_technical}% | L2=${unifiedSignal.layer_breakdown.layer2_sentiment >= 0 ? '+' : ''}${unifiedSignal.layer_breakdown.layer2_sentiment}% | L3=${config.enableLayer3 ? 'ON' : 'OFF'}`);
  console.log(`Total time: ${elapsed}ms`);
  console.log(`${'='.repeat(60)}\n`);
  
  return unifiedSignal;
}

// ==================== INSTITUTIONAL ENGINE INTEGRATION ====================

import {
  runInstitutionalEngine,
  createDisciplineState,
  recordTradeResult,
  tickCooldown,
  InstitutionalInput,
  InstitutionalOutput,
  InstitutionalZone,
  DisciplineState,
  AIValidationResult,
  InstitutionalGrade,
  MonetisationTier,
  NewsEvent,
  SentimentData,
  ScoreBreakdown,
} from './institutionalEngine';

// Re-export institutional types for consumers
export type {
  InstitutionalOutput,
  InstitutionalGrade,
  InstitutionalZone,
  DisciplineState,
  AIValidationResult,
  MonetisationTier,
  NewsEvent,
  SentimentData,
  ScoreBreakdown,
};
export { createDisciplineState, recordTradeResult, tickCooldown };

/**
 * Configuration for the institutional signal generator
 */
export interface InstitutionalSignalConfig {
  tier: MonetisationTier;
  enableAIValidation: boolean;
  enableSentiment: boolean;
}

export const DEFAULT_INSTITUTIONAL_CONFIG: InstitutionalSignalConfig = {
  tier: 'PRO',
  enableAIValidation: false,
  enableSentiment: true,
};

/**
 * Convert PriceZone[] (from signalValidator) to InstitutionalZone[]
 */
function toInstitutionalZones(zones: PriceZone[]): InstitutionalZone[] {
  return zones.map(z => ({
    type: z.type,
    high: z.high,
    low: z.low,
    strength: z.strength,
    status: z.status,
    origin_impulse: z.strength >= 70,   // high strength ≈ impulse origin
    test_count: z.status === 'fresh' ? 0 : z.status === 'tested' ? 1 : 3,
  }));
}

/**
 * INSTITUTIONAL SIGNAL GENERATOR
 *
 * Runs the full 11-step institutional pipeline:
 *  1. Market Context Filter (choppy → NO TRADE)
 *  2. Trend Bias (EMA 200)
 *  3. Market Structure (HH/HL or LH/LL)
 *  4. Zone Quality (fresh, strong imbalance, impulse origin)
 *  5. Entry Confirmation (candle pattern at key level only)
 *  6. Risk Management (RRR ≥ 2, structure SL, ≤1% risk)
 *  7. News & Sentiment filter
 *  8. Objective Scoring (0-100)
 *  9. Grading (A+ ≥ 90, A 80-89, B 70-79, <70 → NO TRADE)
 * 10. Discipline & Anti-Revenge (cooldown after losses)
 * 11. Hybrid AI Validation (for A/B only)
 *
 * @param candles  Historical candle data (≥200 required)
 * @param zones    Supply/Demand zones
 * @param symbol   Trading symbol
 * @param timeframe Chart timeframe
 * @param discipline Current discipline state
 * @param config   Institutional config (tier, AI, sentiment)
 * @param news     Upcoming news events
 * @param aiResult Optional AI validation result
 */
export async function generateInstitutionalSignal(
  candles: CandleData[],
  zones: PriceZone[],
  symbol: string,
  timeframe: string,
  discipline: DisciplineState,
  config: InstitutionalSignalConfig = DEFAULT_INSTITUTIONAL_CONFIG,
  news: NewsEvent[] = [],
  aiResult: AIValidationResult | null = null,
): Promise<InstitutionalOutput> {

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🏦 INSTITUTIONAL ENGINE — ${symbol} ${timeframe}`);
  console.log(`${'═'.repeat(60)}`);
  const startTime = Date.now();

  // Build sentiment data from KOL API if enabled
  let sentimentData: SentimentData | undefined;
  if (config.enableSentiment) {
    try {
      const kolSentiment = await getMarketSentiment(symbol);
      sentimentData = {
        bias: kolSentiment.sentiment === 'BULLISH' ? 'bullish'
            : kolSentiment.sentiment === 'BEARISH' ? 'bearish'
            : 'neutral',
        strength: kolSentiment.confidence,
        source: 'KOL API',
      };
    } catch {
      console.log('[Institutional] Sentiment fetch failed, proceeding without');
    }
  }

  // Build input
  const input: InstitutionalInput = {
    symbol,
    timeframe,
    candles,
    zones: toInstitutionalZones(zones),
    news,
    sentiment: sentimentData,
    discipline,
    tier: config.tier,
  };

  // Run the engine
  const output = runInstitutionalEngine(input, aiResult);

  const elapsed = Date.now() - startTime;

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🏦 INSTITUTIONAL RESULT`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`Decision: ${output.decision} | Direction: ${output.direction}`);
  console.log(`Grade: ${output.grade} | Confidence: ${output.confidence}%`);
  console.log(`Score: ${output.score_breakdown.total}/100`);
  console.log(`  Trend: ${output.score_breakdown.trend_clarity}/25`);
  console.log(`  Structure: ${output.score_breakdown.structure_validity}/20`);
  console.log(`  Zone: ${output.score_breakdown.zone_quality}/20`);
  console.log(`  Entry: ${output.score_breakdown.entry_candle}/15`);
  console.log(`  Sentiment: ${output.score_breakdown.sentiment_alignment}/10`);
  console.log(`  RRR Bonus: ${output.score_breakdown.rrr_bonus}/10`);
  if (output.decision === 'TRADE') {
    console.log(`Entry: ${output.entry} | SL: ${output.stop_loss} | TP: ${output.take_profit.join(', ')}`);
  }
  console.log(`Tier: ${output.tier_filter.tier} → ${output.tier_filter.allowed ? 'ALLOWED' : 'BLOCKED'}`);
  console.log(`Cooldown: ${output.cooldown ? 'ACTIVE' : 'clear'}`);
  console.log(`Time: ${elapsed}ms`);
  console.log(`${'═'.repeat(60)}\n`);

  return output;
}

// ==================== EXPORTS ====================

export type {
  TechnicalSignal,
  TrendContext,
  RiskRewardMetrics,
  ZoneStrengthScore,
  PriceZone,
  SignalValidation,
} from './signalValidator';

export {
  detectTrendContext,
  validateRiskReward,
  calculateATR,
  calculateEMA
} from './signalValidator';

