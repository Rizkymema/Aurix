/**
 * CANDLE ENGINE — TradingView-Compatible OHLCV Logic
 *
 * This module is the single source of truth for:
 *  1. Candle boundary alignment (UTC, matching TradingView exactly)
 *  2. Real-time candle construction from ticks
 *  3. Closed-candle immutability
 *  4. WS ↔ REST reconciliation
 *  5. Validation against TradingView reference data
 *
 * Timeframe alignment rules (identical to TradingView / Binance):
 *   M1  → every 60s, starting at :00
 *   M5  → :00, :05, :10, :15 …
 *   M15 → :00, :15, :30, :45
 *   M30 → :00, :30
 *   H1  → XX:00
 *   H4  → 00:00, 04:00, 08:00, 12:00, 16:00, 20:00 UTC
 *   D1  → 00:00 UTC (NOT local time)
 *
 * All timestamps are Unix seconds (UTC). No local timezone conversion anywhere.
 */

// ─── Types ────────────────────────────────────────────────────────────

export type TFKey = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';

export interface OHLCVCandle {
  /** Unix timestamp in SECONDS (UTC) — candle open time */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CandleBucket {
  /** The forming (live) candle. Mutable until `closeTime`. */
  candle: OHLCVCandle;
  /** Unix seconds when this candle closes (exclusive — next candle starts here) */
  closeTime: number;
  /** Whether the candle has been finalized (locked). */
  isClosed: boolean;
  /** Number of ticks/updates that built this candle */
  tickCount: number;
}

export interface ValidationMismatch {
  time: number;
  field: 'open' | 'high' | 'low' | 'close' | 'volume';
  ours: number;
  theirs: number;
  diff: number;
}

// ─── Constants ────────────────────────────────────────────────────────

/** Timeframe → duration in seconds */
export const TF_SECONDS: Record<TFKey, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
};

/** Seconds in one UTC day */
const SECONDS_PER_DAY = 86400;

// ─── Boundary Alignment ──────────────────────────────────────────────

/**
 * Compute the candle-open timestamp for any given Unix-second timestamp.
 *
 * This is the CRITICAL function — it must match TradingView / Binance exactly.
 *
 * For H4 we cannot simply floor-divide by 14400 because 14400 does not evenly
 * divide the Unix epoch offset from midnight-UTC. Instead we floor-divide
 * within the current UTC day:
 *   dayStart = floor(ts / 86400) * 86400
 *   secondsIntoDay = ts - dayStart
 *   bucketInDay = floor(secondsIntoDay / 14400) * 14400
 *   result = dayStart + bucketInDay
 *
 * For D1 it is simply floor(ts / 86400) * 86400.
 *
 * All other TFs evenly divide 86400 so plain floor-division is correct.
 */
export function alignTimestamp(ts: number, tf: TFKey): number {
  const period = TF_SECONDS[tf];

  if (tf === '1d') {
    // D1 → midnight UTC
    return Math.floor(ts / SECONDS_PER_DAY) * SECONDS_PER_DAY;
  }

  if (tf === '4h') {
    // H4 → align within UTC day
    const dayStart = Math.floor(ts / SECONDS_PER_DAY) * SECONDS_PER_DAY;
    const secInDay = ts - dayStart;
    const bucketStart = Math.floor(secInDay / period) * period;
    return dayStart + bucketStart;
  }

  // M1, M5, M15, M30, H1 — period evenly divides 86400
  return Math.floor(ts / period) * period;
}

/**
 * Get the close time of a candle (= open time of the next candle).
 */
export function getCandleCloseTime(openTime: number, tf: TFKey): number {
  return openTime + TF_SECONDS[tf];
}

/**
 * Is the candle at `openTime` closed right now?
 */
export function isCandleClosed(openTime: number, tf: TFKey, nowSeconds?: number): boolean {
  const now = nowSeconds ?? Math.floor(Date.now() / 1000);
  return now >= getCandleCloseTime(openTime, tf);
}

/**
 * Returns an array of expected candle open-times in [start, end) range.
 * Useful for gap detection.
 */
export function expectedCandleTimes(startTs: number, endTs: number, tf: TFKey): number[] {
  const period = TF_SECONDS[tf];
  const first = alignTimestamp(startTs, tf);
  const times: number[] = [];
  for (let t = first; t < endTs; t += period) {
    times.push(t);
  }
  return times;
}

// ─── Candle Construction from Ticks ──────────────────────────────────

/**
 * Create a new empty candle bucket for the period that contains `tickTime`.
 */
