/**
 * PROBABILITY-BASED TRADING ENGINE — Main Orchestrator
 * =====================================================
 * 
 * 7-Phase sequential pipeline. Each phase is a hard gate.
 * If ANY phase fails → WAIT. No exceptions.
 * 
 * Phase 1: Market Regime & Structure
 * Phase 2: Multi-Timeframe Alignment
 * Phase 3: High Probability Setup Logic
 * Phase 4: Indicator Validation
 * Phase 5: Risk & Money Management
 * Phase 6: Confidence Scoring
 * Phase 7: Discipline & Protection
 * 
 * Prinsip: Sistem bertindak sebagai risk manager, bukan gambler.
 */

import {
  CandleData,
  EngineInput,
  EngineOutput,
  MarketRegime,
  RegimeAnalysis,
  StructureAnalysis,
  TrendDirection,
  TimeframeAnalysis,
  MTFAlignment,
  SetupType,
  SetupDetection,
  IndicatorValidation,
  IndicatorValues,
  RiskCalculation,
  ConfidenceBreakdown,
  DisciplineState,
  DisciplineCheck,
  PhaseResult,
  SignalDecision,
  DEFAULT_MTF_MAP,
} from './types';

import {
  computeIndicators,
  detectSwingPoints,
  detectKeyLevels,
  hasBullishRejection,
  hasBearishRejection,
  SRLevel,
} from './indicators';

// ═══════════════════════════════════════════════════════════
// PHASE 1: MARKET REGIME & STRUCTURE
// ═══════════════════════════════════════════════════════════

function analyzeRegime(candles: CandleData[], indicators: IndicatorValues): RegimeAnalysis {
  const currentPrice = candles[candles.length - 1].close;
  const { adx, atr, atrSma } = indicators;
  const atrPercent = (atr / currentPrice) * 100;
  const atrExpanding = atr > atrSma * 1.1;

  // Detect structure via swing points
  const swings = detectSwingPoints(candles, 5);
  const recentSwings = swings.slice(-6);

  const highs = recentSwings.filter(s => s.type === 'HH' || s.type === 'LH');
  const lows = recentSwings.filter(s => s.type === 'HL' || s.type === 'LL');
  const hhCount = highs.filter(s => s.type === 'HH').length;
  const hlCount = lows.filter(s => s.type === 'HL').length;
  const lhCount = highs.filter(s => s.type === 'LH').length;
  const llCount = lows.filter(s => s.type === 'LL').length;

  const structure: 'HH_HL' | 'LH_LL' | 'MIXED' | 'FLAT' =
    hhCount >= 2 && hlCount >= 1 ? 'HH_HL' :
    lhCount >= 2 && llCount >= 1 ? 'LH_LL' :
    recentSwings.length < 3 ? 'FLAT' : 'MIXED';

  // Determine regime
  let regime: MarketRegime;
  let confidence = 0;
  let description = '';

  // High volatility expansion
  if (atrExpanding && atrPercent > 1.5 && adx > 30) {
    regime = 'HIGH_VOLATILITY_EXPANSION';
    confidence = 70;
    description = `ATR expanding (${atrPercent.toFixed(2)}%), ADX ${adx.toFixed(1)} — aggressive expansion`;
  }
  // Low volatility compression
  else if (!atrExpanding && atrPercent < 0.3 && adx < 15) {
    regime = 'LOW_VOLATILITY_COMPRESSION';
    confidence = 65;
    description = `ATR compressed (${atrPercent.toFixed(2)}%), ADX ${adx.toFixed(1)} — squeeze forming`;
  }
  // Clear bullish trend
  else if (structure === 'HH_HL' && adx > 20 && currentPrice > indicators.ema200) {
    regime = 'TRENDING_BULLISH';
    confidence = Math.min(90, 60 + adx);
    description = `HH/HL structure, ADX ${adx.toFixed(1)}, price above EMA200`;
  }
  // Clear bearish trend
  else if (structure === 'LH_LL' && adx > 20 && currentPrice < indicators.ema200) {
    regime = 'TRENDING_BEARISH';
    confidence = Math.min(90, 60 + adx);
    description = `LH/LL structure, ADX ${adx.toFixed(1)}, price below EMA200`;
  }
  // Ranging
  else if (adx < 25 && (structure === 'MIXED' || structure === 'FLAT')) {
    regime = 'RANGING';
    confidence = 55;
    description = `ADX ${adx.toFixed(1)} (weak), mixed swing structure — range-bound`;
  }
  // Unclear
  else {
    regime = 'UNCLEAR';
    confidence = 30;
    description = `Mixed signals: structure=${structure}, ADX=${adx.toFixed(1)}, ATR%=${atrPercent.toFixed(2)}`;
  }

  return { regime, confidence, adx, atr, atrPercent, atrExpanding, structure, description };
}

