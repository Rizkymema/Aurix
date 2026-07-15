/**
 * PROBABILITY ENGINE — Indicator Calculations
 * =============================================
 * 
 * Pure math functions. No side effects.
 * All functions are deterministic and stateless.
 */

import { CandleData, IndicatorValues, SwingPoint, SwingType } from './types';

// ─────────────────────────────────────────────
// EMA (Exponential Moving Average)
// ─────────────────────────────────────────────

export function calculateEMA(data: number[], period: number): number {
  if (data.length === 0) return 0;
  if (data.length < period) return data[data.length - 1];

  const k = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < data.length; i++) {
    ema = (data[i] - ema) * k + ema;
  }
  return ema;
}

/** Return full EMA series (same length as input, padded with SMA at start) */
export function calculateEMASeries(data: number[], period: number): number[] {
  if (data.length === 0) return [];
  if (data.length < period) return data.map(() => data[data.length - 1]);

  const result: number[] = new Array(data.length).fill(0);
  const k = 2 / (period + 1);

  // SMA for initial periods
  let sma = 0;
  for (let i = 0; i < period; i++) {
    sma += data[i];
    result[i] = sma / (i + 1);
  }
  result[period - 1] = sma / period;

  // EMA from period onward
  for (let i = period; i < data.length; i++) {
    result[i] = (data[i] - result[i - 1]) * k + result[i - 1];
  }

  return result;
}

// ─────────────────────────────────────────────
// ATR (Average True Range)
// ─────────────────────────────────────────────

export function calculateATR(candles: CandleData[], period: number = 14): number {
  if (candles.length < period + 1) return 0;

  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
    trueRanges.push(tr);
  }

  // Use Wilder's smoothing for proper ATR
  if (trueRanges.length < period) {
    return trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length;
  }

  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
  }
  return atr;
}

/** ATR series for expansion/compression detection */
export function calculateATRSeries(candles: CandleData[], period: number = 14): number[] {
  if (candles.length < period + 1) return [];

  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
    trueRanges.push(tr);
  }

  const result: number[] = [];
  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(atr);

  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
    result.push(atr);
  }
  return result;
}

// ─────────────────────────────────────────────
// RSI (Relative Strength Index) — Wilder's method
// ─────────────────────────────────────────────

export function calculateRSI(candles: CandleData[], period: number = 14): number {
  if (candles.length < period + 1) return 50;

  const changes: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    changes.push(candles[i].close - candles[i - 1].close);
  }

  // Initial avg gain/loss
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss += Math.abs(changes[i]);
  }
  avgGain /= period;
  avgLoss /= period;

  // Wilder's smoothing
  for (let i = period; i < changes.length; i++) {
    const gain = changes[i] > 0 ? changes[i] : 0;
    const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// ─────────────────────────────────────────────
// ADX (Average Directional Index)
// ─────────────────────────────────────────────

export function calculateADX(candles: CandleData[], period: number = 14): number {
  if (candles.length < period * 2 + 1) return 0;

  const plusDM: number[] = [];
  const minusDM: number[] = [];
  const trueRanges: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const highDiff = candles[i].high - candles[i - 1].high;
    const lowDiff = candles[i - 1].low - candles[i].low;

    plusDM.push(highDiff > lowDiff && highDiff > 0 ? highDiff : 0);
    minusDM.push(lowDiff > highDiff && lowDiff > 0 ? lowDiff : 0);

    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
    trueRanges.push(tr);
  }

  // Wilder's smoothing for +DM, -DM, TR
  const smooth = (arr: number[]): number[] => {
    const result: number[] = [];
    let sum = arr.slice(0, period).reduce((a, b) => a + b, 0);
    result.push(sum);
    for (let i = period; i < arr.length; i++) {
      sum = sum - sum / period + arr[i];
      result.push(sum);
    }
    return result;
  };

  const smoothPlusDM = smooth(plusDM);
  const smoothMinusDM = smooth(minusDM);
  const smoothTR = smooth(trueRanges);

  // DI+ and DI-
  const dx: number[] = [];
  for (let i = 0; i < smoothTR.length; i++) {
    if (smoothTR[i] === 0) { dx.push(0); continue; }
    const plusDI = (smoothPlusDM[i] / smoothTR[i]) * 100;
    const minusDI = (smoothMinusDM[i] / smoothTR[i]) * 100;
    const diSum = plusDI + minusDI;
    if (diSum === 0) { dx.push(0); continue; }
    dx.push(Math.abs(plusDI - minusDI) / diSum * 100);
  }

  if (dx.length < period) return dx.length > 0 ? dx[dx.length - 1] : 0;

  // ADX = smoothed DX
  let adx = dx.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dx.length; i++) {
    adx = (adx * (period - 1) + dx[i]) / period;
  }
  return adx;
}

// ─────────────────────────────────────────────
// SWING POINT DETECTION
// ─────────────────────────────────────────────