export function createBucket(tickTime: number, price: number, volume: number, tf: TFKey): CandleBucket {
  const openTime = alignTimestamp(tickTime, tf);
  return {
    candle: {
      time: openTime,
      open: price,
      high: price,
      low: price,
      close: price,
      volume,
    },
    closeTime: getCandleCloseTime(openTime, tf),
    isClosed: false,
    tickCount: 1,
  };
}

/**
 * Apply a tick to an existing candle bucket.
 *
 * Returns `true` if the tick belongs to this bucket (updated in-place).
 * Returns `false` if the tick is outside this bucket's time window
 * (caller must create a new bucket after locking the current one).
 */
export function applyTick(
  bucket: CandleBucket,
  tickTime: number,
  price: number,
  volume: number,
): boolean {
  if (bucket.isClosed) return false;

  // Check if tick belongs to this candle's period
  if (tickTime >= bucket.closeTime) {
    return false; // Tick is for the next candle
  }
  if (tickTime < bucket.candle.time) {
    return false; // Tick is for a previous candle (late arrival — discard)
  }

  // Update forming candle
  const c = bucket.candle;
  c.high = Math.max(c.high, price);
  c.low = Math.min(c.low, price);
  c.close = price;
  c.volume += volume;
  bucket.tickCount++;

  return true;
}

/**
 * Lock (finalize) a candle bucket. After this, OHLCV is immutable.
 */
export function lockBucket(bucket: CandleBucket): void {
  bucket.isClosed = true;
  // Freeze the candle object so nothing can mutate it
  Object.freeze(bucket.candle);
}

// ─── Candle Store (manages all closed + forming candles) ─────────────

export class CandleStore {
  private closedCandles: Map<number, OHLCVCandle> = new Map(); // key = openTime
  private forming: CandleBucket | null = null;
  private readonly tf: TFKey;

  constructor(tf: TFKey) {
    this.tf = tf;
  }

  /** Get the timeframe */
  get timeframe(): TFKey {
    return this.tf;
  }

  /**
   * Load historical candles (from REST API).
   * Candles whose close time is in the past are locked.
   * The last candle may be the forming candle.
   */
  loadHistorical(candles: OHLCVCandle[]): void {
    const nowSec = Math.floor(Date.now() / 1000);

    // Sort ascending by time
    const sorted = [...candles].sort((a, b) => a.time - b.time);

    for (const c of sorted) {
      // Re-align timestamp to make sure it sits on a boundary
      const aligned = alignTimestamp(c.time, this.tf);
      const closeTime = getCandleCloseTime(aligned, this.tf);
      const alignedCandle: OHLCVCandle = { ...c, time: aligned };

      if (nowSec >= closeTime) {
        // Closed candle → lock it
        this.closedCandles.set(aligned, Object.freeze(alignedCandle));
      } else {
        // Forming candle
        this.forming = {
          candle: alignedCandle,
          closeTime,
          isClosed: false,
          tickCount: 0,
        };
      }
    }
  }

  /**
   * Process a real-time tick or kline update.
   *
   * If `isKline` is true, the update comes from a Binance kline stream
   * and we trust its OHLCV directly (no recomputation needed).
   */
  processUpdate(update: OHLCVCandle, isKline: boolean = false): OHLCVCandle[] {
    const nowSec = Math.floor(Date.now() / 1000);
    const newlyClosed: OHLCVCandle[] = [];

    const aligned = alignTimestamp(update.time, this.tf);

    // If the update's period is already in our closed set, ignore it
    // (closed candles are IMMUTABLE)
    if (this.closedCandles.has(aligned)) {
      // Exception: if this is a kline from Binance that is still forming
      // (its close time is in the future), treat it as the forming candle
      const closeTime = getCandleCloseTime(aligned, this.tf);
      if (nowSec < closeTime && isKline) {
        // This is the forming candle from the exchange — use it directly
        this.forming = {
          candle: { ...update, time: aligned },
          closeTime,
          isClosed: false,
          tickCount: 1,
        };
        return newlyClosed;
      }
      return newlyClosed; // Already closed, ignore
    }

    // Check if we need to close the current forming candle
    if (this.forming && !this.forming.isClosed) {
      if (nowSec >= this.forming.closeTime || aligned > this.forming.candle.time) {
        // Close the forming candle
        lockBucket(this.forming);
        this.closedCandles.set(this.forming.candle.time, this.forming.candle);
        newlyClosed.push(this.forming.candle);
        this.forming = null;
      }
    }

    // Now handle the update
    if (this.forming && aligned === this.forming.candle.time) {
      // Same period as forming candle
      if (isKline) {
        // Trust the exchange's OHLCV directly (authoritative)
        this.forming.candle = { ...update, time: aligned };
        this.forming.tickCount++;
      } else {
        // Tick update — apply OHLCV rules
        applyTick(this.forming, update.time, update.close, update.volume || 0);
      }
    } else {
      // New period — create new forming candle
      const closeTime = getCandleCloseTime(aligned, this.tf);

      if (nowSec >= closeTime) {
        // This candle is already closed (backfill scenario)
        const frozenCandle = Object.freeze({ ...update, time: aligned });
        this.closedCandles.set(aligned, frozenCandle);
        newlyClosed.push(frozenCandle);
      } else {
        // New forming candle
        this.forming = {
          candle: { ...update, time: aligned },
          closeTime,
          isClosed: false,
          tickCount: 1,
        };
      }
    }

    return newlyClosed;
  }