function analyzeStructure(candles: CandleData[]): StructureAnalysis {
  const swings = detectSwingPoints(candles, 5);
  const recentSwings = swings.slice(-8);

  const lastHigh = [...recentSwings].reverse().find(s => s.type === 'HH' || s.type === 'LH');
  const lastLow = [...recentSwings].reverse().find(s => s.type === 'HL' || s.type === 'LL');

  // Classify trend
  const hhCount = recentSwings.filter(s => s.type === 'HH').length;
  const hlCount = recentSwings.filter(s => s.type === 'HL').length;
  const lhCount = recentSwings.filter(s => s.type === 'LH').length;
  const llCount = recentSwings.filter(s => s.type === 'LL').length;

  let trend: TrendDirection;
  let structureIntact = false;
  let description: string;

  if (hhCount >= 2 && hlCount >= 1) {
    trend = 'BULLISH';
    structureIntact = !recentSwings.some(
      (s, i) => i > 0 && s.type === 'LL' && recentSwings[i - 1]?.type === 'LH'
    );
    description = `Bullish structure: ${hhCount} HH, ${hlCount} HL${structureIntact ? ' (intact)' : ' (broken)'}`;
  } else if (lhCount >= 2 && llCount >= 1) {
    trend = 'BEARISH';
    structureIntact = !recentSwings.some(
      (s, i) => i > 0 && s.type === 'HH' && recentSwings[i - 1]?.type === 'HL'
    );
    description = `Bearish structure: ${lhCount} LH, ${llCount} LL${structureIntact ? ' (intact)' : ' (broken)'}`;
  } else {
    trend = 'SIDEWAYS';
    structureIntact = false;
    description = `No clear structure: ${hhCount}HH ${hlCount}HL ${lhCount}LH ${llCount}LL`;
  }

  return {
    trend,
    swingPoints: recentSwings,
    lastSwingHigh: lastHigh?.price || candles[candles.length - 1].high,
    lastSwingLow: lastLow?.price || candles[candles.length - 1].low,
    structureIntact,
    description,
  };
}

function runPhase1(candles: CandleData[], indicators: IndicatorValues): {
  passed: boolean;
  regime: RegimeAnalysis;
  structure: StructureAnalysis;
  reason: string;
} {
  const regime = analyzeRegime(candles, indicators);
  const structure = analyzeStructure(candles);

  // FAIL if regime unclear
  if (regime.regime === 'UNCLEAR') {
    return { passed: false, regime, structure, reason: `Regime tidak jelas: ${regime.description}` };
  }

  // FAIL if high-vol expansion (too risky)
  if (regime.regime === 'HIGH_VOLATILITY_EXPANSION') {
    return { passed: false, regime, structure, reason: `Volatilitas terlalu tinggi: ${regime.description}` };
  }

  // FAIL if low-vol compression without clear structure
  if (regime.regime === 'LOW_VOLATILITY_COMPRESSION' && structure.trend === 'SIDEWAYS') {
    return { passed: false, regime, structure, reason: `Kompresi volatilitas tanpa struktur: WAIT` };
  }

  return { passed: true, regime, structure, reason: `${regime.regime}: ${regime.description}` };
}

// ═══════════════════════════════════════════════════════════
// PHASE 2: MULTI-TIMEFRAME ALIGNMENT
// ═══════════════════════════════════════════════════════════

function analyzeTimeframe(
  candles: CandleData[],
  layer: 'HTF' | 'MTF' | 'LTF',
  timeframe: string
): TimeframeAnalysis {
  const indicators = computeIndicators(candles);
  const structure = analyzeStructure(candles);
  const regime = analyzeRegime(candles, indicators);

  return {
    layer,
    timeframe,
    trend: structure.trend,
    regime: regime.regime,
    ema50: indicators.ema50,
    ema200: indicators.ema200,
    adx: indicators.adx,
    rsi: indicators.rsi,
    atr: indicators.atr,
    structure,
  };
}

function runPhase2(
  ltfCandles: CandleData[],
  mtfCandles: CandleData[] | undefined,
  htfCandles: CandleData[] | undefined,
  timeframe: string
): { passed: boolean; alignment: MTFAlignment | null; reason: string } {

  const config = DEFAULT_MTF_MAP[timeframe] || DEFAULT_MTF_MAP['15m'];

  const ltf = analyzeTimeframe(ltfCandles, 'LTF', config.ltf);

  // If no MTF/HTF data, use LTF data with higher lookback
  const mtf = mtfCandles && mtfCandles.length >= 50
    ? analyzeTimeframe(mtfCandles, 'MTF', config.mtf)
    : null;

  const htf = htfCandles && htfCandles.length >= 50
    ? analyzeTimeframe(htfCandles, 'HTF', config.htf)
    : null;

  // If we don't have multi-TF data, derive from LTF only
  if (!mtf || !htf) {
    // Still check LTF structure is clear
    if (ltf.trend === 'SIDEWAYS') {
      return {
        passed: false,
        alignment: null,
        reason: 'LTF trend sideways, tidak ada data MTF/HTF untuk konfirmasi',
      };
    }

    // Use LTF structure as proxy (lower confidence)
    const proxyAlignment: MTFAlignment = {
      aligned: true,
      htf: htf || { ...ltf, layer: 'HTF', timeframe: config.htf },
      mtf: mtf || { ...ltf, layer: 'MTF', timeframe: config.mtf },
      ltf,
      direction: ltf.trend,
      reason: `Single-TF mode: ${ltf.trend} (data MTF/HTF tidak tersedia)`,
    };

    return { passed: true, alignment: proxyAlignment, reason: proxyAlignment.reason };
  }

  // Check alignment
  const htfTrend = htf.trend;
  const mtfTrend = mtf.trend;
  const ltfTrend = ltf.trend;

  // All three must agree or at least not conflict
  const allBullish = htfTrend === 'BULLISH' && mtfTrend === 'BULLISH' && ltfTrend === 'BULLISH';
  const allBearish = htfTrend === 'BEARISH' && mtfTrend === 'BEARISH' && ltfTrend === 'BEARISH';

  // HTF+MTF agree, LTF pulling back (valid for entry)
  const htfMtfBullish = htfTrend === 'BULLISH' && mtfTrend === 'BULLISH';
  const htfMtfBearish = htfTrend === 'BEARISH' && mtfTrend === 'BEARISH';

  let aligned = false;
  let direction: TrendDirection = 'SIDEWAYS';
  let reason = '';

  if (allBullish) {
    aligned = true;
    direction = 'BULLISH';
    reason = 'Semua timeframe selaras BULLISH';
  } else if (allBearish) {
    aligned = true;
    direction = 'BEARISH';
    reason = 'Semua timeframe selaras BEARISH';
  } else if (htfMtfBullish && ltfTrend !== 'BEARISH') {
    aligned = true;
    direction = 'BULLISH';
    reason = `HTF+MTF BULLISH, LTF ${ltfTrend} (pullback opportunity)`;
  } else if (htfMtfBearish && ltfTrend !== 'BULLISH') {
    aligned = true;
    direction = 'BEARISH';
    reason = `HTF+MTF BEARISH, LTF ${ltfTrend} (pullback opportunity)`;
  } else {
    aligned = false;
    direction = 'SIDEWAYS';
    reason = `Konflik: HTF=${htfTrend}, MTF=${mtfTrend}, LTF=${ltfTrend}`;
  }

  const alignment: MTFAlignment = {
    aligned,
    htf,
    mtf,
    ltf,
    direction,
    reason,
  };

  return {
    passed: aligned,
    alignment,
    reason,
  };
}

