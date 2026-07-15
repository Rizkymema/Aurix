/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * TIMEFRAME AGGREGATOR
 * 
 * Converts M1 (1-minute) candles into higher timeframes.
 * This ensures ALL timeframes are derived from the same base data,
 * eliminating discrepancies between different API sources.
 * 
 * Pipeline: M1 → M5 → M15 → M30 → H1 → H4 → D1
 */

import {
  BaseCandle,
  AggregatedCandle,
  Timeframe,
  TIMEFRAME_CONFIG,
  AGGREGATION_RATIO,
  PRICE_PRECISION,
  DataIntegrityReport,
  PriceGap,
  AbnormalSpike,
} from './types';

// ============================================
// CORE AGGREGATION FUNCTIONS
// ============================================

/**
 * Aggregate M1 candles into a higher timeframe
 * 
 * @param m1Candles - Array of M1 base candles (must be sorted by timestamp ASC)
 * @param targetTimeframe - Target timeframe to aggregate to
 * @param symbol - Trading symbol for precision
 * @returns Array of aggregated candles
 */
export function aggregateCandles(
  m1Candles: BaseCandle[],
  targetTimeframe: Timeframe,
  symbol: string
): AggregatedCandle[] {
  if (targetTimeframe === 'M1') {
    // No aggregation needed
    return m1Candles.map(c => ({
      ...c,
      timeframe: 'M1',
      sourceCandles: 1,
      aggregatedAt: Date.now(),
    }));
  }

  const ratio = AGGREGATION_RATIO[targetTimeframe];
  const tfSeconds = TIMEFRAME_CONFIG[targetTimeframe].seconds;
  const precision = PRICE_PRECISION[symbol] ?? 2;
  const aggregated: AggregatedCandle[] = [];

  // Group M1 candles by their target timeframe period
  const groups = groupCandlesByPeriod(m1Candles, tfSeconds);

  for (const [periodStart, candles] of groups.entries()) {
    if (candles.length === 0) continue;

    // Aggregate OHLCV
    const open = candles[0].open;
    const close = candles[candles.length - 1].close;
    const high = Math.max(...candles.map(c => c.high));
    const low = Math.min(...candles.map(c => c.low));
    const volume = candles.reduce((sum, c) => sum + c.volume, 0);

    // Check if period is complete
    const isComplete = candles.length >= ratio;

    aggregated.push({
      timestamp: periodStart,
      open: roundToDecimal(open, precision),
      high: roundToDecimal(high, precision),
      low: roundToDecimal(low, precision),
      close: roundToDecimal(close, precision),
      volume: roundToDecimal(volume, 2),
      source: 'aggregated',
      symbol,
      isComplete,
      timeframe: targetTimeframe,
      sourceCandles: candles.length,
      aggregatedAt: Date.now(),
    });
  }

  return aggregated.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Group candles by their period start time.
 *
 * CRITICAL: For H4 (14400s) we must align within the UTC day,
 * not floor-divide by 14400. Floor-dividing by 14400 produces
 * wrong boundaries because 14400 does not evenly divide the
 * Unix epoch offset from midnight UTC on every day.
 *
 * TradingView H4 boundaries: 00:00, 04:00, 08:00, 12:00, 16:00, 20:00 UTC.
 *
 * For D1 (86400s): always floor to midnight UTC.
 *
 * For all other TFs (60, 300, 900, 1800, 3600): they evenly divide
 * 86400, so plain floor-division is correct.
 */
function groupCandlesByPeriod(
  candles: BaseCandle[],
  periodSeconds: number
): Map<number, BaseCandle[]> {
  const groups = new Map<number, BaseCandle[]>();
  const SECONDS_PER_DAY = 86400;

  for (const candle of candles) {
    let periodStart: number;

    if (periodSeconds === 86400) {
      // D1 — midnight UTC
      periodStart = Math.floor(candle.timestamp / SECONDS_PER_DAY) * SECONDS_PER_DAY;
    } else if (periodSeconds === 14400) {
      // H4 — align within UTC day (00:00, 04:00, 08:00, 12:00, 16:00, 20:00)
      const dayStart = Math.floor(candle.timestamp / SECONDS_PER_DAY) * SECONDS_PER_DAY;
      const secInDay = candle.timestamp - dayStart;
      const bucketStart = Math.floor(secInDay / periodSeconds) * periodSeconds;
      periodStart = dayStart + bucketStart;
    } else {
      // M1, M5, M15, M30, H1 — period evenly divides 86400
      periodStart = Math.floor(candle.timestamp / periodSeconds) * periodSeconds;
    }
    
    if (!groups.has(periodStart)) {
      groups.set(periodStart, []);
    }
    groups.get(periodStart)!.push(candle);
  }

  return groups;
}

/**
 * Round number to specified decimal places
 */
function roundToDecimal(value: number, decimals: number): number {
  const multiplier = Math.pow(10, decimals);
  return Math.round(value * multiplier) / multiplier;
}

// ============================================
// CANDLE ALIGNMENT (UTC)
// ============================================

/**
 * Align candle timestamp to UTC period boundary
 * This ensures candles always start at consistent times across sessions.
 *
 * CRITICAL: H4 must use day-aligned boundaries (00:00, 04:00, ... 20:00 UTC),
 * not simple floor-division by 14400.
 */
export function alignToUTC(timestamp: number, timeframe: Timeframe): number {
  const seconds = TIMEFRAME_CONFIG[timeframe].seconds;
  const SECONDS_PER_DAY = 86400;

  if (timeframe === 'D1') {
    return Math.floor(timestamp / SECONDS_PER_DAY) * SECONDS_PER_DAY;
  }

  if (timeframe === 'H4') {
    const dayStart = Math.floor(timestamp / SECONDS_PER_DAY) * SECONDS_PER_DAY;
    const secInDay = timestamp - dayStart;
    return dayStart + Math.floor(secInDay / seconds) * seconds;
  }

  return Math.floor(timestamp / seconds) * seconds;
}

/**
 * Get the expected next candle timestamp
 */
export function getNextCandleTime(currentTime: number, timeframe: Timeframe): number {
  const seconds = TIMEFRAME_CONFIG[timeframe].seconds;
  const aligned = alignToUTC(currentTime, timeframe);
  return aligned + seconds;
}

/**
 * Check if a candle should be closed based on current time
 */
export function isCandleClosed(candleTimestamp: number, timeframe: Timeframe): boolean {
  const nextCandleTime = getNextCandleTime(candleTimestamp, timeframe);
  const now = Math.floor(Date.now() / 1000);
  return now >= nextCandleTime;
}

// ============================================
// DATA INTEGRITY VALIDATION
// ============================================

/**
 * Validate candle data integrity
 * Detects missing candles, duplicates, gaps, and spikes
 */
export function validateDataIntegrity(
  candles: BaseCandle[],
  symbol: string,
  timeframe: Timeframe
): DataIntegrityReport {
  const tfSeconds = TIMEFRAME_CONFIG[timeframe].seconds;
  const issues: string[] = [];
  const priceGaps: PriceGap[] = [];
  const abnormalSpikes: AbnormalSpike[] = [];
  let missingCandles = 0;
  let duplicateCandles = 0;

  if (candles.length < 2) {
    return {
      symbol,
      timeframe,
      totalCandles: candles.length,
      missingCandles: 0,
      duplicateCandles: 0,
      priceGaps: [],
      abnormalSpikes: [],
      isValid: candles.length > 0,
      issues: candles.length === 0 ? ['No candles available'] : [],
      checkedAt: Date.now(),
    };
  }

  // Sort by timestamp
  const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);

  // Check for gaps and duplicates
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const expectedTime = prev.timestamp + tfSeconds;
    const timeDiff = curr.timestamp - prev.timestamp;

    // Check for duplicate timestamps
    if (timeDiff === 0) {
      duplicateCandles++;
      issues.push(`Duplicate candle at ${new Date(curr.timestamp * 1000).toISOString()}`);
    }

    // Check for missing candles (gap > 1 period)
    if (timeDiff > tfSeconds * 1.5) {
      const expectedCandles = Math.floor(timeDiff / tfSeconds) - 1;
      missingCandles += expectedCandles;
      priceGaps.push({
        fromTime: prev.timestamp,
        toTime: curr.timestamp,
        gapSize: expectedCandles,
        expectedCandles,
      });
    }

    // Check for abnormal price spikes (> 5% in one candle for crypto, > 2% for gold)
    const priceChange = Math.abs((curr.close - prev.close) / prev.close) * 100;
    const spikeThreshold = symbol.includes('USD') && !symbol.includes('USDT') ? 2 : 5;
    
    if (priceChange > spikeThreshold) {
      abnormalSpikes.push({
        time: curr.timestamp,
        price: curr.close,
        priceChange,
        volumeMultiple: prev.volume > 0 ? curr.volume / prev.volume : 1,
        isSuspicious: priceChange > spikeThreshold * 2,
      });
    }
  }

  // Validate OHLC consistency
  for (const candle of sorted) {
    if (candle.high < candle.low) {
      issues.push(`Invalid OHLC: high < low at ${new Date(candle.timestamp * 1000).toISOString()}`);
    }
    if (candle.high < candle.open || candle.high < candle.close) {
      issues.push(`Invalid OHLC: high not highest at ${new Date(candle.timestamp * 1000).toISOString()}`);
    }
    if (candle.low > candle.open || candle.low > candle.close) {
      issues.push(`Invalid OHLC: low not lowest at ${new Date(candle.timestamp * 1000).toISOString()}`);
    }
  }

  const isValid = issues.length === 0 && missingCandles === 0 && duplicateCandles === 0;

  return {
    symbol,
    timeframe,
    totalCandles: sorted.length,
    missingCandles,
    duplicateCandles,
    priceGaps,
    abnormalSpikes,
    isValid,
    issues,
    checkedAt: Date.now(),
  };
}