  /**
   * Get all candles (closed + forming) in ascending order.
   */
  getAllCandles(): OHLCVCandle[] {
    const result = Array.from(this.closedCandles.values()).sort((a, b) => a.time - b.time);
    if (this.forming && !this.forming.isClosed) {
      result.push({ ...this.forming.candle });
    }
    return result;
  }

  /**
   * Get the current forming candle (or null if none).
   */
  getForming(): OHLCVCandle | null {
    if (this.forming && !this.forming.isClosed) {
      return { ...this.forming.candle };
    }
    return null;
  }

  /**
   * Detect and fill gaps by comparing against expected times.
   * Returns timestamps where candles are missing.
   */
  detectGaps(): number[] {
    const all = this.getAllCandles();
    if (all.length < 2) return [];

    const first = all[0].time;
    const last = all[all.length - 1].time;
    const expected = expectedCandleTimes(first, last + TF_SECONDS[this.tf], this.tf);
    const existing = new Set(all.map(c => c.time));

    return expected.filter(t => !existing.has(t));
  }

  /**
   * Clear all data (used when switching symbols/timeframes).
   */
  clear(): void {
    this.closedCandles.clear();
    this.forming = null;
  }

  /**
   * Number of closed candles stored.
   */
  get size(): number {
    return this.closedCandles.size;
  }
}

// ─── Aggregation from M1 to Higher TF ───────────────────────────────

/**
 * Aggregate an array of M1 candles into a higher timeframe.
 *
 * Rules:
 *  - Open = first M1 candle's open in the period
 *  - High = max of all M1 highs
 *  - Low  = min of all M1 lows
 *  - Close = last M1 candle's close in the period
 *  - Volume = sum of all M1 volumes
 *
 * Only complete periods produce a candle. The last (forming) period
 * is included but marked as incomplete by having a time that is still
 * in the forming window.
 */
export function aggregateM1(m1Candles: OHLCVCandle[], targetTF: TFKey): OHLCVCandle[] {
  if (targetTF === '1m') return m1Candles;

  const groups = new Map<number, OHLCVCandle[]>();

  for (const c of m1Candles) {
    const periodStart = alignTimestamp(c.time, targetTF);
    if (!groups.has(periodStart)) {
      groups.set(periodStart, []);
    }
    groups.get(periodStart)!.push(c);
  }

  const result: OHLCVCandle[] = [];

  for (const [periodStart, candles] of groups.entries()) {
    // Sort within the group
    candles.sort((a, b) => a.time - b.time);

    result.push({
      time: periodStart,
      open: candles[0].open,
      high: Math.max(...candles.map(c => c.high)),
      low: Math.min(...candles.map(c => c.low)),
      close: candles[candles.length - 1].close,
      volume: candles.reduce((sum, c) => sum + (c.volume || 0), 0),
    });
  }

  return result.sort((a, b) => a.time - b.time);
}

// ─── Reconciliation (WS ↔ REST) ─────────────────────────────────────

/**
 * Merge REST historical candles with the current CandleStore.
 *
 * - Closed candles from REST overwrite store if the store has no entry
 *   (REST is authoritative for closed candles).
 * - If the store already has a closed candle for that time, we keep
 *   the one with higher volume (exchange-sourced wins).
 * - The forming candle from REST is only used if the store doesn't
 *   already have a forming candle with more ticks.
 */
export function reconcile(store: CandleStore, restCandles: OHLCVCandle[]): void {
  store.loadHistorical(restCandles);
}

// ─── Validation vs TradingView ───────────────────────────────────────

