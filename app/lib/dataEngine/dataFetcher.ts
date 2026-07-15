/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any */
/**
 * UNIFIED DATA FETCHER
 * 
 * Single source of truth for fetching market data.
 * Handles source prioritization, caching, and error fallbacks.
 * 
 * Primary Sources:
 * - BTCUSDT: Binance WebSocket/REST
 * - XAUUSD: GoldPrice.org (spot) + Yahoo Finance GC=F (candles)
 */

import {
  BaseCandle,
  DataSourceConfig,
  Timeframe,
  TIMEFRAME_CONFIG,
  DATA_SOURCES,
  PRICE_PRECISION,
} from './types';

// ============================================
// CACHE MANAGEMENT
// ============================================

interface CacheEntry {
  data: BaseCandle[];
  timestamp: number;
  expiresAt: number;
}

const candleCache = new Map<string, CacheEntry>();
const CACHE_DURATION_MS = 5000; // 5 seconds

function getCacheKey(symbol: string, timeframe: Timeframe, limit: number): string {
  return `${symbol}:${timeframe}:${limit}`;
}

function getFromCache(key: string): BaseCandle[] | null {
  const entry = candleCache.get(key);
  if (entry && Date.now() < entry.expiresAt) {
    return entry.data;
  }
  candleCache.delete(key);
  return null;
}

function setCache(key: string, data: BaseCandle[]): void {
  candleCache.set(key, {
    data,
    timestamp: Date.now(),
    expiresAt: Date.now() + CACHE_DURATION_MS,
  });
}

// ============================================
// MAIN FETCH FUNCTION
// ============================================

/**
 * Fetch candles from the best available source
 */
