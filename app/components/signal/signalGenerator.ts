import {
  SmartSignal,
  SignalType,
  SignalValidationParams,
  PriceZone,
  TrendAnalysis,
} from './types';

/**
 * AI Smart Signal Generator
 * 
 * Validasi sinyal berdasarkan:
 * 1. Trend alignment dengan H4 timeframe
 * 2. Harga berada di zona Supply/Demand
 * 3. Risk/Reward ratio minimal 1:2
 */

// Check if price is within a zone
function isPriceInZone(price: number, zone: PriceZone, tolerance: number = 0): boolean {
  const buffer = (zone.high - zone.low) * tolerance;
  return price >= (zone.low - buffer) && price <= (zone.high + buffer);
}

// Find the nearest zone to current price
function findNearestZone(
  price: number,
  zones: PriceZone[],
  type: 'supply' | 'demand'
): PriceZone | null {
  const filteredZones = zones.filter(z => z.type === type);
  
  if (filteredZones.length === 0) return null;
  
  // Sort by distance to price
  const sorted = filteredZones.sort((a, b) => {
    const distA = Math.min(Math.abs(price - a.high), Math.abs(price - a.low));
    const distB = Math.min(Math.abs(price - b.high), Math.abs(price - b.low));
    return distA - distB;
  });
  
  return sorted[0];
}

// Calculate validity score based on multiple factors
function calculateValidityScore(params: {
  trendAlignment: boolean;
  trendStrength: number;
  zoneStrength: number;
  riskRewardRatio: number;
  priceInZone: boolean;
}): number {
  let score = 0;
  
  // Trend alignment (max 30 points)
  if (params.trendAlignment) {
    score += 15 + (params.trendStrength / 100) * 15;
  }
  
  // Zone strength (max 25 points)
  score += (params.zoneStrength / 100) * 25;
  
  // Price in zone (max 25 points)
  if (params.priceInZone) {
    score += 25;
  }
  
  // Risk/Reward ratio (max 20 points)
  if (params.riskRewardRatio >= 3) {
    score += 20;
  } else if (params.riskRewardRatio >= 2) {
    score += 15;
  } else if (params.riskRewardRatio >= 1.5) {
    score += 10;
  }
  
  return Math.min(100, Math.round(score));
}

// Generate signal reason
function generateReason(params: {
  signalType: SignalType;
  trendDirection: string;
  zoneType: string;
  priceInZone: boolean;
  trendAlignment: boolean;
}): string {
  const reasons: string[] = [];
  
  if (params.trendAlignment) {
    reasons.push(`H4 trend ${params.trendDirection}`);
  }
  
  if (params.priceInZone) {
    reasons.push(`price at ${params.zoneType} zone`);
  } else {
    reasons.push(`approaching ${params.zoneType} zone`);
  }
  
  if (params.signalType === 'BUY') {
    reasons.push('bullish reversal expected');
  } else {
    reasons.push('bearish reversal expected');
  }
  
  return reasons.join(', ').charAt(0).toUpperCase() + reasons.join(', ').slice(1);
}

/**
 * Main signal generation function
 * Returns null if no valid signal found
 */