// ═══════════════════════════════════════════════════════════
// PHASE 3: HIGH PROBABILITY SETUP LOGIC
// ═══════════════════════════════════════════════════════════

function runPhase3(
  candles: CandleData[],
  regime: RegimeAnalysis,
  structure: StructureAnalysis,
  indicators: IndicatorValues,
  keyLevels: SRLevel[],
  direction: TrendDirection
): { passed: boolean; setup: SetupDetection; reason: string } {

  const currentPrice = candles[candles.length - 1].close;
  const { ema50 } = indicators;
  const nearThreshold = indicators.atr * 1.5;

  // Find nearest support and resistance
  const supports = keyLevels.filter(l => l.type === 'support' && l.price < currentPrice);
  const resistances = keyLevels.filter(l => l.type === 'resistance' && l.price > currentPrice);
  const nearestSupport = supports.length > 0 ? supports.reduce((a, b) => a.price > b.price ? a : b) : null;
  const nearestResistance = resistances.length > 0 ? resistances.reduce((a, b) => a.price < b.price ? a : b) : null;

  const noSetup: SetupDetection = {
    valid: false,
    type: 'NONE',
    regime: regime.regime.startsWith('TRENDING') ? 'TRENDING' : 'RANGING',
    entryPrice: currentPrice,
    reason: 'Tidak ada setup valid',
  };

  // === TRENDING MARKET SETUPS ===
  if (regime.regime === 'TRENDING_BULLISH' || regime.regime === 'TRENDING_BEARISH') {
    const isBullish = direction === 'BULLISH';

    // Setup 1: Pullback to EMA50 in strong trend
    const distToEMA50 = Math.abs(currentPrice - ema50);
    const nearEMA50 = distToEMA50 < nearThreshold;

    if (nearEMA50) {
      if (isBullish && currentPrice >= ema50 * 0.995 && currentPrice <= ema50 * 1.01) {
        if (hasBullishRejection(candles)) {
          return {
            passed: true,
            setup: {
              valid: true,
              type: 'PULLBACK_EMA50',
              regime: 'TRENDING',
              entryPrice: currentPrice,
              reason: `Pullback ke EMA50 (${ema50.toFixed(2)}) + bullish rejection dalam trend bullish`,
            },
            reason: 'Pullback EMA50 + rejection',
          };
        }
      }
      if (!isBullish && currentPrice <= ema50 * 1.005 && currentPrice >= ema50 * 0.99) {
        if (hasBearishRejection(candles)) {
          return {
            passed: true,
            setup: {
              valid: true,
              type: 'PULLBACK_EMA50',
              regime: 'TRENDING',
              entryPrice: currentPrice,
              reason: `Pullback ke EMA50 (${ema50.toFixed(2)}) + bearish rejection dalam trend bearish`,
            },
            reason: 'Pullback EMA50 + rejection',
          };
        }
      }
    }

    // Setup 2: Breakout + Retest of key level
    if (isBullish && nearestResistance) {
      // Price just broke above resistance and retesting
      const brokeAbove = currentPrice > nearestResistance.price;
      const retesting = currentPrice < nearestResistance.price * 1.005 && 
                        currentPrice > nearestResistance.price * 0.995;
      if (brokeAbove || retesting) {
        if (hasBullishRejection(candles)) {
          return {
            passed: true,
            setup: {
              valid: true,
              type: 'BREAKOUT_RETEST',
              regime: 'TRENDING',
              entryPrice: currentPrice,
              reason: `Breakout + retest resistance (${nearestResistance.price.toFixed(2)})`,
            },
            reason: 'Breakout + retest',
          };
        }
      }
    }
    if (!isBullish && nearestSupport) {
      const brokeBelow = currentPrice < nearestSupport.price;
      const retesting = currentPrice > nearestSupport.price * 0.995 &&
                        currentPrice < nearestSupport.price * 1.005;
      if (brokeBelow || retesting) {
        if (hasBearishRejection(candles)) {
          return {
            passed: true,
            setup: {
              valid: true,
              type: 'BREAKOUT_RETEST',
              regime: 'TRENDING',
              entryPrice: currentPrice,
              reason: `Breakout + retest support (${nearestSupport.price.toFixed(2)})`,
            },
            reason: 'Breakout + retest',
          };
        }
      }
    }

    // Setup 3: Rejection at significant S/R
    if (isBullish && nearestSupport && Math.abs(currentPrice - nearestSupport.price) < nearThreshold) {
      if (hasBullishRejection(candles) && nearestSupport.strength >= 50) {
        return {
          passed: true,
          setup: {
            valid: true,
            type: 'SR_REJECTION',
            regime: 'TRENDING',
            entryPrice: currentPrice,
            reason: `Rejection di support signifikan (${nearestSupport.price.toFixed(2)}, strength: ${nearestSupport.strength})`,
          },
          reason: 'S/R rejection',
        };
      }
    }
    if (!isBullish && nearestResistance && Math.abs(currentPrice - nearestResistance.price) < nearThreshold) {
      if (hasBearishRejection(candles) && nearestResistance.strength >= 50) {
        return {
          passed: true,
          setup: {
            valid: true,
            type: 'SR_REJECTION',
            regime: 'TRENDING',
            entryPrice: currentPrice,
            reason: `Rejection di resistance signifikan (${nearestResistance.price.toFixed(2)}, strength: ${nearestResistance.strength})`,
          },
          reason: 'S/R rejection',
        };
      }
    }
  }

  // === RANGING MARKET SETUPS ===
  if (regime.regime === 'RANGING') {
    // Range boundaries
    const rangeHigh = structure.lastSwingHigh;
    const rangeLow = structure.lastSwingLow;
    const rangeSize = rangeHigh - rangeLow;

    if (rangeSize <= 0) {
      return { passed: false, setup: noSetup, reason: 'Range tidak valid' };
    }

    const priceInRange = (currentPrice - rangeLow) / rangeSize;

    // Setup 4: Rejection at range boundary (bottom 20% or top 20%)
    if (priceInRange <= 0.2 && hasBullishRejection(candles)) {
      return {
        passed: true,
        setup: {
          valid: true,
          type: 'RANGE_BOUNDARY_REJECTION',
          regime: 'RANGING',
          entryPrice: currentPrice,
          reason: `Rejection di batas bawah range (${rangeLow.toFixed(2)} - ${rangeHigh.toFixed(2)})`,
        },
        reason: 'Range bottom rejection',
      };
    }

    if (priceInRange >= 0.8 && hasBearishRejection(candles)) {
      return {
        passed: true,
        setup: {
          valid: true,
          type: 'RANGE_BOUNDARY_REJECTION',
          regime: 'RANGING',
          entryPrice: currentPrice,
          reason: `Rejection di batas atas range (${rangeLow.toFixed(2)} - ${rangeHigh.toFixed(2)})`,
        },
        reason: 'Range top rejection',
      };
    }

    // Setup 5: Fake breakout + reclaim
    const justAboveRange = currentPrice > rangeHigh && currentPrice < rangeHigh + nearThreshold;
    const justBelowRange = currentPrice < rangeLow && currentPrice > rangeLow - nearThreshold;

    if (justAboveRange && hasBearishRejection(candles)) {
      return {
        passed: true,
        setup: {
          valid: true,
          type: 'FAKE_BREAKOUT_RECLAIM',
          regime: 'RANGING',
          entryPrice: currentPrice,
          reason: `Fake breakout atas + reclaim (high: ${rangeHigh.toFixed(2)})`,
        },
        reason: 'Fake breakout top',
      };
    }

    if (justBelowRange && hasBullishRejection(candles)) {
      return {
        passed: true,
        setup: {
          valid: true,
          type: 'FAKE_BREAKOUT_RECLAIM',
          regime: 'RANGING',
          entryPrice: currentPrice,
          reason: `Fake breakout bawah + reclaim (low: ${rangeLow.toFixed(2)})`,
        },
        reason: 'Fake breakout bottom',
      };
    }

    // Mid-range = no entry
    return {
      passed: false,
      setup: noSetup,
      reason: `Harga di tengah range (${(priceInRange * 100).toFixed(0)}%) — tidak ada level jelas`,
    };
  }

  // Low vol compression — only if clear breakout forming
  if (regime.regime === 'LOW_VOLATILITY_COMPRESSION') {
    return {
      passed: false,
      setup: noSetup,
      reason: 'Kompresi volatilitas — menunggu breakout',
    };
  }

  return { passed: false, setup: noSetup, reason: 'Tidak ada setup valid di kondisi saat ini' };
}

