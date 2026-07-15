import { NextRequest, NextResponse } from 'next/server';
import {
  fetchForexCandles,
  fetchSpotPrice,
  isForexSymbol,
  isTraderMadeConfigured,
  type ForexInterval,
} from '@/app/services/forexDataProvider';
import { validateForexExecutionReadiness } from '@/app/lib/forexExecutionGuard';
import { getMt5AccountInfo, isMt5BridgeConfigured } from '@/app/lib/mt5Bridge';

function normalizeForexSymbol(raw: string): string {
  const upper = raw.toUpperCase().replace(/[^A-Z]/g, '');
  if (upper === 'GOLD' || upper === 'XAUUSD') return 'XAUUSD';
  if (upper === 'SILVER' || upper === 'XAGUSD') return 'XAGUSD';
  return upper;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const symbol = normalizeForexSymbol(params.get('symbol') || 'XAUUSD');
  const interval = (params.get('interval') || '1m') as ForexInterval;

  if (!isForexSymbol(symbol)) {
    return NextResponse.json(
      { error: `${symbol} is not a supported forex symbol.` },
      { status: 400 },
    );
  }

  const [spot, candles, guard, mt5Account] = await Promise.all([
    fetchSpotPrice(symbol).catch(() => null),
    fetchForexCandles(symbol, interval, '5').catch(() => null),
    validateForexExecutionReadiness(symbol),
    getMt5AccountInfo().catch(() => null),
  ]);

  const latestCandle = candles?.data?.length
    ? candles.data[candles.data.length - 1]
    : null;

  return NextResponse.json({
    symbol,
    interval,
    traderMadeConfigured: isTraderMadeConfigured(),
    mt5: {
      bridgeConfigured: isMt5BridgeConfigured(),
      connected: mt5Account?.terminal.connected ?? false,
      tradeAllowed: mt5Account?.terminal.trade_allowed ?? false,
    },
    executionGuard: guard,
    spot: spot ? {
      source: spot.source,
      price: spot.price,
      isRealtime: spot.isRealtime,
    } : null,
    candles: candles ? {
      source: candles.source,
      isRealData: candles.isRealData,
      count: candles.data.length,
      latestClose: latestCandle ? Number(latestCandle[4]) : null,
    } : null,
    checkedAt: new Date().toISOString(),
  }, {
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}