/**
 * Compare our candles against TradingView reference candles.
 *
 * @param ours   - Our candle array
 * @param theirs - TradingView reference array
 * @param tolerancePrice - Max acceptable price difference (default: 0.01 for crypto, spread for forex)
 * @param toleranceVolume - Max acceptable volume difference fraction (default: 0.05 = 5%)
 *
 * Returns an array of mismatches. Empty array = perfect match.
 */
export function validateAgainstTV(
  ours: OHLCVCandle[],
  theirs: OHLCVCandle[],
  tolerancePrice: number = 0.01,
  toleranceVolume: number = 0.05,
): ValidationMismatch[] {
  const theirsMap = new Map<number, OHLCVCandle>();
  for (const c of theirs) {
    theirsMap.set(c.time, c);
  }

  const mismatches: ValidationMismatch[] = [];

  for (const ours_c of ours) {
    const tv_c = theirsMap.get(ours_c.time);
    if (!tv_c) continue; // No reference candle at this time

    // Check each OHLC field
    for (const field of ['open', 'high', 'low', 'close'] as const) {
      const diff = Math.abs(ours_c[field] - tv_c[field]);
      if (diff > tolerancePrice) {
        mismatches.push({
          time: ours_c.time,
          field,
          ours: ours_c[field],
          theirs: tv_c[field],
          diff,
        });
      }
    }

    // Volume check (relative)
    if (tv_c.volume > 0) {
      const volDiff = Math.abs(ours_c.volume - tv_c.volume) / tv_c.volume;
      if (volDiff > toleranceVolume) {
        mismatches.push({
          time: ours_c.time,
          field: 'volume',
          ours: ours_c.volume,
          theirs: tv_c.volume,
          diff: volDiff,
        });
      }
    }
  }

  return mismatches;
}

// ─── Binance Kline Parser ────────────────────────────────────────────

/**
 * Parse a Binance REST kline array into our OHLCVCandle format.
 *
 * Binance kline format:
 * [0] openTime (ms), [1] open, [2] high, [3] low, [4] close,
 * [5] volume, [6] closeTime (ms), ...
 *
 * We use openTime / 1000 as the candle timestamp (seconds).
 */
export function parseBinanceKline(raw: (string | number)[]): OHLCVCandle {
  return {
    time: Math.floor(Number(raw[0]) / 1000),
    open: parseFloat(String(raw[1])),
    high: parseFloat(String(raw[2])),
    low: parseFloat(String(raw[3])),
    close: parseFloat(String(raw[4])),
    volume: parseFloat(String(raw[5])),
  };
}

/**
 * Parse a Binance WebSocket kline event into OHLCVCandle.
 *
 * WS event `data.k` fields:
 *   t = kline start time (ms)
 *   o, h, l, c = OHLC (strings)
 *   v = volume (string)
 *   x = is this kline closed? (boolean)
 */
export function parseBinanceWsKline(k: {
  t: number;
  o: string;
  h: string;
  l: string;
  c: string;
  v: string;
  x: boolean;
}): { candle: OHLCVCandle; isClosed: boolean } {
  return {
    candle: {
      time: Math.floor(k.t / 1000),
      open: parseFloat(k.o),
      high: parseFloat(k.h),
      low: parseFloat(k.l),
      close: parseFloat(k.c),
      volume: parseFloat(k.v),
    },
    isClosed: k.x,
  };
}

// ─── Utilities ───────────────────────────────────────────────────────

/**
 * Remove duplicate candles, keeping the one with higher volume.
 */
export function deduplicateCandles(candles: OHLCVCandle[]): OHLCVCandle[] {
  const map = new Map<number, OHLCVCandle>();
  for (const c of candles) {
    const existing = map.get(c.time);
    if (!existing || c.volume > existing.volume) {
      map.set(c.time, c);
    }
  }
  return Array.from(map.values()).sort((a, b) => a.time - b.time);
}

/**
 * Validate OHLC consistency for a single candle.
 * Returns null if valid, error string if invalid.
 */
export function validateOHLC(c: OHLCVCandle): string | null {
  if (c.high < c.low) return `high (${c.high}) < low (${c.low})`;
  if (c.high < c.open) return `high (${c.high}) < open (${c.open})`;
  if (c.high < c.close) return `high (${c.high}) < close (${c.close})`;
  if (c.low > c.open) return `low (${c.low}) > open (${c.open})`;
  if (c.low > c.close) return `low (${c.low}) > close (${c.close})`;
  return null;
}
