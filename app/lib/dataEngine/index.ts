/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any */
/**
 * UNIFIED DATA ENGINE - Main Entry Point
 * 
 * This module provides a single, consistent interface for:
 * 1. Fetching market data from the best available source
 * 2. Aggregating M1 candles to higher timeframes
 * 3. Validating data integrity
 * 4. Multi-timeframe analysis coordination
 * 
 * Usage:
 *   import { UnifiedDataEngine } from '@/lib/dataEngine';
 *   const engine = new UnifiedDataEngine();
 *   const result = await engine.getCandles('BTCUSDT', 'H1', 200);
 */

import {
  BaseCandle,
  AggregatedCandle,
  Timeframe,
  MultiTimeframeAnalysis,
  TradingBias,
  TimeframeTrend,
  DataIntegrityReport,
  TIMEFRAME_CONFIG,
  AGGREGATION_RATIO,
} from './types';

import {
  aggregateCandles,
  validateDataIntegrity,
  fillGaps,
  removeDuplicates,
  crossValidate,
  alignToUTC,
  isCandleClosed,
} from './timeframeAggregator';

import {
  fetchCandles,
  fetchSpotPrice,
} from './dataFetcher';

// ============================================
// UNIFIED DATA ENGINE CLASS
// ============================================

export class UnifiedDataEngine {
  private m1Cache: Map<string, BaseCandle[]> = new Map();
  private lastFetchTime: Map<string, number> = new Map();
  private readonly M1_CACHE_DURATION = 60000; // 1 minute

  /**
   * Get candles for a symbol and timeframe
   * Uses M1 aggregation for consistency when possible
   */
  async getCandles(
    symbol: string,
    timeframe: Timeframe,
    limit: number = 200
  ): Promise<{
    candles: AggregatedCandle[];
    source: string;
    integrity: DataIntegrityReport;
    useM1Aggregation: boolean;
  }> {
    const normalizedSymbol = symbol.toUpperCase();

    // For M1 or if we have fresh M1 cache, aggregate from M1
    if (timeframe === 'M1' || this.hasValidM1Cache(normalizedSymbol)) {
      return this.getCandlesFromM1(normalizedSymbol, timeframe, limit);
    }

    // Direct fetch for higher timeframes (faster, but less consistent)
    const { candles, source, error } = await fetchCandles(
      normalizedSymbol,
      timeframe,
      limit
    );

    if (candles.length === 0) {
      console.warn(`[DataEngine] No candles from direct fetch: ${error}`);
      // Try M1 aggregation as fallback
      return this.getCandlesFromM1(normalizedSymbol, timeframe, limit);
    }

    // Clean and validate
    const cleaned = removeDuplicates(candles);
    const integrity = validateDataIntegrity(cleaned, normalizedSymbol, timeframe);

    // Fill gaps if needed
    const filled = integrity.priceGaps.length > 0 
      ? fillGaps(cleaned, timeframe, 'forward-fill')
      : cleaned;

    const aggregated: AggregatedCandle[] = filled.map(c => ({
      ...c,
      timeframe,
      sourceCandles: 1,
      aggregatedAt: Date.now(),
    }));

    return {
      candles: aggregated,
      source,
      integrity,
      useM1Aggregation: false,
    };
  }

  /**
   * Get candles by aggregating from M1 base
   */
  private async getCandlesFromM1(
    symbol: string,
    timeframe: Timeframe,
    limit: number
  ): Promise<{
    candles: AggregatedCandle[];
    source: string;
    integrity: DataIntegrityReport;
    useM1Aggregation: boolean;
  }> {
    // Calculate how many M1 candles we need
    const ratio = AGGREGATION_RATIO[timeframe];
    const m1Needed = limit * ratio + ratio; // Extra for current incomplete candle

    // Fetch M1 candles
    let m1Candles = this.m1Cache.get(symbol) ?? [];
    
    if (m1Candles.length < m1Needed || !this.hasValidM1Cache(symbol)) {
      const { candles, source } = await fetchCandles(symbol, 'M1', m1Needed);
      m1Candles = removeDuplicates(candles);
      this.m1Cache.set(symbol, m1Candles);
      this.lastFetchTime.set(symbol, Date.now());
    }

    // Aggregate to target timeframe
    const aggregated = aggregateCandles(m1Candles, timeframe, symbol);
    const integrity = validateDataIntegrity(m1Candles, symbol, 'M1');

    return {
      candles: aggregated.slice(-limit),
      source: 'M1-aggregated',
      integrity,
      useM1Aggregation: true,
    };
  }

