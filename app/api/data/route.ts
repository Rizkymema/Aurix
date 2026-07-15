/**
 * UNIFIED DATA API
 * 
 * A streamlined API endpoint that uses the UnifiedDataEngine
 * for consistent data fetching across all symbols and timeframes.
 * 
 * Endpoints:
 * - GET /api/data/candles?symbol=BTCUSDT&timeframe=H1&limit=200
 * - GET /api/data/price?symbol=XAUUSD
 * - GET /api/data/analysis?symbol=BTCUSDT
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDataEngine, Timeframe, TIMEFRAME_CONFIG } from '../../lib/dataEngine';

// Map incoming interval strings to our Timeframe type
function mapToTimeframe(interval: string): Timeframe {
  const map: Record<string, Timeframe> = {
    '1m': 'M1',
    '5m': 'M5',
    '15m': 'M15',
    '30m': 'M30',
    '1h': 'H1',
    '4h': 'H4',
    '1d': 'D1',
    // Also accept our format directly
    'M1': 'M1',
    'M5': 'M5',
    'M15': 'M15',
    'M30': 'M30',
    'H1': 'H1',
    'H4': 'H4',
    'D1': 'D1',
  };
  return map[interval] || 'H1';
}

// Convert our AggregatedCandle to Binance-compatible format
function toBinanceFormat(candle: {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timeframe: Timeframe;
}): (string | number)[] {
  const tfSeconds = TIMEFRAME_CONFIG[candle.timeframe].seconds * 1000;
  return [
    candle.timestamp * 1000, // Open time (ms)
    candle.open.toString(),
    candle.high.toString(),
    candle.low.toString(),
    candle.close.toString(),
    candle.volume.toString(),
    candle.timestamp * 1000 + tfSeconds, // Close time (ms)
    '0', // Quote asset volume
    0,   // Number of trades
    '0', // Taker buy base asset volume
    '0', // Taker buy quote asset volume
    '0'  // Ignore
  ];
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const action = searchParams.get('action') || 'candles';
  const symbolRaw = searchParams.get('symbol') || 'BTCUSDT';
  const interval = searchParams.get('interval') || searchParams.get('timeframe') || '1h';
  const limitRaw = searchParams.get('limit') || '200';

  // ✅ SECURITY: Validate and sanitize query parameters
  
  // Validate symbol (alphanumeric only, max 20 chars)
  const symbol = symbolRaw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
  if (!symbol || symbol.length < 3) {
    return NextResponse.json(
      { error: 'Invalid symbol parameter', details: 'Symbol must be 3-20 alphanumeric characters' },
      { status: 400 }
    );
  }

  // Validate limit (1-1000 range)
  const limitParsed = parseInt(limitRaw, 10);
  if (isNaN(limitParsed)) {
    return NextResponse.json(
      { error: 'Invalid limit parameter', details: 'Limit must be a number' },
      { status: 400 }
    );
  }
  const limit = Math.min(Math.max(limitParsed, 1), 1000);  // Clamp between 1-1000

  // Validate interval/timeframe
  const validIntervals = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', 'M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];
  if (!validIntervals.includes(interval)) {
    return NextResponse.json(
      { error: 'Invalid timeframe parameter', details: `Must be one of: ${validIntervals.join(', ')}` },
      { status: 400 }
    );
  }

  const engine = getDataEngine();

  try {
    switch (action) {
      case 'candles': {
        const timeframe = mapToTimeframe(interval);
        const { candles, source, integrity, useM1Aggregation } = await engine.getCandles(
          symbol.toUpperCase(),
          timeframe,
          limit
        );

        // Convert to Binance-compatible format for chart compatibility
        const binanceFormat = candles.map(c => toBinanceFormat(c));

        return NextResponse.json(binanceFormat, {
          headers: {
            'X-Data-Source': source,
            'X-Total-Candles': candles.length.toString(),
            'X-Data-Integrity': integrity.isValid ? 'valid' : 'issues-detected',
            'X-Missing-Candles': integrity.missingCandles.toString(),
            'X-M1-Aggregation': useM1Aggregation.toString(),
            'X-Last-Price': candles.length > 0 ? candles[candles.length - 1].close.toString() : '0',
            'Cache-Control': 'public, s-maxage=5, stale-while-revalidate=10',
          },
        });
      }

      case 'price': {
        const priceData = await engine.getSpotPrice(symbol.toUpperCase());

        if (!priceData) {
          return NextResponse.json(
            { error: 'Failed to fetch price', symbol },
            { status: 500 }
          );
        }

        return NextResponse.json({
          symbol: symbol.toUpperCase(),
          price: priceData.price,
          source: priceData.source,
          timestamp: priceData.timestamp,
        }, {
          headers: {
            'X-Data-Source': priceData.source,
            'Cache-Control': 'public, s-maxage=1, stale-while-revalidate=5',
          },
        });
      }

      case 'analysis': {
        const analysis = await engine.analyzeMultiTimeframe(symbol.toUpperCase());

        return NextResponse.json({
          symbol: analysis.symbol,
          bias: analysis.bias,
          alignmentScore: analysis.alignmentScore,
          trends: analysis.trends,
          keyLevels: analysis.keyLevels.slice(0, 5), // Top 5 levels
          analysisTime: analysis.analysisTime,
        }, {
          headers: {
            'X-Bias-Direction': analysis.bias.direction,
            'X-Alignment-Score': analysis.alignmentScore.toString(),
            'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
          },
        });
      }

      case 'verify': {
        // Verification endpoint - compare data integrity
        const timeframe = mapToTimeframe(interval);
        const { candles, integrity } = await engine.getCandles(
          symbol.toUpperCase(),
          timeframe,
          limit
        );

        const lastPrice = candles.length > 0 ? candles[candles.length - 1].close : 0;
        const spotPrice = await engine.getSpotPrice(symbol.toUpperCase());

        // Calculate price deviation
        const priceDeviation = spotPrice 
          ? Math.abs((lastPrice - spotPrice.price) / spotPrice.price) * 100
          : null;

        return NextResponse.json({
          symbol: symbol.toUpperCase(),
          timeframe,
          candleCount: candles.length,
          integrity: {
            isValid: integrity.isValid,
            missingCandles: integrity.missingCandles,
            duplicateCandles: integrity.duplicateCandles,
            priceGaps: integrity.priceGaps.length,
            abnormalSpikes: integrity.abnormalSpikes.length,
            issues: integrity.issues.slice(0, 5), // Top 5 issues
          },
          priceCheck: {
            lastCandleClose: lastPrice,
            spotPrice: spotPrice?.price || null,
            spotSource: spotPrice?.source || null,
            deviationPercent: priceDeviation?.toFixed(2) || null,
            isAligned: priceDeviation !== null ? priceDeviation < 0.5 : null,
          },
          checkedAt: Date.now(),
        }, {
          headers: {
            'Cache-Control': 'no-store',
          },
        });
      }

      default:
        return NextResponse.json(
          { error: 'Unknown action', validActions: ['candles', 'price', 'analysis', 'verify'] },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('[UnifiedData API] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: (error as Error).message },
      { status: 500 }
    );
  }
}
