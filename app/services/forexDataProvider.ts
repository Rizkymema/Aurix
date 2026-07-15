import { getMt5Candles, getMt5Tick } from '@/app/lib/mt5Bridge';

/**
 * FOREX DATA PROVIDER — TradingView-Compatible Real-Time Forex Data
 *
 * This module provides accurate forex/commodity data that matches TradingView candles.
 *
 * DATA SOURCE PRIORITY (ordered by TradingView accuracy):
 *  1. TraderMade API    — Institutional-grade forex data, matches TradingView OANDA feed
 *  2. FCS API           — Reliable forex OHLC, close match to TradingView
 *  3. Twelve Data API   — Good accuracy, 800 free calls/day
 *  4. Yahoo Finance     — GC=F futures (slight mismatch with spot, last resort)
 *
 * WHY THIS MATTERS:
 *  TradingView XAUUSD shows SPOT gold (typically OANDA or FXCM feed).
 *  Yahoo Finance GC=F is gold FUTURES which has contango/backwardation premium.
 *  TraderMade and FCS API provide spot forex data — much closer to TradingView.
 *
 * All candle timestamps are UTC-aligned (matching TradingView exactly).
 */

// ─── Types ─────────────────────────────────────────────────────────

export type ForexSymbol = 'XAUUSD' | 'XAGUSD' | 'EURUSD' | 'GBPUSD' | 'USDJPY';

export type ForexInterval = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';

export interface BinanceFormatCandle {
  /** Array matching Binance kline format: [openTime, open, high, low, close, volume, closeTime, ...] */
  data: (string | number)[][];
  source: string;
  symbol: string;
  interval: string;
  isRealData: boolean;
}

export interface DataSourceResult {
  candles: (string | number)[][];
  source: string;
  isRealtime: boolean;
  lastPrice: number;
}

// ─── Constants ─────────────────────────────────────────────────────

const INTERVAL_SECONDS: Record<string, number> = {
  '1m': 60, '5m': 300, '15m': 900, '30m': 1800,
  '1h': 3600, '4h': 14400, '1d': 86400,
};

const FOREX_SYMBOLS: ForexSymbol[] = ['XAUUSD', 'XAGUSD', 'EURUSD', 'GBPUSD', 'USDJPY'];

export function isForexSymbol(symbol: string): boolean {
  return FOREX_SYMBOLS.includes(symbol.toUpperCase() as ForexSymbol);
}

export function isTraderMadeConfigured(): boolean {
  return TRADERMADE_API_KEY.trim().length > 0;
}

// ─── Timestamp Alignment (TradingView-compatible) ──────────────────

/**
 * Align timestamp to UTC candle boundary (matches TradingView exactly).
 *
 * H4 boundaries: 00:00, 04:00, 08:00, 12:00, 16:00, 20:00 UTC
 * D1 boundary: 00:00 UTC
 * All others: floor to period boundary
 */
export function alignToUTCBoundary(tsSec: number, interval: string): number {
  const periodSec = INTERVAL_SECONDS[interval] || 3600;

  if (periodSec === 86400) {
    // D1 → midnight UTC
    return Math.floor(tsSec / 86400) * 86400;
  }

  if (periodSec === 14400) {
    // H4 → align within UTC day
    const dayStart = Math.floor(tsSec / 86400) * 86400;
    const secInDay = tsSec - dayStart;
    return dayStart + Math.floor(secInDay / 14400) * 14400;
  }

  // M1, M5, M15, M30, H1 — period evenly divides 86400
  return Math.floor(tsSec / periodSec) * periodSec;
}

/**
 * Convert candle data to Binance-compatible format with UTC-aligned timestamps.
 */
function toBinanceFormat(
  candles: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>,
  interval: string,
): (string | number)[][] {
  const periodSec = INTERVAL_SECONDS[interval] || 3600;

  return candles.map((c) => {
    const alignedSec = alignToUTCBoundary(c.time, interval);
    return [
      alignedSec * 1000,                         // openTime (ms)
      c.open.toFixed(c.open >= 100 ? 2 : 5),     // open
      c.high.toFixed(c.high >= 100 ? 2 : 5),     // high
      c.low.toFixed(c.low >= 100 ? 2 : 5),       // low
      c.close.toFixed(c.close >= 100 ? 2 : 5),   // close
      (c.volume || 0).toString(),                  // volume
      (alignedSec + periodSec) * 1000,            // closeTime (ms)
      '0', 0, 0, 0, '0',                          // padding to match Binance format
    ];
  });
}

