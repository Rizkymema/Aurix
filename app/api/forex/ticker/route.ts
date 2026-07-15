import { NextRequest, NextResponse } from 'next/server';
import {
  fetchForexCandles,
  fetchSpotPrice,
  isTraderMadeConfigured,
  isForexSymbol,
  type ForexInterval,
} from '@/app/services/forexDataProvider';

interface SpotCacheEntry {
  price: number;
  source: string;
  timestamp: number;
  feedStatus: 'realtime' | 'delayed' | 'stale';
}

const spotCache = new Map<string, SpotCacheEntry>();
const SPOT_CACHE_OPEN_TTL_MS = 5_000;
const SPOT_CACHE_CLOSED_TTL_MS = 60_000;

function normalizeForexSymbol(raw: string): string {
  const upper = raw.toUpperCase().replace(/[^A-Z]/g, '');
  if (upper === 'GOLD' || upper === 'XAUUSD') return 'XAUUSD';
  if (upper === 'SILVER' || upper === 'XAGUSD') return 'XAGUSD';
  return upper;
}

function isForexMarketOpen(): { isOpen: boolean; status: string } {
  const now = new Date();
  const nyTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = nyTime.getDay();
  const hour = nyTime.getHours();
  const minute = nyTime.getMinutes();
  const timeInMinutes = hour * 60 + minute;

  if (day === 6) return { isOpen: false, status: 'CLOSED (Weekend)' };
  if (day === 0) return { isOpen: timeInMinutes >= 17 * 60, status: timeInMinutes >= 17 * 60 ? 'OPEN' : 'CLOSED (Opens later)' };
  if (day === 5 && timeInMinutes >= 17 * 60) return { isOpen: false, status: 'CLOSED (Weekend)' };

  return { isOpen: true, status: 'OPEN' };
}

function deriveSpotFeedStatus(
  source: string,
  isRealtime: boolean,
  marketOpen: boolean,
): 'realtime' | 'delayed' | 'stale' {
  if (!marketOpen) return 'stale';
  if (isRealtime && (source.toLowerCase().includes('tradermade') || source.toLowerCase().startsWith('mt5-bridge:'))) return 'realtime';
  return 'delayed';
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const symbol = normalizeForexSymbol(params.get('symbol') || 'XAUUSD');
  const interval = (params.get('interval') || '1m') as ForexInterval;
  const forceFresh = params.get('forceFresh') === '1';

  if (!isForexSymbol(symbol)) {
    return NextResponse.json(
      { error: `${symbol} is not a forex symbol.` },
      { status: 400 }
    );
  }

  const market = isForexMarketOpen();
  const cacheTtl = market.isOpen ? SPOT_CACHE_OPEN_TTL_MS : SPOT_CACHE_CLOSED_TTL_MS;

  try {
    const cached = spotCache.get(symbol);
    if (!forceFresh && cached && Date.now() - cached.timestamp <= cacheTtl) {
      return NextResponse.json({
        symbol,
        price: cached.price,
        source: `${cached.source} (cached)`,
        timestamp: cached.timestamp,
        isMarketOpen: market.isOpen,
        marketStatus: market.status,
        isStale: cached.feedStatus !== 'realtime',
        feedStatus: cached.feedStatus,
        primaryProvider: 'TraderMade',
        primaryProviderConfigured: isTraderMadeConfigured(),
      }, {
        headers: {
          'Cache-Control': 'no-store',
          'X-Data-Source': `${cached.source} (cached)`,
          'X-Market-Status': market.status,
          'X-Feed-Status': cached.feedStatus,
          'X-Spot-Stale': cached.feedStatus === 'realtime' ? 'false' : 'true',
          'X-Primary-Provider': 'TraderMade',
        },
      });
    }

    const spot = await fetchSpotPrice(symbol);
    if (!spot) {
      let fallbackPrice: number | null = null;

      try {
        const fallback = await fetchForexCandles(symbol, interval, '2');
        if (fallback.data.length > 0) {
          const last = fallback.data[fallback.data.length - 1];
          const close = parseFloat(String(last[4]));
          if (!Number.isNaN(close) && close > 0) fallbackPrice = close;
        }
      } catch {
        // Ignore fallback errors
      }

      if (fallbackPrice !== null) {
        spotCache.set(symbol, {
          price: fallbackPrice,
          source: 'forex-klines-fallback',
          timestamp: Date.now(),
          feedStatus: market.isOpen ? 'delayed' : 'stale',
        });

        return NextResponse.json({
          symbol,
          price: fallbackPrice,
          source: 'forex-klines-fallback',
          timestamp: Date.now(),
          isMarketOpen: market.isOpen,
          marketStatus: market.status,
          isStale: true,
          feedStatus: market.isOpen ? 'delayed' : 'stale',
          primaryProvider: 'TraderMade',
          primaryProviderConfigured: isTraderMadeConfigured(),
        }, {
          headers: {
            'Cache-Control': 'no-store',
            'X-Data-Source': 'forex-klines-fallback',
            'X-Market-Status': market.status,
            'X-Feed-Status': market.isOpen ? 'delayed' : 'stale',
            'X-Spot-Stale': 'true',
            'X-Primary-Provider': 'TraderMade',
          },
        });
      }

      if (cached && Date.now() - cached.timestamp <= cacheTtl) {
        return NextResponse.json({
          symbol,
          price: cached.price,
          source: `${cached.source} (cached)`,
          timestamp: cached.timestamp,
          isMarketOpen: market.isOpen,
          marketStatus: market.status,
          isStale: true,
          feedStatus: cached.feedStatus,
          primaryProvider: 'TraderMade',
          primaryProviderConfigured: isTraderMadeConfigured(),
        }, {
          headers: {
            'Cache-Control': 'no-store',
            'X-Data-Source': `${cached.source} (cached)`,
            'X-Market-Status': market.status,
            'X-Feed-Status': cached.feedStatus,
            'X-Spot-Stale': 'true',
            'X-Primary-Provider': 'TraderMade',
          },
        });
      }

      return NextResponse.json(
        {
          error: 'No spot price available',
          symbol,
          marketStatus: market.status,
          primaryProvider: 'TraderMade',
          primaryProviderConfigured: isTraderMadeConfigured(),
        },
        { status: 503 },
      );
    }

    const feedStatus = deriveSpotFeedStatus(spot.source, spot.isRealtime, market.isOpen);

    spotCache.set(symbol, {
      price: spot.price,
      source: spot.source,
      timestamp: Date.now(),
      feedStatus,
    });

    return NextResponse.json({
      symbol,
      price: spot.price,
      source: spot.source,
      timestamp: Date.now(),
      isMarketOpen: market.isOpen,
      marketStatus: market.status,
      isStale: feedStatus !== 'realtime',
      feedStatus,
      primaryProvider: 'TraderMade',
      primaryProviderConfigured: isTraderMadeConfigured(),
    }, {
      headers: {
        'Cache-Control': 'no-store',
        'X-Data-Source': spot.source,
        'X-Market-Status': market.status,
        'X-Feed-Status': feedStatus,
        'X-Spot-Stale': feedStatus === 'realtime' ? 'false' : 'true',
        'X-Primary-Provider': 'TraderMade',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to fetch spot price', detail: (err as Error).message },
      { status: 500 }
    );
  }
}