export function detectSwingPoints(candles: CandleData[], lookback: number = 5): SwingPoint[] {
  const swings: SwingPoint[] = [];
  if (candles.length < lookback * 2 + 1) return swings;

  for (let i = lookback; i < candles.length - lookback; i++) {
    const current = candles[i];
    const leftCandles = candles.slice(i - lookback, i);
    const rightCandles = candles.slice(i + 1, i + lookback + 1);

    const isSwingHigh = leftCandles.every(c => c.high <= current.high) &&
                        rightCandles.every(c => c.high <= current.high);

    const isSwingLow = leftCandles.every(c => c.low >= current.low) &&
                       rightCandles.every(c => c.low >= current.low);

    if (isSwingHigh) {
      // Classify based on previous swing high
      const prevHighSwing = [...swings].reverse().find(s => s.type === 'HH' || s.type === 'LH');
      let type: SwingType = 'HH';
      if (prevHighSwing) {
        type = current.high > prevHighSwing.price ? 'HH' : 'LH';
      }
      swings.push({ type, price: current.high, time: current.time, index: i });
    }

    if (isSwingLow) {
      const prevLowSwing = [...swings].reverse().find(s => s.type === 'HL' || s.type === 'LL');
      let type: SwingType = 'HL';
      if (prevLowSwing) {
        type = current.low > prevLowSwing.price ? 'HL' : 'LL';
      }
      swings.push({ type, price: current.low, time: current.time, index: i });
    }
  }

  return swings.slice(-20); // Keep last 20 swing points
}

// ─────────────────────────────────────────────
// KEY LEVEL DETECTION (S/R)
// ─────────────────────────────────────────────

export interface SRLevel {
  price: number;
  type: 'support' | 'resistance';
  strength: number;
  touches: number;
}

export function detectKeyLevels(candles: CandleData[], swings: SwingPoint[]): SRLevel[] {
  const levels: SRLevel[] = [];
  const currentPrice = candles[candles.length - 1]?.close || 0;
  if (!currentPrice) return levels;

  // Cluster swing points into levels (within 0.3% proximity)
  const clusterThreshold = currentPrice * 0.003;

  const allPrices = swings.map(s => s.price);
  const used = new Set<number>();

  for (const p of allPrices) {
    if (used.has(p)) continue;

    const cluster = allPrices.filter(
      op => !used.has(op) && Math.abs(op - p) < clusterThreshold
    );

    if (cluster.length >= 2) {
      const avgPrice = cluster.reduce((a, b) => a + b, 0) / cluster.length;
      cluster.forEach(cp => used.add(cp));

      levels.push({
        price: avgPrice,
        type: avgPrice > currentPrice ? 'resistance' : 'support',
        strength: Math.min(100, cluster.length * 25),
        touches: cluster.length,
      });
    }
  }

  // Sort by distance from current price
  levels.sort((a, b) => Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice));
  return levels.slice(0, 10);
}

// ─────────────────────────────────────────────
// REJECTION CANDLE PATTERNS
// ─────────────────────────────────────────────

export function hasBullishRejection(candles: CandleData[]): boolean {
  if (candles.length < 2) return false;
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];

  const body = Math.abs(last.close - last.open);
  const lowerWick = Math.min(last.open, last.close) - last.low;
  const range = last.high - last.low;
  if (range === 0) return false;

  // Pin bar / hammer
  const isPinBar = lowerWick > body * 2 && lowerWick > range * 0.5;
  // Bullish engulfing
  const isEngulfing = last.close > last.open &&
                      prev.close < prev.open &&
                      last.close > prev.open &&
                      last.open < prev.close;

  return isPinBar || isEngulfing;
}

export function hasBearishRejection(candles: CandleData[]): boolean {
  if (candles.length < 2) return false;
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];

  const body = Math.abs(last.close - last.open);
  const upperWick = last.high - Math.max(last.open, last.close);
  const range = last.high - last.low;
  if (range === 0) return false;

  // Shooting star
  const isShootingStar = upperWick > body * 2 && upperWick > range * 0.5;
  // Bearish engulfing
  const isEngulfing = last.close < last.open &&
                      prev.close > prev.open &&
                      last.close < prev.open &&
                      last.open > prev.close;

  return isShootingStar || isEngulfing;
}

// ─────────────────────────────────────────────
// COMPUTE ALL INDICATORS FOR A CANDLE SET
// ─────────────────────────────────────────────

export function computeIndicators(candles: CandleData[]): IndicatorValues {
  const closes = candles.map(c => c.close);
  const ema50 = calculateEMA(closes, 50);
  const ema200 = calculateEMA(closes, 200);
  const rsi = calculateRSI(candles, 14);
  const adx = calculateADX(candles, 14);
  const atr = calculateATR(candles, 14);

  // ATR SMA (simple moving avg of last 20 ATR values for expansion check)
  const atrSeries = calculateATRSeries(candles, 14);
  const last20ATR = atrSeries.slice(-20);
  const atrSma = last20ATR.length > 0
    ? last20ATR.reduce((a, b) => a + b, 0) / last20ATR.length
    : atr;

  return { ema50, ema200, rsi, adx, atr, atrSma };
}