// ─── Source 1: TraderMade API ──────────────────────────────────────
// https://tradermade.com — Institutional forex data, free tier: 1000 req/month
// Provides REST OHLC data that closely matches TradingView OANDA feed

const TRADERMADE_API_KEY = process.env.TRADERMADE_API_KEY || '';

interface SpotPriceResult {
  price: number;
  source: string;
  isRealtime: boolean;
}

async function fetchFromTraderMade(
  symbol: string, interval: string, limit: string,
): Promise<DataSourceResult | null> {
  if (!TRADERMADE_API_KEY) return null;

  // TraderMade symbol format
  const symbolMap: Record<string, string> = {
    'XAUUSD': 'XAUUSD', 'XAGUSD': 'XAGUSD',
    'EURUSD': 'EURUSD', 'GBPUSD': 'GBPUSD', 'USDJPY': 'USDJPY',
  };
  const tmSymbol = symbolMap[symbol.toUpperCase()];
  if (!tmSymbol) return null;

  // TraderMade interval mapping
  const intervalMap: Record<string, string> = {
    '1m': 'minute', '5m': 'minute', '15m': 'minute', '30m': 'minute',
    '1h': 'hourly', '4h': 'hourly', '1d': 'daily',
  };
  const tmInterval = intervalMap[interval];
  if (!tmInterval) return null;

  // Period for minute-based
  const periodMap: Record<string, number> = {
    '1m': 1, '5m': 5, '15m': 15, '30m': 30, '1h': 1, '4h': 4,
  };

  try {
    let url: string;
    const now = new Date();

    if (tmInterval === 'daily') {
      // Historical daily data
      const endDate = now.toISOString().split('T')[0];
      const startDate = new Date(now.getTime() - parseInt(limit) * 86400000)
        .toISOString().split('T')[0];
      url = `https://marketdata.tradermade.com/api/v1/timeseries?currency=${tmSymbol}&api_key=${TRADERMADE_API_KEY}&start_date=${startDate}&end_date=${endDate}&format=records`;
    } else if (tmInterval === 'hourly') {
      // Historical hourly data
      const endDate = now.toISOString().split('T')[0] + '-' +
        now.getHours().toString().padStart(2, '0') + ':' +
        now.getMinutes().toString().padStart(2, '0');
      const hoursBack = parseInt(limit) * (interval === '4h' ? 4 : 1);
      const startTime = new Date(now.getTime() - hoursBack * 3600000);
      const startDate = startTime.toISOString().split('T')[0] + '-' +
        startTime.getHours().toString().padStart(2, '0') + ':' +
        startTime.getMinutes().toString().padStart(2, '0');
      url = `https://marketdata.tradermade.com/api/v1/timeseries?currency=${tmSymbol}&api_key=${TRADERMADE_API_KEY}&start_date=${startDate}&end_date=${endDate}&interval=hourly&format=records`;
    } else {
      // Minute data
      const period = periodMap[interval] || 15;
      const endDate = now.toISOString().split('T')[0] + '-' +
        now.getHours().toString().padStart(2, '0') + ':' +
        now.getMinutes().toString().padStart(2, '0');
      const minutesBack = parseInt(limit) * period;
      const startTime = new Date(now.getTime() - minutesBack * 60000);
      const startDate = startTime.toISOString().split('T')[0] + '-' +
        startTime.getHours().toString().padStart(2, '0') + ':' +
        startTime.getMinutes().toString().padStart(2, '0');
      url = `https://marketdata.tradermade.com/api/v1/timeseries?currency=${tmSymbol}&api_key=${TRADERMADE_API_KEY}&start_date=${startDate}&end_date=${endDate}&interval=minute&period=${period}&format=records`;
    }

    const response = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.log(`[TraderMade] HTTP ${response.status} for ${symbol}`);
      return null;
    }

    const data = await response.json();

    if (data.error) {
      console.log(`[TraderMade] API error: ${data.error}`);
      return null;
    }

    // Parse TraderMade response
    const quotes = data.quotes || data;
    if (!Array.isArray(quotes) || quotes.length === 0) {
      console.log(`[TraderMade] No quotes returned for ${symbol}`);
      return null;
    }

    const candles = quotes.map((q: { date?: string; date_time?: string; open: number; high: number; low: number; close: number }) => {
      const dateStr = q.date_time || q.date || '';
      const tsSec = Math.floor(new Date(dateStr + (dateStr.includes('T') || dateStr.includes('Z') ? '' : ' UTC')).getTime() / 1000);
      return {
        time: tsSec,
        open: q.open,
        high: q.high,
        low: q.low,
        close: q.close,
        volume: 0,
      };
    });

    // Handle 4H aggregation from hourly data
    let finalCandles: (string | number)[][];
    if (interval === '4h' && tmInterval === 'hourly') {
      finalCandles = aggregateCandles(toBinanceFormat(candles, '1h'), '4h');
    } else {
      finalCandles = toBinanceFormat(candles, interval);
    }

    if (finalCandles.length === 0) return null;

    const lastPrice = parseFloat(String(finalCandles[finalCandles.length - 1][4]));
    console.log(`✓ [TraderMade] ${symbol}: ${finalCandles.length} candles, last: $${lastPrice.toFixed(2)}`);

    return {
      candles: finalCandles,
      source: 'TraderMade',
      isRealtime: true,
      lastPrice,
    };
  } catch (err) {
    console.log(`[TraderMade] Failed for ${symbol}: ${(err as Error).message}`);
    return null;
  }
}