// ═══════════════════════════════════════════════════════════
// PHASE 4: INDICATOR VALIDATION
// ═══════════════════════════════════════════════════════════

function runPhase4(
  indicators: IndicatorValues,
  direction: TrendDirection,
  setupType: SetupType
): { passed: boolean; validation: IndicatorValidation; reason: string } {

  const { ema50, ema200, rsi, adx } = indicators;
  const reasons: string[] = [];
  let valid = true;

  // 1. EMA 50 & 200 alignment
  const emaAligned =
    (direction === 'BULLISH' && ema50 > ema200) ||
    (direction === 'BEARISH' && ema50 < ema200) ||
    direction === 'SIDEWAYS';

  if (!emaAligned) {
    reasons.push(`EMA tidak selaras: EMA50=${ema50.toFixed(2)} vs EMA200=${ema200.toFixed(2)}`);
    // For ranging setups, EMA alignment is less critical
    if (setupType !== 'RANGE_BOUNDARY_REJECTION' && setupType !== 'FAKE_BREAKOUT_RECLAIM') {
      valid = false;
    }
  } else {
    reasons.push(`EMA selaras: EMA50=${ema50.toFixed(2)}, EMA200=${ema200.toFixed(2)}`);
  }

  // 2. RSI validation
  let rsiValid = true;
  if (direction === 'BULLISH') {
    if (rsi < 55) {
      rsiValid = false;
      reasons.push(`RSI terlalu rendah untuk BUY: ${rsi.toFixed(1)} (min 55)`);
    } else if (rsi > 75) {
      rsiValid = false;
      reasons.push(`RSI overbought: ${rsi.toFixed(1)} (hindari >75)`);
    } else {
      reasons.push(`RSI valid: ${rsi.toFixed(1)}`);
    }
  } else if (direction === 'BEARISH') {
    if (rsi > 45) {
      rsiValid = false;
      reasons.push(`RSI terlalu tinggi untuk SELL: ${rsi.toFixed(1)} (max 45)`);
    } else if (rsi < 25) {
      rsiValid = false;
      reasons.push(`RSI oversold: ${rsi.toFixed(1)} (hindari <25)`);
    } else {
      reasons.push(`RSI valid: ${rsi.toFixed(1)}`);
    }
  }

  if (!rsiValid) valid = false;

  // 3. ADX > 20 for trending setups
  const adxValid = adx > 20 ||
    setupType === 'RANGE_BOUNDARY_REJECTION' ||
    setupType === 'FAKE_BREAKOUT_RECLAIM';

  if (!adxValid) {
    reasons.push(`ADX terlalu rendah: ${adx.toFixed(1)} (min 20 untuk trend setup)`);
    valid = false;
  } else {
    reasons.push(`ADX: ${adx.toFixed(1)}`);
  }

  const validation: IndicatorValidation = {
    valid,
    emaAligned,
    rsiValid,
    adxValid,
    rsiValue: rsi,
    adxValue: adx,
    reasons,
  };

  return {
    passed: valid,
    validation,
    reason: valid
      ? 'Semua indikator mendukung setup'
      : reasons.filter(r => !r.includes('valid') && !r.includes('selaras')).join('; '),
  };
}