export async function fetchCandles(
  symbol: string,
  timeframe: Timeframe,
  limit: number = 500
): Promise<{ candles: BaseCandle[]; source: string; error?: string }> {
  const cacheKey = getCacheKey(symbol, timeframe, limit);
  const cached = getFromCache(cacheKey);
  
  if (cached) {
    return { candles: cached, source: 'cache' };
  }

  const sources = getSourcesForSymbol(symbol);
  let lastError = '';

  for (const source of sources) {
    try {
      const candles = await fetchFromSource(symbol, timeframe, limit, source);
      
      if (candles.length > 0) {
        setCache(cacheKey, candles);
        return { candles, source: source.source };
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[DataFetcher] ${source.source} failed for ${symbol}:`, lastError);
    }
  }

  return { candles: [], source: 'none', error: lastError };
}

/**
 * Get prioritized sources for a symbol
 */
function getSourcesForSymbol(symbol: string): DataSourceConfig[] {
  const normalizedSymbol = symbol.toUpperCase();
  
  if (normalizedSymbol === 'XAUUSD') {
    return [
      DATA_SOURCES.yahooFinance,
      DATA_SOURCES.goldPrice,
    ];
  }
  
  if (normalizedSymbol.endsWith('USDT')) {
    return [
      DATA_SOURCES.binance,
      DATA_SOURCES.cryptoCompare,
    ];
  }
  
  // Default to Binance for other crypto
  return [DATA_SOURCES.binance];
}

// ============================================
// SOURCE-SPECIFIC FETCHERS
// ============================================

async function fetchFromSource(
  symbol: string,
  timeframe: Timeframe,
  limit: number,
  source: DataSourceConfig
): Promise<BaseCandle[]> {
  switch (source.source) {
    case 'binance':
      return fetchFromBinance(symbol, timeframe, limit);
    case 'yahoo-finance':
      return fetchFromYahooFinance(symbol, timeframe, limit);
    case 'goldprice.org':
    case 'goldprice':
      return fetchFromGoldPriceOrg(symbol, limit);
    case 'cryptocompare':
      return fetchFromCryptoCompare(symbol, timeframe, limit);
    default:
      throw new Error(`Unknown source: ${source.source}`);
  }
}

/**
 * Fetch from Binance API
 */
async function fetchFromBinance(
  symbol: string,
  timeframe: Timeframe,
  limit: number
): Promise<BaseCandle[]> {
  const binanceInterval = mapTimeframeToBinance(timeframe);
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${binanceInterval}&limit=${limit}`;
  
  const response = await fetch(url, {
    headers: { 'Accept': 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Binance API error: ${response.status}`);
  }

  const data = await response.json();
  const precision = PRICE_PRECISION[symbol] ?? 2;

  return data.map((kline: any[]) => ({
    timestamp: Math.floor(kline[0] / 1000), // Convert ms to seconds
    open: parseFloat(kline[1]),
    high: parseFloat(kline[2]),
    low: parseFloat(kline[3]),
    close: parseFloat(kline[4]),
    volume: parseFloat(kline[5]),
    source: 'binance',
    symbol,
    isComplete: true,
  }));
}

/**
 * Fetch from Yahoo Finance (for XAUUSD via GC=F)
 */
async function fetchFromYahooFinance(
  symbol: string,
  timeframe: Timeframe,
  limit: number
): Promise<BaseCandle[]> {
  // Map symbol to Yahoo Finance ticker
  const yahooSymbol = symbol.toUpperCase() === 'XAUUSD' ? 'GC=F' : symbol;
  const yahooInterval = mapTimeframeToYahoo(timeframe);
  const range = getYahooRange(timeframe, limit);

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=${yahooInterval}&range=${range}&includeAdjustedClose=false`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Yahoo Finance API error: ${response.status}`);
  }

  const data = await response.json();
  const result = data.chart?.result?.[0];

  if (!result || !result.timestamp || !result.indicators?.quote?.[0]) {
    throw new Error('Invalid Yahoo Finance response structure');
  }

  const { timestamp, indicators } = result;
  const quote = indicators.quote[0];
  const precision = PRICE_PRECISION[symbol] ?? 2;

  const candles: BaseCandle[] = [];

  for (let i = 0; i < timestamp.length; i++) {
    const open = quote.open?.[i];
    const high = quote.high?.[i];
    const low = quote.low?.[i];
    const close = quote.close?.[i];
    const volume = quote.volume?.[i] ?? 0;

    // Skip candles with null values
    if (open == null || high == null || low == null || close == null) {
      continue;
    }

    candles.push({
      timestamp: timestamp[i],
      open: parseFloat(open.toFixed(precision)),
      high: parseFloat(high.toFixed(precision)),
      low: parseFloat(low.toFixed(precision)),
      close: parseFloat(close.toFixed(precision)),
      volume,
      source: 'yahoo-finance',
      symbol,
      isComplete: true,
    });
  }

  return candles.slice(-limit);
}

/**
 * Fetch real-time spot price from GoldPrice.org
 * Returns only the latest candle
 */
async function fetchFromGoldPriceOrg(
  symbol: string,
  limit: number
): Promise<BaseCandle[]> {
  const url = 'https://data-asg.goldprice.org/dbXRates/USD';
  
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'Origin': 'https://www.goldprice.org',
      'Referer': 'https://www.goldprice.org/',
    },
  });

  if (!response.ok) {
    throw new Error(`GoldPrice API error: ${response.status}`);
  }

  const data = await response.json();
  const goldPrice = data.items?.[0]?.xauPrice;

  if (!goldPrice || typeof goldPrice !== 'number') {
    throw new Error('Invalid gold price data');
  }

  const now = Math.floor(Date.now() / 1000);
  const precision = PRICE_PRECISION.XAUUSD;

  // GoldPrice.org only provides spot price, create a single candle
  return [{
    timestamp: now,
    open: goldPrice,
    high: goldPrice,
    low: goldPrice,
    close: goldPrice,
    volume: 0,
    source: 'goldprice.org',
    symbol,
    isComplete: false, // Current candle
  }];
}

/**
 * Fetch from CryptoCompare API (backup for crypto)
 */
async function fetchFromCryptoCompare(
  symbol: string,
  timeframe: Timeframe,
  limit: number
): Promise<BaseCandle[]> {
  const fsym = symbol.replace('USDT', '');
  const tsym = 'USDT';
  const endpoint = getCryptoCompareEndpoint(timeframe);
  const aggregate = getCryptoCompareAggregate(timeframe);

  const url = `https://min-api.cryptocompare.com/data/v2/${endpoint}?fsym=${fsym}&tsym=${tsym}&limit=${limit}&aggregate=${aggregate}`;

  const response = await fetch(url, {
    headers: { 'Accept': 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`CryptoCompare API error: ${response.status}`);
  }

  const data = await response.json();
  const candles = data.Data?.Data;

  if (!Array.isArray(candles)) {
    throw new Error('Invalid CryptoCompare response');
  }

  return candles.map((c: any) => ({
    timestamp: c.time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volumefrom || 0,
    source: 'cryptocompare',
    symbol,
    isComplete: true,
  }));
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function mapTimeframeToBinance(tf: Timeframe): string {
  const map: Record<Timeframe, string> = {
    M1: '1m',
    M5: '5m',
    M15: '15m',
    M30: '30m',
    H1: '1h',
    H4: '4h',
    D1: '1d',
  };
  return map[tf];
}

function mapTimeframeToYahoo(tf: Timeframe): string {
  const map: Record<Timeframe, string> = {
    M1: '1m',
    M5: '5m',
    M15: '15m',
    M30: '30m',
    H1: '1h',
    H4: '1h', // Yahoo doesn't have 4h, will aggregate
    D1: '1d',
  };
  return map[tf];
}

function getYahooRange(tf: Timeframe, limit: number): string {
  const seconds = TIMEFRAME_CONFIG[tf].seconds;
  const totalSeconds = seconds * limit;
  const totalDays = Math.ceil(totalSeconds / 86400);

  if (totalDays <= 7) return '7d';
  if (totalDays <= 30) return '1mo';
  if (totalDays <= 90) return '3mo';
  if (totalDays <= 365) return '1y';
  return '5y';
}

function getCryptoCompareEndpoint(tf: Timeframe): string {
  const seconds = TIMEFRAME_CONFIG[tf].seconds;
  if (seconds < 3600) return 'histominute';
  if (seconds < 86400) return 'histohour';
  return 'histoday';
}

function getCryptoCompareAggregate(tf: Timeframe): number {
  const map: Record<Timeframe, number> = {
    M1: 1,
    M5: 5,
    M15: 15,
    M30: 30,
    H1: 1,
    H4: 4,
    D1: 1,
  };
  return map[tf];
}

// ============================================
// REAL-TIME PRICE FETCHER
// ============================================

/**
 * Fetch current spot price for a symbol
 */
export async function fetchSpotPrice(symbol: string): Promise<{
  price: number;
  source: string;
  timestamp: number;
} | null> {
  const normalizedSymbol = symbol.toUpperCase();

  try {
    if (normalizedSymbol === 'XAUUSD') {
      // Primary: GoldPrice.org
      const response = await fetch('https://data-asg.goldprice.org/dbXRates/USD');
      const data = await response.json();
      const price = data.items?.[0]?.xauPrice;

      if (price && typeof price === 'number') {
        return {
          price: parseFloat(price.toFixed(2)),
          source: 'goldprice',
          timestamp: Date.now(),
        };
      }

      // Fallback: Yahoo Finance
      const yahooResponse = await fetch(
        'https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1m&range=1d'
      );
      const yahooData = await yahooResponse.json();
      const yahooPrice = yahooData.chart?.result?.[0]?.meta?.regularMarketPrice;

      if (yahooPrice) {
        return {
          price: parseFloat(yahooPrice.toFixed(2)),
          source: 'yahoo-finance',
          timestamp: Date.now(),
        };
      }
    }

    if (normalizedSymbol.endsWith('USDT')) {
      // Binance ticker
      const response = await fetch(
        `https://api.binance.com/api/v3/ticker/price?symbol=${normalizedSymbol}`
      );
      const data = await response.json();

      if (data.price) {
        return {
          price: parseFloat(data.price),
          source: 'binance',
          timestamp: Date.now(),
        };
      }
    }
  } catch (error) {
    console.error(`[DataFetcher] Failed to fetch spot price for ${symbol}:`, error);
  }

  return null;
}

// ============================================
// EXPORTS
// ============================================

export {
  getFromCache,
  setCache,
  getCacheKey,
  getSourcesForSymbol,
};
