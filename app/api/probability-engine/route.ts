/**
 * PROBABILITY ENGINE — API Route
 * ================================
 * 
 * POST /api/probability-engine
 * 
 * Runs the 7-phase probability engine on provided candle data.
 * If candles are not provided, fetches via the data engine.
 */

import { NextRequest, NextResponse } from 'next/server';
import { runProbabilityEngine } from '@/app/lib/probabilityEngine';
import type { EngineInput, DisciplineState } from '@/app/lib/probabilityEngine';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      symbol = 'BTCUSDT',
      timeframe = '15m',
      candles,
      htfCandles,
      mtfCandles,
      accountBalance = 10000,
      riskPercent = 1,
      discipline,
    } = body as {
      symbol?: string;
      timeframe?: string;
      candles?: Array<{ time: number; open: number; high: number; low: number; close: number; volume?: number }>;
      htfCandles?: Array<{ time: number; open: number; high: number; low: number; close: number; volume?: number }>;
      mtfCandles?: Array<{ time: number; open: number; high: number; low: number; close: number; volume?: number }>;
      accountBalance?: number;
      riskPercent?: number;
      discipline?: DisciplineState;
    };

    // If no candles provided, fetch them
    let ltfCandles = candles;
    let htf = htfCandles;
    let mtf = mtfCandles;

    if (!ltfCandles || ltfCandles.length === 0) {
      // Fetch candles from Binance API
      const fetchedCandles = await fetchBinanceCandles(symbol, timeframe, 300);
      if (!fetchedCandles || fetchedCandles.length < 200) {
        return NextResponse.json({
          success: false,
          error: `Insufficient candle data: got ${fetchedCandles?.length || 0}, need 200+`,
          signal: 'WAIT',
        }, { status: 400 });
      }
      ltfCandles = fetchedCandles;
    }

    // If no MTF/HTF candles, try to fetch them
    if (!htf || htf.length === 0) {
      const htfTF = getHTFTimeframe(timeframe);
      if (htfTF) {
        htf = await fetchBinanceCandles(symbol, htfTF, 200).catch(() => undefined);
      }
    }

    if (!mtf || mtf.length === 0) {
      const mtfTF = getMTFTimeframe(timeframe);
      if (mtfTF && mtfTF !== timeframe) {
        mtf = await fetchBinanceCandles(symbol, mtfTF, 200).catch(() => undefined);
      }
    }

    const input: EngineInput = {
      symbol,
      timeframe,
      candles: ltfCandles,
      htfCandles: htf,
      mtfCandles: mtf,
      accountBalance,
      riskPercent,
      discipline,
    };

    const result = runProbabilityEngine(input);

    return NextResponse.json({
      success: true,
      data: result,
      timestamp: Date.now(),
    });

  } catch (error) {
    console.error('[ProbabilityEngine API] Error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      signal: 'WAIT',
    }, { status: 500 });
  }
}

// ─── Helper: Fetch candles from Binance ───

const BINANCE_API = 'https://api.binance.com/api/v3/klines';

async function fetchBinanceCandles(
  symbol: string,
  interval: string,
  limit: number
): Promise<Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }> | undefined> {
  try {
    const url = `${BINANCE_API}?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const res = await fetch(url, { next: { revalidate: 5 } });
    if (!res.ok) return undefined;

    const data = await res.json();
    return data.map((k: (string | number)[]) => ({
      time: Math.floor(Number(k[0]) / 1000),
      open: parseFloat(k[1] as string),
      high: parseFloat(k[2] as string),
      low: parseFloat(k[3] as string),
      close: parseFloat(k[4] as string),
      volume: parseFloat(k[5] as string),
    }));
  } catch {
    return undefined;
  }
}

// ─── Helper: Timeframe mapping ───

function getHTFTimeframe(ltf: string): string | null {
  const map: Record<string, string> = {
    '1m': '1h', '5m': '4h', '15m': '4h', '30m': '1d',
    '1h': '1d', '4h': '1d',
  };
  return map[ltf] || null;
}

function getMTFTimeframe(ltf: string): string | null {
  const map: Record<string, string> = {
    '1m': '15m', '5m': '1h', '15m': '1h', '30m': '4h',
    '1h': '4h',
  };
  return map[ltf] || null;
}