export function generateSmartSignal(
  symbol: string,
  params: SignalValidationParams
): SmartSignal | null {
  const { currentPrice, h4Trend, supplyZones, demandZones, atr } = params;
  
  // Find nearest zones
  const nearestSupply = findNearestZone(currentPrice, supplyZones, 'supply');
  const nearestDemand = findNearestZone(currentPrice, demandZones, 'demand');
  
  // Check for BUY signal (at demand zone with bullish H4 trend)
  const buyConditions = {
    trendAlignment: h4Trend.direction === 'bullish',
    inDemandZone: nearestDemand ? isPriceInZone(currentPrice, nearestDemand, 0.1) : false,
    nearDemandZone: nearestDemand ? 
      currentPrice <= nearestDemand.high * 1.005 && currentPrice >= nearestDemand.low * 0.995 : false,
  };
  
  // Check for SELL signal (at supply zone with bearish H4 trend)
  const sellConditions = {
    trendAlignment: h4Trend.direction === 'bearish',
    inSupplyZone: nearestSupply ? isPriceInZone(currentPrice, nearestSupply, 0.1) : false,
    nearSupplyZone: nearestSupply ?
      currentPrice >= nearestSupply.low * 0.995 && currentPrice <= nearestSupply.high * 1.005 : false,
  };
  
  let signalType: SignalType | null = null;
  let activeZone: PriceZone | null = null;
  let priceInZone = false;
  
  // Prioritize signal based on trend alignment + zone confluence
  if (buyConditions.trendAlignment && (buyConditions.inDemandZone || buyConditions.nearDemandZone)) {
    signalType = 'BUY';
    activeZone = nearestDemand;
    priceInZone = buyConditions.inDemandZone;
  } else if (sellConditions.trendAlignment && (sellConditions.inSupplyZone || sellConditions.nearSupplyZone)) {
    signalType = 'SELL';
    activeZone = nearestSupply;
    priceInZone = sellConditions.inSupplyZone;
  }
  
  // No valid signal found
  if (!signalType || !activeZone) {
    return null;
  }
  
  // Calculate entry, TP, SL levels
  const atrMultiplier = 1.5;
  let entry_zone: { high: number; low: number };
  let tp1: number;
  let tp2: number;
  let sl: number;
  
  if (signalType === 'BUY') {
    entry_zone = {
      low: activeZone.low,
      high: activeZone.high,
    };
    sl = activeZone.low - (atr * atrMultiplier);
    tp1 = currentPrice + (currentPrice - sl) * 2; // 1:2 RRR
    tp2 = currentPrice + (currentPrice - sl) * 3; // 1:3 RRR
  } else {
    entry_zone = {
      low: activeZone.low,
      high: activeZone.high,
    };
    sl = activeZone.high + (atr * atrMultiplier);
    tp1 = currentPrice - (sl - currentPrice) * 2; // 1:2 RRR
    tp2 = currentPrice - (sl - currentPrice) * 3; // 1:3 RRR
  }
  
  // ✅ CRITICAL FIX: Calculate Risk/Reward Ratio with validation
  const risk = Math.abs(currentPrice - sl);
  const reward = Math.abs(tp1 - currentPrice);
  
  // Validate risk and reward before division
  if (risk === 0 || isNaN(risk) || !isFinite(risk)) {
    console.warn('[Signal] Invalid risk calculation:', { currentPrice, sl, risk });
    return null;
  }
  
  if (reward === 0 || isNaN(reward) || !isFinite(reward)) {
    console.warn('[Signal] Invalid reward calculation:', { currentPrice, tp1, reward });
    return null;
  }
  
  // Check if risk is too small (< 0.01% of price - likely error)
  const minRisk = currentPrice * 0.0001;
  if (risk < minRisk) {
    console.warn('[Signal] Risk too small, probably bad SL:', { risk, minRisk, currentPrice, sl });
    return null;
  }
  
  const riskRewardRatio = reward / risk;
  
  // Sanity check RRR
  if (!isFinite(riskRewardRatio) || riskRewardRatio < 0) {
    console.warn('[Signal] Invalid RRR:', { riskRewardRatio, risk, reward });
    return null;
  }
  
  // Calculate validity score
  const validityScore = calculateValidityScore({
    trendAlignment: signalType === 'BUY' ? buyConditions.trendAlignment : sellConditions.trendAlignment,
    trendStrength: h4Trend.strength,
    zoneStrength: activeZone.strength,
    riskRewardRatio,
    priceInZone,
  });
  
  // Only return signal if score is above threshold
  if (validityScore < 50) {
    return null;
  }
  
  // Generate reason
  const reason = generateReason({
    signalType,
    trendDirection: h4Trend.direction,
    zoneType: signalType === 'BUY' ? 'demand' : 'supply',
    priceInZone,
    trendAlignment: signalType === 'BUY' ? buyConditions.trendAlignment : sellConditions.trendAlignment,
  });
  
  return {
    type: signalType,
    symbol,
    entry_zone,
    tp1: Math.round(tp1 * 100) / 100,
    tp2: Math.round(tp2 * 100) / 100,
    sl: Math.round(sl * 100) / 100,
    reason,
    validity_score: validityScore,
    timestamp: Date.now(),
    risk_reward_ratio: Math.round(riskRewardRatio * 100) / 100,
    trend_alignment: signalType === 'BUY' ? buyConditions.trendAlignment : sellConditions.trendAlignment,
    zone_confluence: priceInZone,
  };
}