// ═══════════════════════════════════════════════════════════
// PHASE 5: RISK & MONEY MANAGEMENT
// ═══════════════════════════════════════════════════════════

function runPhase5(
  candles: CandleData[],
  direction: TrendDirection,
  structure: StructureAnalysis,
  indicators: IndicatorValues,
  keyLevels: SRLevel[],
  accountBalance: number,
  riskPercent: number
): { passed: boolean; risk: RiskCalculation; reason: string } {

  const currentPrice = candles[candles.length - 1].close;
  const { atr } = indicators;
  const entryPrice = currentPrice;

  // === STOP LOSS: Below/above last structure + ATR buffer ===
  let stopLoss: number;
  if (direction === 'BULLISH') {
    const structureLow = structure.lastSwingLow;
    const atrBuffer = atr * 0.5;
    stopLoss = structureLow - atrBuffer;
    // Ensure SL is not too far (max 3 ATR from entry)
    if (entryPrice - stopLoss > atr * 3) {
      stopLoss = entryPrice - atr * 2;
    }
  } else {
    const structureHigh = structure.lastSwingHigh;
    const atrBuffer = atr * 0.5;
    stopLoss = structureHigh + atrBuffer;
    if (stopLoss - entryPrice > atr * 3) {
      stopLoss = entryPrice + atr * 2;
    }
  }

  // === TAKE PROFIT: Min RR 1:2, target next liquidity/resistance ===
  const risk = Math.abs(entryPrice - stopLoss);
  if (risk === 0) {
    return {
      passed: false,
      risk: {
        valid: false, entryPrice, stopLoss, takeProfit1: 0, takeProfit2: 0,
        riskRewardRatio: 0, positionSize: 0, riskAmount: 0, potentialReward: 0,
        reason: 'Risk = 0 (entry = SL)',
      },
      reason: 'Risk = 0',
    };
  }

  // Find next S/R for TP target
  let tp1Target = 0;
  if (direction === 'BULLISH') {
    const nextResistance = keyLevels
      .filter(l => l.type === 'resistance' && l.price > entryPrice + risk * 1.5)
      .sort((a, b) => a.price - b.price)[0];
    tp1Target = nextResistance
      ? Math.max(nextResistance.price, entryPrice + risk * 2)
      : entryPrice + risk * 2;
  } else {
    const nextSupport = keyLevels
      .filter(l => l.type === 'support' && l.price < entryPrice - risk * 1.5)
      .sort((a, b) => b.price - a.price)[0];
    tp1Target = nextSupport
      ? Math.min(nextSupport.price, entryPrice - risk * 2)
      : entryPrice - risk * 2;
  }

  const takeProfit1 = tp1Target;
  const takeProfit2 = direction === 'BULLISH'
    ? entryPrice + risk * 3
    : entryPrice - risk * 3;

  const reward = Math.abs(takeProfit1 - entryPrice);
  const rr = reward / risk;

  // === RR CHECK: Must be >= 1:2 ===
  if (rr < 2.0) {
    return {
      passed: false,
      risk: {
        valid: false, entryPrice, stopLoss, takeProfit1, takeProfit2,
        riskRewardRatio: rr, positionSize: 0,
        riskAmount: accountBalance * (riskPercent / 100),
        potentialReward: reward,
        reason: `RR ${rr.toFixed(2)} < 2.0 minimum`,
      },
      reason: `RR ${rr.toFixed(2)} tidak memenuhi minimum 1:2`,
    };
  }

  // === POSITION SIZE: (Balance × Risk%) / SL distance ===
  const riskAmount = accountBalance * (riskPercent / 100);
  const positionSize = riskAmount / risk;

  const riskCalc: RiskCalculation = {
    valid: true,
    entryPrice: Math.round(entryPrice * 100) / 100,
    stopLoss: Math.round(stopLoss * 100) / 100,
    takeProfit1: Math.round(takeProfit1 * 100) / 100,
    takeProfit2: Math.round(takeProfit2 * 100) / 100,
    riskRewardRatio: Math.round(rr * 100) / 100,
    positionSize: Math.round(positionSize * 10000) / 10000,
    riskAmount: Math.round(riskAmount * 100) / 100,
    potentialReward: Math.round(reward * positionSize * 100) / 100,
    reason: `Entry: ${entryPrice.toFixed(2)}, SL: ${stopLoss.toFixed(2)}, TP1: ${takeProfit1.toFixed(2)}, RR: ${rr.toFixed(2)}`,
  };

  return { passed: true, risk: riskCalc, reason: riskCalc.reason };
}