// ─── Source 2: FCS API ─────────────────────────────────────────────
// https://fcsapi.com — Free forex API, supports OHLC candles
// Provides data that matches TradingView closely

async function fetchFromMt5Local(
  symbol: string,
  interval: string,
  limit: string,
): Promise<DataSourceResult | null> {
  try {
    const batch = await getMt5Candles(symbol, interval, parseInt(limit, 10));
    if (!batch || !Array.isArray(batch.candles) || batch.candles.length === 0) {
      return null;
    }

    const candles = batch.candles.map((c) => ({
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.tick_volume || 0,
    }));

    const finalCandles = toBinanceFormat(candles, interval);
    if (finalCandles.length === 0) return null;

    const lastPrice = parseFloat(String(finalCandles[finalCandles.length - 1][4]));
    console.log(`✓ [MT5-local] ${symbol}: ${finalCandles.length} candles, last: $${lastPrice.toFixed(2)}`);

    return {
      candles: finalCandles,
      source: (batch.source || 'MT5-local').replace(/^MT5-local:/, 'MT5-bridge:'),
      isRealtime: true,
      lastPrice,
    };
  } catch (err) {
    console.log(`[MT5-local] Failed for ${symbol}: ${(err as Error).message}`);
    return null;
  }
}

const FCS_API_KEY = process.env.FCS_API_KEY || '';

async function fetchFromFCSAPI(
  symbol: string, interval: string, limit: string,
): Promise<DataSourceResult | null> {
  if (!FCS_API_KEY) return null;

  // FCS API symbol format
  const symbolMap: Record<string, string> = {
    'XAUUSD': 'XAU/USD', 'XAGUSD': 'XAG/USD',
    'EURUSD': 'EUR/USD', 'GBPUSD': 'GBP/USD', 'USDJPY': 'USD/JPY',
  };
  const fcsSymbol = symbolMap[symbol.toUpperCase()];
  if (!fcsSymbol) return null;

  // FCS API period mapping
  const periodMap: Record<string, string> = {
    '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m',
    '1h': '1h', '4h': '4h', '1d': '1d',
  };
  const fcsPeriod = periodMap[interval] || '1h';

  try {
    // FCS API candle history endpoint
    const url = `https://fcsapi.com/api-v3/forex/history?symbol=${encodeURIComponent(fcsSymbol)}&period=${fcsPeriod}&access_key=${FCS_API_KEY}`;

    const response = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.log(`[FCS API] HTTP ${response.status} for ${symbol}`);
      return null;
    }

    const data = await response.json();

    if (data.status !== true || !data.response) {
      console.log(`[FCS API] Error: ${data.msg || 'unknown'}`);
      return null;
    }

    const rawCandles = data.response;
    if (!Array.isArray(rawCandles) || rawCandles.length === 0) {
      console.log(`[FCS API] No candles for ${symbol}`);
      return null;
    }

    const candles = rawCandles.map((c: { tm: string; o: string; h: string; l: string; c: string; v?: string }) => {
      const tsSec = Math.floor(new Date(c.tm + ' UTC').getTime() / 1000);
      return {
        time: tsSec,
        open: parseFloat(c.o),
        high: parseFloat(c.h),
        low: parseFloat(c.l),
        close: parseFloat(c.c),
        volume: parseFloat(c.v || '0'),
      };
    });

    // Sort oldest first
    candles.sort((a: { time: number }, b: { time: number }) => a.time - b.time);

    // Limit results
    const limitNum = parseInt(limit);
    const limitedCandles = candles.slice(-limitNum);

    const finalCandles = toBinanceFormat(limitedCandles, interval);
    if (finalCandles.length === 0) return null;

    const lastPrice = parseFloat(String(finalCandles[finalCandles.length - 1][4]));
    console.log(`✓ [FCS API] ${symbol}: ${finalCandles.length} candles, last: $${lastPrice.toFixed(2)}`);

    return {
      candles: finalCandles,
      source: 'FCS-API',
      isRealtime: true,
      lastPrice,
    };
  } catch (err) {
    console.log(`[FCS API] Failed for ${symbol}: ${(err as Error).message}`);
    return null;
  }
}