  /**
   * Check if M1 cache is still valid
   */
  private hasValidM1Cache(symbol: string): boolean {
    const lastFetch = this.lastFetchTime.get(symbol);
    if (!lastFetch) return false;
    return Date.now() - lastFetch < this.M1_CACHE_DURATION;
  }

  /**
   * Get current spot price
   */
  async getSpotPrice(symbol: string): Promise<{
    price: number;
    source: string;
    timestamp: number;
  } | null> {
    return fetchSpotPrice(symbol);
  }

  /**
   * Perform multi-timeframe analysis
   * Analyzes M5, M15, H1, H4, D1 simultaneously
   */
  async analyzeMultiTimeframe(
    symbol: string
  ): Promise<MultiTimeframeAnalysis> {
    const normalizedSymbol = symbol.toUpperCase();
    const timeframes: Timeframe[] = ['M5', 'M15', 'H1', 'H4', 'D1'];
    const trends: Record<Timeframe, TimeframeTrend> = {} as any;

    // Fetch all timeframes in parallel
    const results = await Promise.all(
      timeframes.map(async (tf) => {
        const { candles } = await this.getCandles(normalizedSymbol, tf, 50);
        return { timeframe: tf, candles };
      })
    );

    // Analyze each timeframe
    for (const { timeframe, candles } of results) {
      trends[timeframe] = this.analyzeTrend(candles, timeframe);
    }

    // Determine overall bias
    const bias = this.calculateBias(trends);

    // Calculate alignment score
    const alignmentScore = this.calculateAlignment(trends);

    // Identify key levels from higher timeframes
    const keyLevels = this.extractKeyLevels(results);

    return {
      symbol: normalizedSymbol,
      trends,
      bias,
      alignmentScore,
      keyLevels,
      analysisTime: Date.now(),
    };
  }

  /**
   * Analyze trend for a single timeframe
   */
  private analyzeTrend(candles: AggregatedCandle[], timeframe: Timeframe): TimeframeTrend {
    if (candles.length < 20) {
      return {
        timeframe,
        direction: 'neutral',
        strength: 0,
        emaPosition: 'neutral',
        lastClose: candles[candles.length - 1]?.close ?? 0,
        lastHigh: candles[candles.length - 1]?.high ?? 0,
        lastLow: candles[candles.length - 1]?.low ?? 0,
      };
    }

    const closes = candles.map(c => c.close);
    const ema9 = this.calculateEMA(closes, 9);
    const ema21 = this.calculateEMA(closes, 21);
    const ema50 = this.calculateEMA(closes, 50);

    const lastClose = closes[closes.length - 1];
    const last20High = Math.max(...candles.slice(-20).map(c => c.high));
    const last20Low = Math.min(...candles.slice(-20).map(c => c.low));

    // Determine direction
    let direction: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    if (ema9 > ema21 && ema21 > ema50 && lastClose > ema9) {
      direction = 'bullish';
    } else if (ema9 < ema21 && ema21 < ema50 && lastClose < ema9) {
      direction = 'bearish';
    }

    // Calculate strength (0-100)
    const range = last20High - last20Low;
    const trendMove = lastClose - ema50;
    const strength = Math.min(100, Math.abs(trendMove / range) * 100);

    // EMA position
    let emaPosition: 'above' | 'below' | 'neutral' = 'neutral';
    if (lastClose > ema9 && lastClose > ema21) {
      emaPosition = 'above';
    } else if (lastClose < ema9 && lastClose < ema21) {
      emaPosition = 'below';
    }

    return {
      timeframe,
      direction,
      strength: Math.round(strength),
      emaPosition,
      lastClose,
      lastHigh: last20High,
      lastLow: last20Low,
    };
  }

  /**
   * Calculate EMA
   */
  private calculateEMA(data: number[], period: number): number {
    if (data.length < period) return data[data.length - 1] || 0;

    const k = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;

    for (let i = period; i < data.length; i++) {
      ema = data[i] * k + ema * (1 - k);
    }

    return ema;
  }

