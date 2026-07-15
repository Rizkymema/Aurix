/**
 * FOREX KLINES API — Dedicated Forex/Commodity Data Endpoint
 *
 * This route provides TradingView-compatible candle data for forex symbols:
 *   XAUUSD, XAGUSD, EURUSD, GBPUSD, USDJPY
 *
 * Unlike /api/binance/klines (which is crypto-first), this endpoint
 * uses forex-specific data providers that match TradingView data.
 *
 * Data Source Priority:
 *   1. TraderMade → institutional spot forex
 *   2. FCS API → reliable forex OHLC
 *   3. TwelveData → good accuracy
 *   4. Yahoo Finance → futures-based fallback
 *
 * Query Parameters:
 *   symbol   — e.g., XAUUSD, EURUSD
 *   interval — e.g., 1m, 5m, 15m, 30m, 1h, 4h, 1d
 *   limit    — number of candles (default: 500)
 *
 * Response: Binance-compatible kline array format
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  fetchForexCandles,
  isForexSymbol,
  type ForexInterval,
} from '../../../services/forexDataProvider';

function normalizeForexSymbol(raw: string): string {
  const upper = raw.toUpperCase().replace(/[^A-Z]/g, '');
  if (upper === 'GOLD' || upper === 'XAUUSD') return 'XAUUSD';
  if (upper === 'SILVER' || upper === 'XAGUSD') return 'XAGUSD';
  return upper;
}

// ─── Forex Market Hours ──────────────────────────────────────────

function isForexMarketOpen(): { isOpen: boolean; nextOpen: string; status: string } {
  const now = new Date();
  const nyTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = nyTime.getDay();
  const hour = nyTime.getHours();
  const minute = nyTime.getMinutes();
  const timeInMinutes = hour * 60 + minute;

  if (day === 6) {
    return { isOpen: false, nextOpen: 'Sunday 5:00 PM EST', status: 'CLOSED (Weekend)' };
  }
  if (day === 0) {
    if (timeInMinutes >= 17 * 60) {
      return { isOpen: true, nextOpen: '', status: 'OPEN' };
    }
    return { isOpen: false, nextOpen: 'Today 5:00 PM EST', status: 'CLOSED (Opens later)' };
  }
  if (day === 5 && timeInMinutes >= 17 * 60) {
    return { isOpen: false, nextOpen: 'Sunday 5:00 PM EST', status: 'CLOSED (Weekend)' };
  }

  return { isOpen: true, nextOpen: '', status: 'OPEN' };
}

// ─── Cache ─────────────────────────────────────────────────────────

interface CacheEntry {
  data: (string | number)[][];
  timestamp: number;
  source: string;
  feedStatus: 'realtime' | 'delayed' | 'stale' | 'unavailable';
}

const candleCache = new Map<string, CacheEntry>();

// Cache duration by timeframe — shorter TFs need faster updates
const CACHE_DURATION: Record<string, number> = {
  '1m': 5000,     // 5 sec
  '5m': 10000,    // 10 sec
  '15m': 15000,   // 15 sec
  '30m': 20000,   // 20 sec
  '1h': 30000,    // 30 sec
  '4h': 60000,    // 1 min
  '1d': 120000,   // 2 min
};

function deriveFeedStatus(
  source: string,
  isRealData: boolean,
): 'realtime' | 'delayed' | 'stale' | 'unavailable' {
  const normalized = source.toLowerCase();

  if (!source || normalized === 'none') return 'unavailable';
  if (normalized.includes('mock') || normalized.includes('fallback')) return 'stale';
  if (!isRealData || normalized.includes('yahoo')) return 'delayed';
  return 'realtime';
}

// ─── Route Handler ─────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const symbol = normalizeForexSymbol(params.get('symbol') || 'XAUUSD');
  const interval = (params.get('interval') || '1h') as ForexInterval;
  const limit = params.get('limit') || '500';
  const forceFresh = params.get('forceFresh') === '1';

  // Validate it's actually a forex symbol
  if (!isForexSymbol(symbol)) {
    return NextResponse.json(
      { error: `${symbol} is not a forex symbol. Use /api/binance/klines for crypto.` },
      { status: 400 },
    );
  }

  // Check market hours
  const market = isForexMarketOpen();

  // Check cache
  const cacheKey = `${symbol}-${interval}`;
  const cached = candleCache.get(cacheKey);
  const cacheDuration = CACHE_DURATION[interval] || 30000;

  if (!forceFresh && cached && Date.now() - cached.timestamp < cacheDuration) {
    return NextResponse.json(cached.data, {
      headers: {
        'X-Data-Source': cached.source + ' (cached)',
        'X-Market-Status': market.status,
        'X-Feed-Status': cached.feedStatus,
        'X-Cache-Age': Math.floor((Date.now() - cached.timestamp) / 1000).toString(),
        'Cache-Control': `public, s-maxage=${Math.floor(cacheDuration / 1000)}`,
      },
    });
  }

  try {
    // Fetch from best available source
    const result = await fetchForexCandles(symbol, interval, limit);

    if (result.data.length === 0) {
      // Fallback to existing /api/binance/klines if all forex sources fail
      console.warn(`[forex/klines] All sources failed for ${symbol}, falling back to binance klines route`);
      const fallbackUrl = new URL(
        `/api/binance/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
        request.nextUrl.origin,
      );
      const fallbackRes = await fetch(fallbackUrl.toString());
      const fallbackData = await fallbackRes.json();

      return NextResponse.json(fallbackData, {
        headers: {
          'X-Data-Source': 'binance-klines-fallback',
          'X-Market-Status': market.status,
          'X-Feed-Status': 'stale',
          'X-Data-Warning': 'Primary forex APIs unavailable, using fallback',
          'Cache-Control': forceFresh ? 'no-store' : 'public, s-maxage=30',
        },
      });
    }

    const feedStatus = deriveFeedStatus(result.source, result.isRealData);

    // Update cache
    candleCache.set(cacheKey, {
      data: result.data,
      timestamp: Date.now(),
      source: result.source,
      feedStatus,
    });

    return NextResponse.json(result.data, {
      headers: {
        'X-Data-Source': result.source,
        'X-Symbol': result.symbol,
        'X-Market-Status': market.status,
        'X-Is-Realtime': result.isRealData.toString(),
        'X-Feed-Status': feedStatus,
        'X-Candle-Count': result.data.length.toString(),
        'Cache-Control': forceFresh
          ? 'no-store'
          : `public, s-maxage=${Math.floor(cacheDuration / 1000)}, stale-while-revalidate=${Math.floor(cacheDuration / 500)}`,
      },
    });
  } catch (err) {
    console.error(`[forex/klines] Error for ${symbol}:`, err);
    return NextResponse.json(
      { error: 'Failed to fetch forex data', detail: (err as Error).message },
      { status: 500 },
    );
  }
}