// ═══════════════════════════════════════════════════════════
// PHASE 6: CONFIDENCE SCORING SYSTEM
// ═══════════════════════════════════════════════════════════

function runPhase6(
  regime: RegimeAnalysis,
  alignment: MTFAlignment | null,
  setup: SetupDetection,
  validation: IndicatorValidation,
  keyLevels: SRLevel[],
  risk: RiskCalculation,
  currentPrice: number
): { passed: boolean; score: ConfidenceBreakdown; reason: string } {

  // 1. Regime clarity (15%)
  let regimeClarity = 0;
  if (regime.regime !== 'UNCLEAR' && regime.regime !== 'HIGH_VOLATILITY_EXPANSION') {
    regimeClarity = Math.min(15, Math.round(regime.confidence * 15 / 100));
  }

  // 2. HTF structure alignment (20%)
  let htfAlignment = 0;
  if (alignment) {
    if (alignment.aligned) {
      htfAlignment = 16; // Base for aligned
      // Bonus if all three agree
      if (alignment.htf.trend === alignment.mtf.trend && alignment.mtf.trend === alignment.ltf.trend) {
        htfAlignment = 20;
      }
    }
  }

  // 3. MTF setup quality (15%)
  let mtfSetupQuality = 0;
  if (setup.valid) {
    switch (setup.type) {
      case 'PULLBACK_EMA50': mtfSetupQuality = 15; break;
      case 'BREAKOUT_RETEST': mtfSetupQuality = 14; break;
      case 'SR_REJECTION': mtfSetupQuality = 13; break;
      case 'RANGE_BOUNDARY_REJECTION': mtfSetupQuality = 12; break;
      case 'FAKE_BREAKOUT_RECLAIM': mtfSetupQuality = 11; break;
      default: mtfSetupQuality = 0;
    }
  }

  // 4. LTF confirmation strength (10%)
  let ltfConfirmation = 0;
  if (alignment?.ltf) {
    if (alignment.ltf.structure.structureIntact) ltfConfirmation += 5;
    if (alignment.ltf.adx > 20) ltfConfirmation += 3;
    if (alignment.ltf.rsi > 50 && alignment.direction === 'BULLISH') ltfConfirmation += 2;
    if (alignment.ltf.rsi < 50 && alignment.direction === 'BEARISH') ltfConfirmation += 2;
    ltfConfirmation = Math.min(10, ltfConfirmation);
  }

  // 5. Indicator confluence (15%)
  let indicatorConfluence = 0;
  if (validation.emaAligned) indicatorConfluence += 5;
  if (validation.rsiValid) indicatorConfluence += 5;
  if (validation.adxValid) indicatorConfluence += 5;

  // 6. Key level validation (15%)
  let keyLevelValidation = 0;
  const nearbyLevels = keyLevels.filter(
    l => Math.abs(l.price - currentPrice) < (risk.valid ? Math.abs(risk.entryPrice - risk.stopLoss) * 2 : currentPrice * 0.01)
  );
  if (nearbyLevels.length > 0) {
    const strongestNearby = Math.max(...nearbyLevels.map(l => l.strength));
    keyLevelValidation = Math.min(15, Math.round(strongestNearby * 15 / 100));
  }

  // 7. Risk/Reward viability (10%)
  let rrViability = 0;
  if (risk.valid && risk.riskRewardRatio >= 2) {
    rrViability = 6;
    if (risk.riskRewardRatio >= 2.5) rrViability = 8;
    if (risk.riskRewardRatio >= 3) rrViability = 10;
  }

  const total = regimeClarity + htfAlignment + mtfSetupQuality + ltfConfirmation +
    indicatorConfluence + keyLevelValidation + rrViability;

  const breakdown: ConfidenceBreakdown = {
    regimeClarity,
    htfAlignment,
    mtfSetupQuality,
    ltfConfirmation,
    indicatorConfluence,
    keyLevelValidation,
    riskRewardViability: rrViability,
    total,
  };

  // MINIMUM 80% to enter
  if (total < 80) {
    return {
      passed: false,
      score: breakdown,
      reason: `Skor ${total}/100 < 80 minimum. Breakdown: Regime=${regimeClarity}/15, HTF=${htfAlignment}/20, Setup=${mtfSetupQuality}/15, LTF=${ltfConfirmation}/10, Indikator=${indicatorConfluence}/15, Level=${keyLevelValidation}/15, RR=${rrViability}/10`,
    };
  }

  return {
    passed: true,
    score: breakdown,
    reason: `Skor ${total}/100 ≥ 80. Konfluensi tinggi.`,
  };
}

// ═══════════════════════════════════════════════════════════
// PHASE 7: DISCIPLINE & PROTECTION RULES
// ═══════════════════════════════════════════════════════════

function runPhase7(discipline: DisciplineState | undefined): {
  passed: boolean;
  check: DisciplineCheck;
  reason: string;
} {
  const maxTrades = 3;
  const maxConsecutiveLosses = 2;

  const state = discipline || {
    tradesThisSession: 0,
    consecutiveLosses: 0,
    isPaused: false,
    pauseReason: '',
    lastTradeTime: 0,
    sessionStart: Date.now(),
  };

  // Check pause
  if (state.isPaused) {
    return {
      passed: false,
      check: {
        canTrade: false,
        reason: `Trading di-pause: ${state.pauseReason}`,
        tradesRemaining: 0,
      },
      reason: state.pauseReason,
    };
  }

  // Check max trades per session
  if (state.tradesThisSession >= maxTrades) {
    return {
      passed: false,
      check: {
        canTrade: false,
        reason: `Batas trade per sesi tercapai (${state.tradesThisSession}/${maxTrades})`,
        tradesRemaining: 0,
      },
      reason: `Max ${maxTrades} trade per sesi`,
    };
  }

  // Check consecutive losses
  if (state.consecutiveLosses >= maxConsecutiveLosses) {
    return {
      passed: false,
      check: {
        canTrade: false,
        reason: `${state.consecutiveLosses} loss berturut-turut — pause trading`,
        tradesRemaining: 0,
      },
      reason: `${state.consecutiveLosses} consecutive losses`,
    };
  }

  return {
    passed: true,
    check: {
      canTrade: true,
      reason: 'Disiplin OK',
      tradesRemaining: maxTrades - state.tradesThisSession,
    },
    reason: `OK — ${maxTrades - state.tradesThisSession} trade tersisa`,
  };
}