// ============================================
// GAP HANDLING
// ============================================

/**
 * Fill gaps in candle data using interpolation or previous close
 */
export function fillGaps(
  candles: BaseCandle[],
  timeframe: Timeframe,
  method: 'interpolate' | 'forward-fill' = 'forward-fill'
): BaseCandle[] {
  const tfSeconds = TIMEFRAME_CONFIG[timeframe].seconds;
  const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
  const filled: BaseCandle[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const curr = sorted[i];
    filled.push(curr);

    if (i < sorted.length - 1) {
      const next = sorted[i + 1];
      const timeDiff = next.timestamp - curr.timestamp;

      // If gap exists, fill it
      if (timeDiff > tfSeconds * 1.5) {
        const gapCount = Math.floor(timeDiff / tfSeconds) - 1;
        
        for (let j = 1; j <= gapCount; j++) {
          const gapTime = curr.timestamp + (j * tfSeconds);
          
          if (method === 'interpolate') {
            // Linear interpolation
            const progress = j / (gapCount + 1);
            const interpolatedClose = curr.close + (next.open - curr.close) * progress;
            
            filled.push({
              timestamp: gapTime,
              open: curr.close,
              high: Math.max(curr.close, interpolatedClose),
              low: Math.min(curr.close, interpolatedClose),
              close: interpolatedClose,
              volume: 0,
              source: curr.source,
              symbol: curr.symbol,
              isComplete: true,
            });
          } else {
            // Forward fill (use previous close)
            filled.push({
              timestamp: gapTime,
              open: curr.close,
              high: curr.close,
              low: curr.close,
              close: curr.close,
              volume: 0,
              source: curr.source,
              symbol: curr.symbol,
              isComplete: true,
            });
          }
        }
      }
    }
  }

  return filled;
}