// ─── Source 3: Twelve Data API ─────────────────────────────────────
// https://twelvedata.com — 800 free calls/day, good accuracy

const TWELVE_DATA_API_KEY = process.env.TWELVE_DATA_API_KEY || 'demo';

async function fetchFromTwelveData(
  symbol: string, interval: string, limit: string,
): Promise<DataSourceResult | null> {
  if (TWELVE_DATA_API_KEY === 'demo') return null;

  const symbolMap: Record<string, string> = {
    'XAUUSD': 'XAU/USD', 'XAGUSD': 'XAG/USD',
    'EURUSD': 'EUR/USD', 'GBPUSD': 'GBP/USD', 'USDJPY': 'USD/JPY',
  };
  const tdSymbol = symbolMap[symbol.toUpperCase()];
  if (!tdSymbol) return null;

  const intervalMap: Record<string, string> = {
    '1m': '1min', '5m': '5min', '15m': '15min', '30m': '30min',
    '1h': '1h', '4h': '4h', '1d': '1day',
  };
  const tdInterval = intervalMap[interval] || '1h';

  try {
    const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(tdSymbol)}&interval=${tdInterval}&outputsize=${limit}&apikey=${TWELVE_DATA_API_KEY}`;

    const response = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) return null;
    const data = await response.json();

    if (data.status === 'error' || !data.values || !Array.isArray(data.values)) {
      console.log(`[TwelveData] Error: ${data.message || 'no values'}`);
      return null;
    }

    const candles = data.values.map((item: { datetime: string; open: string; high: string; low: string; close: string; volume?: string }) => {
      const tsSec = Math.floor(new Date(item.datetime + (item.datetime.includes('T') ? '' : ' UTC')).getTime() / 1000);
      return {
        time: tsSec,
        open: parseFloat(item.open),
        high: parseFloat(item.high),
        low: parseFloat(item.low),
        close: parseFloat(item.close),
        volume: parseFloat(item.volume || '0'),
      };
    });

    // Twelve Data returns newest first — reverse to oldest first
    candles.reverse();

    const finalCandles = toBinanceFormat(candles, interval);
    if (finalCandles.length === 0) return null;

    const lastPrice = parseFloat(String(finalCandles[finalCandles.length - 1][4]));
    console.log(`✓ [TwelveData] ${symbol}: ${finalCandles.length} candles, last: $${lastPrice.toFixed(2)}`);

    return {
      candles: finalCandles,
      source: 'TwelveData',
      isRealtime: true,
      lastPrice,
    };
  } catch (err) {
    console.log(`[TwelveData] Failed for ${symbol}: ${(err as Error).message}`);
    return null;
  }
}

// ─── Source 4: Yahoo Finance (Spot-optimized) ──────────────────────
// Uses specific spot-tracking tickers for each symbol

async function fetchFromYahooFinanceSpot(
  symbol: string, interval: string, limit: string,
): Promise<DataSourceResult | null> {
  const upperSymbol = symbol.toUpperCase();

  // Yahoo Finance tickers optimized for SPOT price matching
  // Priority: forex pairs > futures > ETFs
  const symbolMap: Record<string, string[]> = {
    'XAUUSD': ['GC=F'],       // Gold futures (closest to spot on Yahoo)
    'XAGUSD': ['SI=F', 'SLV'],
    'EURUSD': ['EURUSD=X'],
    'GBPUSD': ['GBPUSD=X'],
    'USDJPY': ['USDJPY=X'],
  };

  const tickers = symbolMap[upperSymbol];
  if (!tickers) return null;

  const intervalMap: Record<string, { interval: string; range: string }> = {
    '1m': { interval: '1m', range: '1d' },
    '5m': { interval: '5m', range: '5d' },
    '15m': { interval: '15m', range: '5d' },
    '30m': { interval: '30m', range: '5d' },
    '1h': { interval: '1h', range: '1mo' },
    '4h': { interval: '1h', range: '1mo' },  // aggregate later
    '1d': { interval: '1d', range: '1y' },
  };

  const config = intervalMap[interval] || { interval: '1h', range: '1mo' };

  for (const yahooSymbol of tickers) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=${config.interval}&range=${config.range}`;

      const response = await fetch(url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });

      if (!response.ok) continue;

      const data = await response.json();
      if (!data.chart?.result?.[0]) continue;

      const result = data.chart.result[0];
      const timestamps = result.timestamp;
      const quotes = result.indicators.quote[0];

      if (!timestamps || !quotes.open) continue;

      const sourceIntervalSec: Record<string, number> = {
        '1m': 60, '5m': 300, '15m': 900, '30m': 1800,
        '1h': 3600, '1d': 86400,
      };
      const actualIntervalSec = sourceIntervalSec[config.interval] || 3600;

      const limitNum = Math.min(parseInt(limit), timestamps.length);
      const startIdx = Math.max(0, timestamps.length - limitNum);

      const rawCandles: (string | number)[][] = [];

      for (let i = startIdx; i < timestamps.length; i++) {
        const open = quotes.open[i];
        const high = quotes.high[i];
        const low = quotes.low[i];
        const close = quotes.close[i];
        const volume = quotes.volume?.[i] || 0;

        if (open == null || high == null || low == null || close == null) continue;

        const rawTs = timestamps[i]; // seconds
        const alignedTs = alignToUTCBoundary(rawTs, interval === '4h' ? '1h' : interval);
        const alignedMs = alignedTs * 1000;
        const closeMs = alignedMs + actualIntervalSec * 1000;

        const decimals = upperSymbol.includes('JPY') ? 3 : (open >= 100 ? 2 : 5);
        rawCandles.push([
          alignedMs,
          open.toFixed(decimals),
          high.toFixed(decimals),
          low.toFixed(decimals),
          close.toFixed(decimals),
          volume.toString(),
          closeMs,
          '0', 0, 0, 0, '0',
        ]);
      }

      // Aggregate to 4H if needed
      let candles = rawCandles;
      if (interval === '4h' && config.interval === '1h') {
        candles = aggregateCandles(rawCandles, '4h');
      }

      if (candles.length > 0) {
        const lastPrice = parseFloat(String(candles[candles.length - 1][4]));

        // Sanity check for gold price
        if (upperSymbol === 'XAUUSD' && (lastPrice < 1500 || lastPrice > 8000)) {
          console.log(`[Yahoo] ${yahooSymbol} price out of range: $${lastPrice}`);
          continue;
        }

        console.log(`✓ [Yahoo] ${symbol} (${yahooSymbol}): ${candles.length} candles, last: $${lastPrice.toFixed(2)}`);
        return {
          candles,
          source: `Yahoo-${yahooSymbol}`,
          isRealtime: false, // Yahoo has delay
          lastPrice,
        };
      }
    } catch (err) {
      console.log(`[Yahoo] ${yahooSymbol} failed: ${(err as Error).message}`);
      continue;
    }
  }

  return null;
}