// ═══════════════════════════════════════════════════════════
// MAIN ENGINE ENTRY POINT
// ═══════════════════════════════════════════════════════════

export function runProbabilityEngine(input: EngineInput): EngineOutput {
  const {
    symbol,
    timeframe,
    candles,
    htfCandles,
    mtfCandles,
    accountBalance = 10000,
    riskPercent = 1,
    discipline,
  } = input;

  const timestamp = Date.now();
  const phases: PhaseResult[] = [];

  // Pre-compute
  const indicators = computeIndicators(candles);
  const swings = detectSwingPoints(candles, 5);
  const keyLevels = detectKeyLevels(candles, swings);
  const currentPrice = candles[candles.length - 1]?.close || 0;

  // Default WAIT output
  const makeWaitOutput = (phasesSoFar: PhaseResult[]): EngineOutput => ({
    marketRegime: 'UNCLEAR',
    htfTrendDirection: 'SIDEWAYS',
    setupType: 'NONE',
    signal: 'WAIT',
    entryPrice: null,
    stopLoss: null,
    takeProfit1: null,
    takeProfit2: null,
    riskRewardRatio: 0,
    positionSize: 0,
    confidenceScore: 0,
    technicalJustification: phasesSoFar.filter(p => !p.passed).map(p => p.reason).join(' | ') || 'Data tidak memadai',
    estimatedExpectedValue: 0,
    symbol,
    timeframe,
    timestamp,
    phases: phasesSoFar,
    confidenceBreakdown: {
      regimeClarity: 0, htfAlignment: 0, mtfSetupQuality: 0,
      ltfConfirmation: 0, indicatorConfluence: 0, keyLevelValidation: 0,
      riskRewardViability: 0, total: 0,
    },
    indicators,
    mtfAlignment: null,
    regime: { regime: 'UNCLEAR', confidence: 0, adx: indicators.adx, atr: indicators.atr, atrPercent: 0, atrExpanding: false, structure: 'MIXED', description: '' },
    structure: { trend: 'SIDEWAYS', swingPoints: swings, lastSwingHigh: 0, lastSwingLow: 0, structureIntact: false, description: '' },
    keyLevels: keyLevels.map(l => ({ type: l.type === 'support' ? 'SUPPORT' as const : 'RESISTANCE' as const, price: l.price, strength: l.strength, touchCount: l.touches, description: `${l.type} @ ${l.price.toFixed(2)}` })),
    risk: null,
    discipline: { canTrade: true, reason: '', tradesRemaining: 3 },
  });

  // Validate minimum data
  if (!candles || candles.length < 200) {
    phases.push({ phase: 0, name: 'Data Check', passed: false, reason: `Minimum 200 candles, got ${candles?.length || 0}` });
    return makeWaitOutput(phases);
  }

  // ─── PHASE 1: MARKET REGIME & STRUCTURE ───
  const p1 = runPhase1(candles, indicators);
  phases.push({ phase: 1, name: 'Market Regime & Structure', passed: p1.passed, reason: p1.reason });
  if (!p1.passed) {
    const out = makeWaitOutput(phases);
    out.marketRegime = p1.regime.regime;
    out.regime = p1.regime;
    out.structure = p1.structure;
    return out;
  }

  // ─── PHASE 2: MULTI-TIMEFRAME ALIGNMENT ───
  const p2 = runPhase2(candles, mtfCandles, htfCandles, timeframe);
  phases.push({ phase: 2, name: 'Multi-Timeframe Alignment', passed: p2.passed, reason: p2.reason });
  if (!p2.passed) {
    const out = makeWaitOutput(phases);
    out.marketRegime = p1.regime.regime;
    out.regime = p1.regime;
    out.structure = p1.structure;
    out.mtfAlignment = p2.alignment;
    return out;
  }

  const direction = p2.alignment!.direction;

  // ─── PHASE 3: HIGH PROBABILITY SETUP ───
  const p3 = runPhase3(candles, p1.regime, p1.structure, indicators, keyLevels, direction);
  phases.push({ phase: 3, name: 'High Probability Setup', passed: p3.passed, reason: p3.reason });
  if (!p3.passed) {
    const out = makeWaitOutput(phases);
    out.marketRegime = p1.regime.regime;
    out.htfTrendDirection = p2.alignment!.htf.trend;
    out.regime = p1.regime;
    out.structure = p1.structure;
    out.mtfAlignment = p2.alignment;
    return out;
  }

  // ─── PHASE 4: INDICATOR VALIDATION ───
  const p4 = runPhase4(indicators, direction, p3.setup.type);
  phases.push({ phase: 4, name: 'Indicator Validation', passed: p4.passed, reason: p4.reason });
  if (!p4.passed) {
    const out = makeWaitOutput(phases);
    out.marketRegime = p1.regime.regime;
    out.htfTrendDirection = p2.alignment!.htf.trend;
    out.setupType = p3.setup.type;
    out.regime = p1.regime;
    out.structure = p1.structure;
    out.mtfAlignment = p2.alignment;
    return out;
  }

  // ─── PHASE 5: RISK & MONEY MANAGEMENT ───
  const p5 = runPhase5(candles, direction, p1.structure, indicators, keyLevels, accountBalance, riskPercent);
  phases.push({ phase: 5, name: 'Risk & Money Management', passed: p5.passed, reason: p5.reason });
  if (!p5.passed) {
    const out = makeWaitOutput(phases);
    out.marketRegime = p1.regime.regime;
    out.htfTrendDirection = p2.alignment!.htf.trend;
    out.setupType = p3.setup.type;
    out.regime = p1.regime;
    out.structure = p1.structure;
    out.mtfAlignment = p2.alignment;
    out.risk = p5.risk;
    return out;
  }

  // ─── PHASE 6: CONFIDENCE SCORING ───
  const p6 = runPhase6(p1.regime, p2.alignment, p3.setup, p4.validation, keyLevels, p5.risk, currentPrice);
  phases.push({ phase: 6, name: 'Confidence Scoring', passed: p6.passed, reason: p6.reason });
  if (!p6.passed) {
    const out = makeWaitOutput(phases);
    out.marketRegime = p1.regime.regime;
    out.htfTrendDirection = p2.alignment!.htf.trend;
    out.setupType = p3.setup.type;
    out.confidenceScore = p6.score.total;
    out.confidenceBreakdown = p6.score;
    out.regime = p1.regime;
    out.structure = p1.structure;
    out.mtfAlignment = p2.alignment;
    out.risk = p5.risk;
    return out;
  }

  // ─── PHASE 7: DISCIPLINE & PROTECTION ───
  const p7 = runPhase7(discipline);
  phases.push({ phase: 7, name: 'Discipline & Protection', passed: p7.passed, reason: p7.reason });
  if (!p7.passed) {
    const out = makeWaitOutput(phases);
    out.marketRegime = p1.regime.regime;
    out.htfTrendDirection = p2.alignment!.htf.trend;
    out.setupType = p3.setup.type;
    out.confidenceScore = p6.score.total;
    out.confidenceBreakdown = p6.score;
    out.regime = p1.regime;
    out.structure = p1.structure;
    out.mtfAlignment = p2.alignment;
    out.risk = p5.risk;
    out.discipline = p7.check;
    return out;
  }

  // ═══ ALL 7 PHASES PASSED → GENERATE SIGNAL ═══

  const signal: SignalDecision = direction === 'BULLISH' ? 'BUY' : 'SELL';

  // Calculate Expected Value
  // EV = (winRate × avgWin) - (lossRate × avgLoss)
  // Conservative: assume ~55% win rate for high-confidence setups
  const winRate = 0.55;
  const avgWin = p5.risk.riskRewardRatio * p5.risk.riskAmount;
  const avgLoss = p5.risk.riskAmount;
  const ev = (winRate * avgWin) - ((1 - winRate) * avgLoss);

  // Build technical justification
  const justification = [
    `Regime: ${p1.regime.regime}`,
    `Structure: ${p1.structure.description}`,
    `Setup: ${p3.setup.reason}`,
    `MTF: ${p2.alignment!.reason}`,
    `RR: 1:${p5.risk.riskRewardRatio.toFixed(1)}`,
    `Score: ${p6.score.total}/100`,
  ].join(' | ');

  return {
    marketRegime: p1.regime.regime,
    htfTrendDirection: p2.alignment!.htf.trend,
    setupType: p3.setup.type,
    signal,
    entryPrice: p5.risk.entryPrice,
    stopLoss: p5.risk.stopLoss,
    takeProfit1: p5.risk.takeProfit1,
    takeProfit2: p5.risk.takeProfit2,
    riskRewardRatio: p5.risk.riskRewardRatio,
    positionSize: p5.risk.positionSize,
    confidenceScore: p6.score.total,
    technicalJustification: justification,
    estimatedExpectedValue: Math.round(ev * 100) / 100,
    symbol,
    timeframe,
    timestamp,
    phases,
    confidenceBreakdown: p6.score,
    indicators,
    mtfAlignment: p2.alignment,
    regime: p1.regime,
    structure: p1.structure,
    keyLevels: keyLevels.map(l => ({
      type: l.type === 'support' ? 'SUPPORT' as const : 'RESISTANCE' as const,
      price: l.price,
      strength: l.strength,
      touchCount: l.touches,
      description: `${l.type} @ ${l.price.toFixed(2)}`,
    })),
    risk: p5.risk,
    discipline: p7.check,
  };
}

// ═══════════════════════════════════════════════════════════
// UTILITY EXPORTS
// ═══════════════════════════════════════════════════════════

/** Create fresh discipline state */
export function createDisciplineState(): DisciplineState {
  return {
    tradesThisSession: 0,
    consecutiveLosses: 0,
    isPaused: false,
    pauseReason: '',
    lastTradeTime: 0,
    sessionStart: Date.now(),
  };
}

/** Record a trade result */
export function recordTradeResult(
  state: DisciplineState,
  isWin: boolean
): DisciplineState {
  return {
    ...state,
    tradesThisSession: state.tradesThisSession + 1,
    consecutiveLosses: isWin ? 0 : state.consecutiveLosses + 1,
    isPaused: !isWin && state.consecutiveLosses + 1 >= 2,
    pauseReason: !isWin && state.consecutiveLosses + 1 >= 2
      ? `${state.consecutiveLosses + 1} loss berturut-turut — pause trading`
      : '',
    lastTradeTime: Date.now(),
  };
}

/** Reset session */
export function resetSession(): DisciplineState {
  return createDisciplineState();
}
