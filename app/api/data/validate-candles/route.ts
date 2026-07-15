/**
 * CANDLE VALIDATION API
 *
 * Compares our OHLCV candle data against Binance REST API (source of truth)
 * and reports mismatches per candle per field.
 *
 * GET /api/data/validate-candles?symbol=BTCUSDT&interval=1h&limit=100
 *
 * This is the tool you use to confirm candles match TradingView 1:1.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  alignTimestamp,
  TFKey,
  OHLCVCandle,
  ValidationMismatch,
  validateAgainstTV,
  parseBinanceKline,
  validateOHLC,
  TF_SECONDS,
} from '../../../lib/candleEngine';

// Fetch reference candles directly from Binance
async function fetchBinanceReference(
  symbol: string,
  interval: string,
  limit: number,
): Promise<OHLCVCandle[]> {
  const endpoints = [
    'https://api.binance.com',
    'https://api1.binance.com',
    'https://data-api.binance.vision',
  ];

  for (const base of endpoints) {
    try {
      const url = `${base}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          return data.map(parseBinanceKline);
        }
      }
    } catch {
      continue;
    }
  }

  throw new Error('All Binance reference endpoints failed');
}

// Fetch our candles from the local klines proxy
async function fetchOurCandles(
  symbol: string,
  interval: string,
  limit: number,
  baseUrl: string,
): Promise<{ candles: OHLCVCandle[]; source: string }> {
  const url = `${baseUrl}/api/binance/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Our API returned ${res.status}`);
  const source = res.headers.get('X-Data-Source') || 'unknown';
  const data = await res.json();
  return { candles: data.map(parseBinanceKline), source };
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const symbol = (searchParams.get('symbol') || 'BTCUSDT').toUpperCase();
  const interval = searchParams.get('interval') || '1h';
  const limit = parseInt(searchParams.get('limit') || '100');
  const tf = interval as TFKey;

  const periodSec = TF_SECONDS[tf];
  if (!periodSec) {
    return NextResponse.json({ error: `Invalid interval: ${interval}` }, { status: 400 });
  }

  try {
    // Fetch reference candles from Binance directly
    const reference = await fetchBinanceReference(symbol, interval, limit);

    // Fetch our candles from our API
    const baseUrl = request.nextUrl.origin;
    const { candles: ours, source } = await fetchOurCandles(symbol, interval, limit, baseUrl);

    // 1. OHLCV price comparison
    const priceMismatches = validateAgainstTV(ours, reference, 0.01, 0.05);

    // 2. OHLC consistency check
    const ohlcErrors: { time: number; error: string }[] = [];
    for (const c of ours) {
      const err = validateOHLC(c);
      if (err) ohlcErrors.push({ time: c.time, error: err });
    }

    // 3. Timestamp alignment check
    const alignmentErrors: { time: number; aligned: number }[] = [];
    for (const c of ours) {
      const aligned = alignTimestamp(c.time, tf);
      if (c.time !== aligned) {
        alignmentErrors.push({ time: c.time, aligned });
      }
    }

    // 4. Gap detection
    const gaps: { after: number; missing: number }[] = [];
    for (let i = 1; i < ours.length; i++) {
      const expected = ours[i - 1].time + periodSec;
      if (ours[i].time > expected) {
        gaps.push({ after: ours[i - 1].time, missing: Math.floor((ours[i].time - expected) / periodSec) });
      }
    }

    // 5. Duplicate detection
    const seen = new Set<number>();
    const duplicates: number[] = [];
    for (const c of ours) {
      if (seen.has(c.time)) duplicates.push(c.time);
      seen.add(c.time);
    }

    const isMatch = priceMismatches.length === 0
      && ohlcErrors.length === 0
      && alignmentErrors.length === 0
      && gaps.length === 0
      && duplicates.length === 0;

    return NextResponse.json({
      symbol,
      interval,
      dataSource: source,
      totalCandles: ours.length,
      referenceCandles: reference.length,
      status: isMatch ? '✅ CANDLES MATCH TRADINGVIEW' : '❌ MISMATCHES FOUND',
      checks: {
        priceMatch: priceMismatches.length === 0 ? '✅' : `❌ ${priceMismatches.length} mismatches`,
        ohlcValid: ohlcErrors.length === 0 ? '✅' : `❌ ${ohlcErrors.length} invalid`,
        timestampAligned: alignmentErrors.length === 0 ? '✅' : `❌ ${alignmentErrors.length} misaligned`,
        noGaps: gaps.length === 0 ? '✅' : `❌ ${gaps.length} gaps`,
        noDuplicates: duplicates.length === 0 ? '✅' : `❌ ${duplicates.length} dupes`,
      },
      details: {
        priceMismatches: priceMismatches.slice(0, 10).map((m: ValidationMismatch) => ({
          timeISO: new Date(m.time * 1000).toISOString(),
          field: m.field,
          ours: m.ours,
          binance: m.theirs,
          diff: m.diff,
        })),
        ohlcErrors: ohlcErrors.slice(0, 10).map(e => ({
          timeISO: new Date(e.time * 1000).toISOString(),
          error: e.error,
        })),
        alignmentErrors: alignmentErrors.slice(0, 10).map(e => ({
          timeISO: new Date(e.time * 1000).toISOString(),
          actual: e.time,
          expected: e.aligned,
        })),
        gaps: gaps.slice(0, 10).map(g => ({
          afterISO: new Date(g.after * 1000).toISOString(),
          missingCandles: g.missing,
        })),
      },
    }, {
      headers: {
        'Cache-Control': 'no-store',
        'X-Validation-Result': isMatch ? 'PASS' : 'FAIL',
      },
    });
  } catch (err) {
    return NextResponse.json({
      error: 'Validation failed',
      message: err instanceof Error ? err.message : 'Unknown error',
    }, { status: 500 });
  }
}