// ─── Candle Aggregation ────────────────────────────────────────────

/**
 * Aggregate smaller timeframe candles into larger timeframe.
 * Primarily used for: 1H → 4H aggregation.
 */
function aggregateCandles(
  sourceCandles: (string | number)[][],
  targetInterval: string,
): (string | number)[][] {
  const targetPeriodSec = INTERVAL_SECONDS[targetInterval];
  if (!targetPeriodSec) return sourceCandles;

  const groups = new Map<number, (string | number)[][]>();

  for (const candle of sourceCandles) {
    const tsSec = Math.floor(Number(candle[0]) / 1000);
    const alignedSec = alignToUTCBoundary(tsSec, targetInterval);

    if (!groups.has(alignedSec)) groups.set(alignedSec, []);
    groups.get(alignedSec)!.push(candle);
  }

  const result: (string | number)[][] = [];
  for (const [bucketStart, candles] of Array.from(groups.entries()).sort((a, b) => a[0] - b[0])) {
    candles.sort((a, b) => Number(a[0]) - Number(b[0]));

    const open = candles[0][1];
    const close = candles[candles.length - 1][4];
    let high = -Infinity;
    let low = Infinity;
    let vol = 0;

    for (const c of candles) {
      high = Math.max(high, parseFloat(String(c[2])));
      low = Math.min(low, parseFloat(String(c[3])));
      vol += parseFloat(String(c[5])) || 0;
    }

    const decimals = parseFloat(String(open)) >= 100 ? 2 : 5;
    result.push([
      bucketStart * 1000,
      open,
      high.toFixed(decimals),
      low.toFixed(decimals),
      close,
      vol.toString(),
      (bucketStart + targetPeriodSec) * 1000,
      '0', 0, 0, 0, '0',
    ]);
  }

  return result;
}

