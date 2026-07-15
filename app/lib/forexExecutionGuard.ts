import {
  fetchSpotPrice,
  isForexSymbol,
  isTraderMadeConfigured,
} from '@/app/services/forexDataProvider';

export interface ForexExecutionGuardResult {
  allowed: boolean;
  symbol: string;
  feedStatus: 'realtime' | 'delayed' | 'stale' | 'unavailable';
  source: string | null;
  reason: string | null;
  marketStatus: string;
  traderMadeConfigured: boolean;
}

function getForexMarketStatus(): { isOpen: boolean; status: string } {
  const now = new Date();
  const nyTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = nyTime.getDay();
  const hour = nyTime.getHours();
  const minute = nyTime.getMinutes();
  const timeInMinutes = hour * 60 + minute;

  if (day === 6) return { isOpen: false, status: 'CLOSED (Weekend)' };
  if (day === 0) {
    return {
      isOpen: timeInMinutes >= 17 * 60,
      status: timeInMinutes >= 17 * 60 ? 'OPEN' : 'CLOSED (Opens later)',
    };
  }
  if (day === 5 && timeInMinutes >= 17 * 60) {
    return { isOpen: false, status: 'CLOSED (Weekend)' };
  }

  return { isOpen: true, status: 'OPEN' };
}

export async function validateForexExecutionReadiness(symbol: string): Promise<ForexExecutionGuardResult> {
  const normalized = symbol.toUpperCase();
  const market = getForexMarketStatus();
  const traderMadeConfigured = isTraderMadeConfigured();

  if (!isForexSymbol(normalized)) {
    return {
      allowed: true,
      symbol: normalized,
      feedStatus: 'realtime',
      source: 'non-forex',
      reason: null,
      marketStatus: market.status,
      traderMadeConfigured,
    };
  }

  if (!market.isOpen) {
    return {
      allowed: false,
      symbol: normalized,
      feedStatus: 'stale',
      source: null,
      reason: 'Forex market is closed',
      marketStatus: market.status,
      traderMadeConfigured,
    };
  }

  const spot = await fetchSpotPrice(normalized);
  if (!spot) {
    return {
      allowed: false,
      symbol: normalized,
      feedStatus: 'unavailable',
      source: null,
      reason: 'No live forex spot price available',
      marketStatus: market.status,
      traderMadeConfigured,
    };
  }

  const isApprovedRealtimeSource =
    spot.isRealtime &&
    (spot.source === 'TraderMade-live' || spot.source.startsWith('MT5-bridge:'));

  if (!isApprovedRealtimeSource) {
    return {
      allowed: false,
      symbol: normalized,
      feedStatus: spot.isRealtime ? 'delayed' : 'stale',
      source: spot.source,
      reason: `Primary live feed unavailable, current source is ${spot.source}`,
      marketStatus: market.status,
      traderMadeConfigured,
    };
  }

  return {
    allowed: true,
    symbol: normalized,
    feedStatus: 'realtime',
    source: spot.source,
    reason: null,
    marketStatus: market.status,
    traderMadeConfigured,
  };
}