  /**
   * Calculate overall trading bias
   */
  private calculateBias(trends: Record<Timeframe, TimeframeTrend>): TradingBias {
    const weights: Record<Timeframe, number> = {
      M1: 0.05,
      M5: 0.10,
      M15: 0.15,
      M30: 0.15,
      H1: 0.20,
      H4: 0.20,
      D1: 0.15,
    };

    let bullishScore = 0;
    let bearishScore = 0;

    for (const [tf, trend] of Object.entries(trends)) {
      const weight = weights[tf as Timeframe] ?? 0.1;
      const strength = trend.strength / 100;

      if (trend.direction === 'bullish') {
        bullishScore += weight * strength;
      } else if (trend.direction === 'bearish') {
        bearishScore += weight * strength;
      }
    }

    const totalScore = bullishScore + bearishScore;
    const biasStrength = Math.round(Math.abs(bullishScore - bearishScore) * 100);

    let direction: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    if (bullishScore > bearishScore + 0.1) {
      direction = 'bullish';
    } else if (bearishScore > bullishScore + 0.1) {
      direction = 'bearish';
    }

    // Generate reasoning
    const reasoning = this.generateBiasReasoning(trends, direction);

    return {
      direction,
      strength: biasStrength,
      confidence: Math.min(100, Math.round(totalScore * 100)),
      reasoning,
    };
  }

  /**
   * Generate human-readable bias reasoning
   */
  private generateBiasReasoning(
    trends: Record<Timeframe, TimeframeTrend>,
    direction: 'bullish' | 'bearish' | 'neutral'
  ): string {
    const parts: string[] = [];

    // Daily trend
    if (trends.D1) {
      parts.push(`D1: ${trends.D1.direction} (${trends.D1.strength}%)`);
    }

    // H4 trend
    if (trends.H4) {
      parts.push(`H4: ${trends.H4.direction} (${trends.H4.strength}%)`);
    }

    // H1 trend
    if (trends.H1) {
      parts.push(`H1: ${trends.H1.direction} (${trends.H1.strength}%)`);
    }

    const alignment = Object.values(trends)
      .filter(t => t.direction === direction)
      .length;

    parts.push(`${alignment}/${Object.keys(trends).length} TFs aligned`);

    return parts.join(' | ');
  }

  /**
   * Calculate timeframe alignment score
   */
  private calculateAlignment(trends: Record<Timeframe, TimeframeTrend>): number {
    const directions = Object.values(trends).map(t => t.direction);
    const bullish = directions.filter(d => d === 'bullish').length;
    const bearish = directions.filter(d => d === 'bearish').length;
    const total = directions.length;

    const majorityCount = Math.max(bullish, bearish);
    return Math.round((majorityCount / total) * 100);
  }

  /**
   * Extract key support/resistance levels from higher timeframes
   */
  private extractKeyLevels(
    results: { timeframe: Timeframe; candles: AggregatedCandle[] }[]
  ): { price: number; type: 'support' | 'resistance'; timeframe: Timeframe }[] {
    const levels: { price: number; type: 'support' | 'resistance'; timeframe: Timeframe }[] = [];

    for (const { timeframe, candles } of results) {
      if (candles.length < 10) continue;

      // Get recent swing highs and lows
      const recent = candles.slice(-20);
      const highs = recent.map(c => c.high);
      const lows = recent.map(c => c.low);

      // Find local maxima (resistance) and minima (support)
      for (let i = 2; i < recent.length - 2; i++) {
        // Swing high
        if (
          highs[i] > highs[i - 1] &&
          highs[i] > highs[i - 2] &&
          highs[i] > highs[i + 1] &&
          highs[i] > highs[i + 2]
        ) {
          levels.push({
            price: highs[i],
            type: 'resistance',
            timeframe,
          });
        }

        // Swing low
        if (
          lows[i] < lows[i - 1] &&
          lows[i] < lows[i - 2] &&
          lows[i] < lows[i + 1] &&
          lows[i] < lows[i + 2]
        ) {
          levels.push({
            price: lows[i],
            type: 'support',
            timeframe,
          });
        }
      }
    }

    // Sort by price and remove duplicates (within 0.1% threshold)
    const unique = levels
      .sort((a, b) => a.price - b.price)
      .filter((level, index, arr) => {
        if (index === 0) return true;
        const priceDiff = Math.abs(level.price - arr[index - 1].price) / level.price;
        return priceDiff > 0.001;
      });

    return unique.slice(0, 10); // Top 10 levels
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.m1Cache.clear();
    this.lastFetchTime.clear();
  }
}

// ============================================
// SINGLETON INSTANCE
// ============================================

let engineInstance: UnifiedDataEngine | null = null;

export function getDataEngine(): UnifiedDataEngine {
  if (!engineInstance) {
    engineInstance = new UnifiedDataEngine();
  }
  return engineInstance;
}

// ============================================
// RE-EXPORTS
// ============================================

export * from './types';
export * from './timeframeAggregator';
export * from './dataFetcher';