// ─── Real-Time Spot Price ──────────────────────────────────────────

/**
 * Fetch the latest spot price for a forex symbol from multiple sources.
 * Used to update the most recent candle's close price.
 */
async function fetchTraderMadeLiveRate(symbol: string): Promise<SpotPriceResult | null> {
  if (!isTraderMadeConfigured()) return null;

  try {
    const res = await fetch(
      `https://marketdata.tradermade.com/api/v1/live?currency=${encodeURIComponent(symbol)}&api_key=${TRADERMADE_API_KEY}`,
      {
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      },
    );

    if (!res.ok) {
      console.log(`[TraderMade-live] HTTP ${res.status} for ${symbol}`);
      return null;
    }

    const data = await res.json();
    const quote = Array.isArray(data.quotes) ? data.quotes[0] : null;
    if (!quote) return null;

    const numericMid = typeof quote.mid === 'number' ? quote.mid : Number(quote.mid);
    const numericBid = typeof quote.bid === 'number' ? quote.bid : Number(quote.bid);
    const numericAsk = typeof quote.ask === 'number' ? quote.ask : Number(quote.ask);
    const price = Number.isFinite(numericMid) && numericMid > 0
      ? numericMid
      : Number.isFinite(numericBid) && Number.isFinite(numericAsk) && numericBid > 0 && numericAsk > 0
        ? (numericBid + numericAsk) / 2
        : NaN;

    if (!Number.isFinite(price) || price <= 0) return null;

    return {
      price,
      source: 'TraderMade-live',
      isRealtime: true,
    };
  } catch (err) {
    console.log(`[TraderMade-live] Failed for ${symbol}: ${(err as Error).message}`);
    return null;
  }
}