// ============================================
// REMOVE DUPLICATES
// ============================================

/**
 * Remove duplicate candles, keeping the one with higher volume
 */
export function removeDuplicates(candles: BaseCandle[]): BaseCandle[] {
  const unique = new Map<number, BaseCandle>();

  for (const candle of candles) {
    const existing = unique.get(candle.timestamp);
    if (!existing || candle.volume > existing.volume) {
      unique.set(candle.timestamp, candle);
    }
  }

  return Array.from(unique.values()).sort((a, b) => a.timestamp - b.timestamp);
}

// ============================================
// CROSS-VALIDATION
// ============================================

/**
 * Cross-validate candle data with a secondary source
 * Returns confidence score (0-100)
 */
export function crossValidate(
  primary: BaseCandle[],
  secondary: BaseCandle[],
  tolerancePercent: number = 0.5
): { confidence: number; mismatches: number; details: string[] } {
  const details: string[] = [];
  let matches = 0;
  let mismatches = 0;

  // Create map of secondary candles by timestamp
  const secondaryMap = new Map<number, BaseCandle>();
  for (const candle of secondary) {
    secondaryMap.set(candle.timestamp, candle);
  }

  // Compare each primary candle
  for (const pCandle of primary) {
    const sCandle = secondaryMap.get(pCandle.timestamp);
    
    if (!sCandle) {
      // No matching timestamp in secondary
      continue;
    }

    // Check if close prices are within tolerance
    const priceDiff = Math.abs((pCandle.close - sCandle.close) / pCandle.close) * 100;
    
    if (priceDiff <= tolerancePercent) {
      matches++;
    } else {
      mismatches++;
      details.push(
        `Mismatch at ${new Date(pCandle.timestamp * 1000).toISOString()}: ` +
        `Primary=${pCandle.close}, Secondary=${sCandle.close} (diff=${priceDiff.toFixed(2)}%)`
      );
    }
  }

  const total = matches + mismatches;
  const confidence = total > 0 ? Math.round((matches / total) * 100) : 0;

  return { confidence, mismatches, details };
}

// ============================================
// EXPORT UTILITIES
// ============================================

export {
  roundToDecimal,
  groupCandlesByPeriod,
};