/**
 * Analyze H4 trend from candle data
 */
export function analyzeH4Trend(candles: { close: number; open: number }[]): TrendAnalysis {
  if (candles.length < 10) {
    return { direction: 'neutral', strength: 0, timeframe: 'H4' };
  }
  
  // Use last 20 candles for trend analysis
  const recentCandles = candles.slice(-20);
  
  // Calculate EMA-like trend
  let bullishCandles = 0;
  let bearishCandles = 0;
  let totalMomentum = 0;
  
  recentCandles.forEach((candle, i) => {
    const weight = (i + 1) / recentCandles.length; // More recent candles have more weight
    const change = candle.close - candle.open;
    
    if (change > 0) {
      bullishCandles++;
      totalMomentum += change * weight;
    } else {
      bearishCandles++;
      totalMomentum += change * weight;
    }
  });
  
  // Determine direction based on momentum
  let direction: 'bullish' | 'bearish' | 'neutral';
  if (totalMomentum > 0 && bullishCandles > bearishCandles * 1.3) {
    direction = 'bullish';
  } else if (totalMomentum < 0 && bearishCandles > bullishCandles * 1.3) {
    direction = 'bearish';
  } else {
    direction = 'neutral';
  }
  
  // Calculate strength (0-100) based on candle ratio and momentum
  const ratio = Math.max(bullishCandles, bearishCandles) / recentCandles.length;
  const avgPrice = recentCandles.reduce((sum, c) => sum + c.close, 0) / recentCandles.length;
  const momentumFactor = Math.abs(totalMomentum) / avgPrice * 100;
  const strength = Math.min(100, Math.round((ratio * 70) + (momentumFactor * 30)))
  
  return { direction, strength, timeframe: 'H4' };
}

/**
 * Detect Supply/Demand zones from candle data
 */
export function detectZones(
  candles: { open: number; high: number; low: number; close: number }[],
  atr: number
): { supplyZones: PriceZone[]; demandZones: PriceZone[] } {
  const supplyZones: PriceZone[] = [];
  const demandZones: PriceZone[] = [];
  
  if (candles.length < 20) {
    return { supplyZones, demandZones };
  }
  
  // Find swing highs and lows
  for (let i = 10; i < candles.length - 5; i++) {
    const current = candles[i];
    const prev = candles.slice(i - 5, i);
    const next = candles.slice(i + 1, i + 6);
    
    // Check for swing high (supply zone)
    const isSwingHigh = prev.every(c => c.high < current.high) && 
                        next.every(c => c.high < current.high);
    
    // Check for swing low (demand zone)
    const isSwingLow = prev.every(c => c.low > current.low) && 
                       next.every(c => c.low > current.low);
    
    if (isSwingHigh) {
      // Create supply zone
      const bodyHigh = Math.max(current.open, current.close);
      supplyZones.push({
        high: current.high,
        low: bodyHigh - (atr * 0.5),
        type: 'supply',
        strength: 70 + Math.random() * 20, // Simplified strength calculation
      });
    }
    
    if (isSwingLow) {
      // Create demand zone
      const bodyLow = Math.min(current.open, current.close);
      demandZones.push({
        high: bodyLow + (atr * 0.5),
        low: current.low,
        type: 'demand',
        strength: 70 + Math.random() * 20,
      });
    }
  }
  
  // Keep only the 3 most recent zones of each type
  return {
    supplyZones: supplyZones.slice(-3),
    demandZones: demandZones.slice(-3),
  };
}

/**
 * Calculate ATR (Average True Range)
 */
export function calculateATR(
  candles: { high: number; low: number; close: number }[],
  period: number = 14
): number {
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
  
  // Calculate simple average of last 'period' true ranges
  const recentTR = trueRanges.slice(-period);
  return recentTR.reduce((a, b) => a + b, 0) / recentTR.length;
}