export async function fetchSpotPrice(symbol: string): Promise<SpotPriceResult | null> {
  const upperSymbol = symbol.toUpperCase();

  try {
    const mt5Tick = await getMt5Tick(upperSymbol);
    if (mt5Tick?.price && mt5Tick.price > 0) {
      return {
        price: mt5Tick.price,
        source: (mt5Tick.source || 'MT5-local').replace(/^MT5-local:/, 'MT5-bridge:'),
        isRealtime: true,
      };
    }
  } catch {
    // Fall through to API providers
  }

  const sources = [
    {
      name: 'TraderMade-live',
      symbols: FOREX_SYMBOLS,
      isRealtime: true,
      fetch: async () => {
        const result = await fetchTraderMadeLiveRate(upperSymbol);
        return result?.price ?? null;
      },
    },
    // GoldPrice.org — accurate spot gold
    {
      name: 'GoldPrice.org',
      symbols: ['XAUUSD'],
      isRealtime: false,
      fetch: async () => {
        const res = await fetch('https://data-asg.goldprice.org/dbXRates/USD', {
          cache: 'no-store',
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data.items?.[0]?.xauPrice || null;
      },
    },
    // FreeForexAPI — supports multiple pairs
    {
      name: 'FreeForexAPI',
      symbols: ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'XAGUSD'],
      isRealtime: false,
      fetch: async () => {
        const res = await fetch(`https://www.freeforexapi.com/api/live?pairs=${upperSymbol}`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data.rates?.[upperSymbol]?.rate || null;
      },
    },
    // Metals.live — gold and silver
    {
      name: 'Metals.live',
      symbols: ['XAUUSD'],
      isRealtime: false,
      fetch: async () => {
        const res = await fetch('https://api.metals.live/v1/spot/gold', {
          cache: 'no-store',
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) return null;
        const data = await res.json();
        return Array.isArray(data) && data[0]?.price ? data[0].price : null;
      },
    },
  ];

  for (const source of sources) {
    if (!source.symbols.includes(upperSymbol)) continue;
    try {
      const price = await source.fetch();
      if (price && typeof price === 'number' && price > 0) {
        return { price, source: source.name, isRealtime: source.isRealtime };
      }
    } catch {
      continue;
    }
  }

  return null;
}

// ─── Main Provider Function ────────────────────────────────────────

/**
 * Fetch forex/commodity candle data from the best available source.
 *
 * Priority chain (ordered by TradingView accuracy):
 *  1. TraderMade → institutional-grade spot data
 *  2. FCS API → reliable forex OHLC
 *  3. TwelveData → good accuracy, rate-limited
 *  4. Yahoo Finance → futures-based (last resort)
 *
 * After fetching candles, the latest candle's close is updated
 * with the real-time spot price if available.
 */
export async function fetchForexCandles(
  symbol: string,
  interval: ForexInterval,
  limit: string = '500',
): Promise<BinanceFormatCandle> {
  const upperSymbol = symbol.toUpperCase();
  console.log(`[ForexProvider] Fetching ${upperSymbol} ${interval} (limit: ${limit})...`);

  // Try each source in priority order
  const providers = [
    { name: 'MT5-local', fn: () => fetchFromMt5Local(upperSymbol, interval, limit) },
    { name: 'TraderMade', fn: () => fetchFromTraderMade(upperSymbol, interval, limit) },
    { name: 'FCS-API', fn: () => fetchFromFCSAPI(upperSymbol, interval, limit) },
    { name: 'TwelveData', fn: () => fetchFromTwelveData(upperSymbol, interval, limit) },
    { name: 'Yahoo', fn: () => fetchFromYahooFinanceSpot(upperSymbol, interval, limit) },
  ];

  let result: DataSourceResult | null = null;

  for (const provider of providers) {
    try {
      result = await provider.fn();
      if (result && result.candles.length > 0) {
        break;
      }
    } catch (err) {
      console.log(`[ForexProvider] ${provider.name} failed: ${(err as Error).message}`);
    }
  }

  // If no real data, return empty with warning
  if (!result || result.candles.length === 0) {
    console.warn(`[ForexProvider] ⚠ All sources failed for ${upperSymbol}`);
    return {
      data: [],
      source: 'none',
      symbol: upperSymbol,
      interval,
      isRealData: false,
    };
  }

  // Update the last candle with real-time spot price
  try {
    const spot = await fetchSpotPrice(upperSymbol);
    if (spot && result.candles.length > 0) {
      const lastCandle = result.candles[result.candles.length - 1];
      const currentClose = parseFloat(String(lastCandle[4]));

      // Only update if spot price is within 1% of current close (sanity check)
      const diff = Math.abs(spot.price - currentClose) / currentClose;
      if (diff < 0.01) {
        const decimals = spot.price >= 100 ? 2 : 5;
        lastCandle[4] = spot.price.toFixed(decimals);
        console.log(`[ForexProvider] Updated last candle close with spot: $${spot.price.toFixed(decimals)} (${spot.source})`);
      }
    }
  } catch {
    // Non-critical — just use candle close
  }

  return {
    data: result.candles,
    source: result.source,
    symbol: upperSymbol,
    interval,
    isRealData: result.isRealtime,
  };
}
