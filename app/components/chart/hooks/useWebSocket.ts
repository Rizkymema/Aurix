'use client';

/**
 * useWebSocket — Robust, disconnect-proof real-time data hook
 *
 * PROBLEMS FIXED:
 *  1. No exponential backoff → now uses backoff 1s → 2s → 4s … → 30s max
 *  2. No heartbeat → now detects dead connections via 20s stall timer
 *  3. No browser visibility awareness → pauses WS when tab hidden, resumes on focus
 *  4. No online/offline awareness → pauses on offline, reconnects on online
 *  5. Unlimited reconnect loops → capped at 50, resets after successful connection
 *  6. Stale closures → all callbacks via stable refs
 *  7. No connection state machine → clear states: CONNECTING / WS_OPEN / POLLING / ERROR
 *  8. Data gaps on reconnect → fetches missed candles before resuming WS
 *  9. REST polling had no error handling → now catches and retries
 * 10. WS onclose didn't re-escalate polling speed → now restores 2s on disconnect
 *
 * Architecture:
 *  1. Fetch historical candles via REST (Binance klines for crypto)
 *  2. Connect to Binance kline WebSocket for live updates
 *  3. CandleStore enforces correct UTC boundaries and immutability
 *  4. REST polling runs as safety net (fast when WS down, slow when WS up)
 *  5. Heartbeat timer detects stale connections and forces reconnect
 *  6. Visibility + Online APIs control pause/resume
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { CandlestickData, Timeframe } from '../types';
import {
  CandleStore,
  parseBinanceKline,
  parseBinanceWsKline,
  TFKey,
  OHLCVCandle,
} from '../../../lib/candleEngine';

// ─── Types ───────────────────────────────────────────────────────────

type ConnectionState = 'idle' | 'connecting' | 'ws_open' | 'polling' | 'reconnecting' | 'error' | 'paused';
type DataFeedStatus = 'realtime' | 'delayed' | 'stale' | 'unavailable';

interface UseWebSocketOptions {
  symbol: string;
  timeframe: Timeframe;
  onMessageAction: (data: CandlestickData) => void;
  onHistoricalDataAction?: (data: CandlestickData[]) => void;
  useUnifiedAPI?: boolean;
}

interface UseWebSocketReturn {
  isConnected: boolean;
  connectionState: ConnectionState;
  error: string | null;
  reconnect: () => void;
  retryCount: number;
  feedStatus: DataFeedStatus;
  dataSource: string | null;
  marketStatus: string | null;
}

interface KlineFetchResult {
  klines: (string | number)[][];
  dataSource: string;
  feedStatus: DataFeedStatus;
  marketStatus?: string | null;
}

// ─── Constants ───────────────────────────────────────────────────────

const BACKOFF_INITIAL_MS = 1000;
const BACKOFF_MAX_MS = 30000;
const BACKOFF_MULTIPLIER = 2;
const MAX_WS_RETRIES = 10;          // WS-specific retries before falling back to polling
const MAX_HISTORICAL_RETRIES = 5;   // Retries for initial data load
const WS_RETRY_RESET_MS = 120000;   // After 2 min of stable polling, allow WS retry again
const WS_CONNECT_TIMEOUT_MS = 8000;
const POLL_FAST_MS = 2000;          // Fast polling for forex (2 sec)
const POLL_SLOW_MS = 30000;         // Slow polling for crypto WebSocket fallback
const POLL_FOREX_MS = 2000;         // Aggressive polling for forex symbols (always fast)
const GAP_FILL_LIMIT = 50;

/** Heartbeat timeout scaled by timeframe — larger TFs have less frequent data. */
const HEARTBEAT_TIMEOUT_BY_TF: Record<string, number> = {
  '1m': 15000,
  '5m': 30000,
  '15m': 60000,
  '30m': 90000,
  '1h': 120000,
  '4h': 300000,
  '1d': 600000,
};
const HEARTBEAT_TIMEOUT_DEFAULT_MS = 30000;

// ─── Helpers ─────────────────────────────────────────────────────────

const toBinanceInterval = (tf: Timeframe): string => {
  const map: Record<Timeframe, string> = {
    '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m',
    '1h': '1h', '4h': '4h', '1d': '1d',
  };
  return map[tf];
};

const isForexSymbol = (symbol: string): boolean =>
  ['XAUUSD', 'XAGUSD', 'EURUSD', 'GBPUSD', 'USDJPY'].includes(symbol.toUpperCase());

const normalizeForexSymbol = (symbol: string): string => {
  const upper = symbol.toUpperCase().replace(/[^A-Z]/g, '');
  if (upper === 'GOLD' || upper === 'XAUUSD') return 'XAUUSD';
  if (upper === 'SILVER' || upper === 'XAGUSD') return 'XAGUSD';
  return upper;
};

const toCandlestickData = (c: OHLCVCandle): CandlestickData => ({
  time: c.time,
  open: c.open,
  high: c.high,
  low: c.low,
  close: c.close,
  volume: c.volume,
});

const BINANCE_ENDPOINTS = [
  '',
  'https://api.binance.com',
  'https://api1.binance.com',
  'https://api2.binance.com',
  'https://api3.binance.com',
  'https://data-api.binance.vision',
];

/**
 * Fetch klines for forex symbols via the dedicated forex API endpoint.
 * This endpoint uses TraderMade, FCS API, TwelveData — sources that
 * match TradingView data much more closely than Yahoo Finance GC=F.
 */
async function fetchForexKlines(
  symbol: string,
  interval: string,
  limit: number,
  signal?: AbortSignal,
  forceFresh: boolean = false,
): Promise<KlineFetchResult> {
  // Try dedicated forex endpoint first (uses TradingView-matching sources)
  try {
    const url = `/api/forex/klines?symbol=${symbol}&interval=${interval}&limit=${limit}${forceFresh ? '&forceFresh=1' : ''}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: signal || AbortSignal.timeout(12000),
    });

    if (res.ok) {
      const data = await res.json();
      const source = res.headers.get('X-Data-Source') || 'forex-api';
      const feedStatus = (res.headers.get('X-Feed-Status') || 'unavailable') as DataFeedStatus;
      const marketStatus = res.headers.get('X-Market-Status');
      if (Array.isArray(data) && data.length > 0) {
        console.log(`[useWebSocket] ✓ Forex data: ${data.length} candles from ${source}`);
        return {
          klines: data,
          dataSource: source,
          feedStatus,
          marketStatus,
        };
      }
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    console.debug('[useWebSocket] Forex endpoint failed, trying binance fallback');
  }

  // Fallback to /api/binance/klines (which also handles forex via Yahoo/TwelveData)
  try {
    const url = `/api/binance/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: signal || AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const source = res.headers.get('X-Data-Source') || 'binance-klines-fallback';
        const feedStatus = (res.headers.get('X-Feed-Status') || 'stale') as DataFeedStatus;
        const marketStatus = res.headers.get('X-Market-Status');
        return {
          klines: data,
          dataSource: source,
          feedStatus,
          marketStatus,
        };
      }
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
  }

  throw new Error(`All forex endpoints failed for ${symbol}`);
}

/** Fetch klines from Binance REST with fallback + timeout. */
async function fetchBinanceKlines(
  symbol: string,
  interval: string,
  limit: number,
  signal?: AbortSignal,
): Promise<KlineFetchResult> {
  let lastError: Error | null = null;

  for (const base of BINANCE_ENDPOINTS) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    try {
      const url = base === ''
        ? `/api/binance/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
        : `${base}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;

      const res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: signal || AbortSignal.timeout(10000),
      });

      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          return {
            klines: data,
            dataSource: base === '' ? (res.headers.get('X-Data-Source') || 'Binance API') : 'Binance API',
            feedStatus: 'realtime',
            marketStatus: null,
          };
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      lastError = err as Error;
    }
  }

  throw lastError || new Error('All Binance endpoints failed');
}

/**
 * Smart fetch: routes forex symbols to the dedicated forex API,
 * crypto symbols to Binance.
 */
async function fetchKlines(
  symbol: string,
  interval: string,
  limit: number,
  signal?: AbortSignal,
  forceFresh: boolean = false,
): Promise<KlineFetchResult> {
  if (isForexSymbol(symbol)) {
    return fetchForexKlines(symbol, interval, limit, signal, forceFresh);
  }
  return fetchBinanceKlines(symbol, interval, limit, signal);
}

/** Calculate backoff delay with jitter. */
function backoffDelay(attempt: number): number {
  const base = Math.min(
    BACKOFF_INITIAL_MS * Math.pow(BACKOFF_MULTIPLIER, attempt),
    BACKOFF_MAX_MS,
  );
  const jitter = base * 0.2 * (Math.random() * 2 - 1);
  return Math.round(base + jitter);
}

// ─── Hook ────────────────────────────────────────────────────────────

export function useWebSocket({
  symbol,
  timeframe,
  onMessageAction,
  onHistoricalDataAction,
  useUnifiedAPI = false,
}: UseWebSocketOptions): UseWebSocketReturn {
  // Connection refs
  const wsRef = useRef<WebSocket | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // CandleStore
  const storeRef = useRef<CandleStore | null>(null);

  // Stable refs
  const symbolRef = useRef(symbol);
  const timeframeRef = useRef(timeframe);
  const onMessageRef = useRef(onMessageAction);
  const onHistoricalDataRef = useRef(onHistoricalDataAction);
  const useUnifiedAPIRef = useRef(useUnifiedAPI);

  // Reconnection state (refs to avoid stale closures)
  const wsRetryCountRef = useRef(0);         // WS-specific retry counter
  const historicalRetryCountRef = useRef(0);  // Historical fetch retry counter
  const isIntentionallyClosed = useRef(false);
  const isPausedRef = useRef(false);
  const connStateRef = useRef<ConnectionState>('idle');
  const wsRetryCooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsGaveUpRef = useRef(false);          // true = WS gave up, using polling only
  
  // ✅ FIX: Race condition protection
  const fetchIdRef = useRef(0);              // Increments on each fetch to detect stale data
  // React state (for UI)
  const [isConnected, setIsConnected] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [feedStatus, setFeedStatus] = useState<DataFeedStatus>('unavailable');
  const [dataSource, setDataSource] = useState<string | null>(null);
  const [marketStatus, setMarketStatus] = useState<string | null>(null);

  // Keep refs in sync
  useEffect(() => { symbolRef.current = symbol; }, [symbol]);
  useEffect(() => { timeframeRef.current = timeframe; }, [timeframe]);
  useEffect(() => { onMessageRef.current = onMessageAction; }, [onMessageAction]);
  useEffect(() => { onHistoricalDataRef.current = onHistoricalDataAction; }, [onHistoricalDataAction]);
  useEffect(() => { useUnifiedAPIRef.current = useUnifiedAPI; }, [useUnifiedAPI]);

  // ── State updater ──

  const setConnState = useCallback((state: ConnectionState) => {
    connStateRef.current = state;
    setConnectionState(state);
    setIsConnected(state === 'ws_open' || state === 'polling');
  }, []);

  const updateFeedMeta = useCallback((meta: Partial<KlineFetchResult> & {
    feedStatus?: DataFeedStatus;
    dataSource?: string;
    marketStatus?: string | null;
  }) => {
    if (meta.feedStatus) setFeedStatus(meta.feedStatus);
    if (meta.dataSource) setDataSource(meta.dataSource);
    if (meta.marketStatus !== undefined) setMarketStatus(meta.marketStatus ?? null);
  }, []);

  // ── Cleanup all timers/connections ──

  const cleanup = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }

    if (wsRef.current) {
      try {
        wsRef.current.onopen = null;
        wsRef.current.onmessage = null;
        wsRef.current.onerror = null;
        wsRef.current.onclose = null;
        wsRef.current.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }

    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }

    if (tickPollingRef.current) {
      clearInterval(tickPollingRef.current);
      tickPollingRef.current = null;
    }

    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    if (heartbeatTimerRef.current) {
      clearTimeout(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }

    if (connectTimeoutRef.current) {
      clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = null;
    }
  }, []);

  // ── Heartbeat: detect stale WS connections ──

  const resetHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current) clearTimeout(heartbeatTimerRef.current);

    const tf = timeframeRef.current;
    const timeout = HEARTBEAT_TIMEOUT_BY_TF[tf] || HEARTBEAT_TIMEOUT_DEFAULT_MS;

    heartbeatTimerRef.current = setTimeout(() => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        console.warn('[useWebSocket] ❤️‍🩹 Heartbeat timeout — no data in', timeout, 'ms, forcing reconnect');
        wsRef.current.close(); // triggers onclose → scheduleReconnect
      }
    }, timeout);
  }, []);

  // ── REST polling ──

  const pollLatest = useCallback(async () => {
    const sym = normalizeForexSymbol(symbolRef.current);
    const tf = timeframeRef.current;
    const store = storeRef.current;
    if (!store || isPausedRef.current) return;

    // ✅ FIX: Capture symbol at start of fetch for race condition detection
    const symbolAtStart = symbolRef.current;
    const fetchId = ++fetchIdRef.current;

    try {
      let rawKlines: (string | number)[][];

      if (useUnifiedAPIRef.current) {
        const tfMap: Record<Timeframe, string> = {
          '1m': 'M1', '5m': 'M5', '15m': 'M15', '30m': 'M30',
          '1h': 'H1', '4h': 'H4', '1d': 'D1',
        };
        const url = `/api/data?action=candles&symbol=${sym.toUpperCase()}&timeframe=${tfMap[tf] || 'H1'}&limit=2`;
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) return;
        rawKlines = await res.json();
        updateFeedMeta({
          feedStatus: 'delayed',
          dataSource: 'Unified API',
          marketStatus: null,
        });
      } else {
        // Use smart routing: forex → /api/forex/klines, crypto → Binance
        const result = await fetchKlines(
          sym.toUpperCase(),
          toBinanceInterval(tf),
          2,
          AbortSignal.timeout(8000),
          true,
        );
        rawKlines = result.klines;
        updateFeedMeta(result);
      }

      // ✅ FIX: Validate BOTH symbol and fetchId to prevent race condition
      if (symbolRef.current !== symbolAtStart || fetchIdRef.current !== fetchId) {
        console.log('[useWebSocket] ⚠️ Symbol changed during poll, discarding data', {
          startSymbol: symbolAtStart,
          currentSymbol: symbolRef.current,
          fetchId,
          currentFetchId: fetchIdRef.current
        });
        return;
      }

      for (const raw of rawKlines) {
        const candle = parseBinanceKline(raw);
        store.processUpdate(candle, true);
      }

      const forming = store.getForming();
      if (forming) {
        onMessageRef.current(toCandlestickData(forming));
      }

      // Clear error state if poll succeeds — polling is working!
      if (connStateRef.current === 'error' || connStateRef.current === 'reconnecting') {
        setConnState('polling');
        setError(null);
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        console.debug('[useWebSocket] Poll cancelled (timeout or symbol changed)');
        return;
      }
      console.debug('[useWebSocket] Poll error (will retry):', (err as Error).message);
    }
  }, [setConnState, updateFeedMeta]);

  // ── Start/adjust polling ──

  const startPolling = useCallback((intervalMs: number) => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    
    // Override: Force fast polling for forex symbols (no slow polling)
    const sym = normalizeForexSymbol(symbolRef.current);
    const finalInterval = isForexSymbol(sym) ? POLL_FOREX_MS : intervalMs;

    console.log(`[useWebSocket] 📡 Polling ${sym} every ${finalInterval}ms ${isForexSymbol(sym) ? '(forex realtime)' : ''}`);
    pollLatest();
    pollingRef.current = setInterval(pollLatest, finalInterval);
  }, [pollLatest]);

  const startForexTickPolling = useCallback((intervalMs: number) => {
    if (tickPollingRef.current) clearInterval(tickPollingRef.current);

    const tick = async () => {
      const sym = normalizeForexSymbol(symbolRef.current);
      const tf = timeframeRef.current;
      const store = storeRef.current;
      if (!store || isPausedRef.current || !isForexSymbol(sym)) return;

      try {
        const res = await fetch(`/api/forex/ticker?symbol=${sym}&interval=${toBinanceInterval(tf)}&forceFresh=1`, {
          signal: AbortSignal.timeout(4000),
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!data?.price || typeof data.price !== 'number') return;
        const price = data.price;

        updateFeedMeta({
          feedStatus: (data.feedStatus || res.headers.get('X-Feed-Status') || 'unavailable') as DataFeedStatus,
          dataSource: data.source || res.headers.get('X-Data-Source') || 'forex-ticker',
          marketStatus: data.marketStatus || res.headers.get('X-Market-Status'),
        });

        const nowSec = Math.floor(Date.now() / 1000);
        const tickCandle: OHLCVCandle = {
          time: nowSec,
          open: price,
          high: price,
          low: price,
          close: price,
          volume: 0,
        };

        const newlyClosed = store.processUpdate(tickCandle, false);
        for (const closed of newlyClosed) {
          onMessageRef.current(toCandlestickData(closed));
        }

        const forming = store.getForming();
        if (forming) {
          onMessageRef.current(toCandlestickData(forming));
        }
      } catch {
        // Ignore transient tick failures
      }
    };

    tick();
    tickPollingRef.current = setInterval(tick, intervalMs);
  }, [updateFeedMeta]);

  const setPollingSpeed = useCallback((intervalMs: number) => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = setInterval(pollLatest, intervalMs);
    }
  }, [pollLatest]);

  // ── Gap fill: fetch recent candles after reconnect ──

  const fillGap = useCallback(async () => {
    const sym = symbolRef.current;
    const tf = timeframeRef.current;
    const store = storeRef.current;
    if (!store) return;

    try {
        const rawKlines = await fetchKlines(
          sym.toUpperCase(),
          toBinanceInterval(tf),
          GAP_FILL_LIMIT,
          AbortSignal.timeout(8000),
          true,
        );
      updateFeedMeta(rawKlines);

      if (symbolRef.current !== sym) return;

      for (const raw of rawKlines.klines) {
        const candle = parseBinanceKline(raw);
        store.processUpdate(candle, true);
      }

      console.log(`[useWebSocket] 🔄 Gap filled: ${rawKlines.klines.length} candles`);
    } catch (err) {
      console.warn('[useWebSocket] Gap fill failed:', (err as Error).message);
    }
  }, [updateFeedMeta]);

  // ── Forward refs for mutual recursion ──
  const connectWSRef = useRef<() => void>(() => {});
  const scheduleReconnectRef = useRef<() => void>(() => {});

  // ── Schedule WS reconnect with exponential backoff ──
  // Key design: WS failure NEVER kills polling. If WS can't connect,
  // we gracefully fall back to polling-only mode and periodically retry WS.

  const scheduleReconnect = useCallback(() => {
    if (isIntentionallyClosed.current || isPausedRef.current) return;

    // WS retries exhausted → fall back to polling-only mode
    if (wsRetryCountRef.current >= MAX_WS_RETRIES) {
      console.warn(
        `[useWebSocket] ⚠️ WS retries exhausted (${MAX_WS_RETRIES}). Falling back to polling-only mode.`,
      );
      wsGaveUpRef.current = true;
      setConnState('polling');
      setError(null); // polling works — no user-visible error

      // Ensure polling is running at a reasonable speed
      startPolling(POLL_FAST_MS);

      // Schedule a WS retry after cooldown period
      if (wsRetryCooldownRef.current) clearTimeout(wsRetryCooldownRef.current);
      wsRetryCooldownRef.current = setTimeout(() => {
        if (isIntentionallyClosed.current) return;
        console.log('[useWebSocket] 🔄 Cooldown elapsed — retrying WS connection');
        wsRetryCountRef.current = 0;
        wsGaveUpRef.current = false;
        setRetryCount(0);
        connectWSRef.current();
      }, WS_RETRY_RESET_MS);

      return;
    }

    const delay = backoffDelay(wsRetryCountRef.current);
    wsRetryCountRef.current += 1;
    setRetryCount(wsRetryCountRef.current);
    setConnState('reconnecting');

    console.log(
      `[useWebSocket] 🔄 Reconnecting WS in ${delay}ms (attempt ${wsRetryCountRef.current}/${MAX_WS_RETRIES})`,
    );

    // Ensure fast polling while WS is reconnecting
    startPolling(POLL_FAST_MS);

    reconnectTimerRef.current = setTimeout(() => {
      connectWSRef.current();
    }, delay);
  }, [setConnState, startPolling]);

  // ── Connect WebSocket ──

  const connectWS = useCallback(() => {
    const sym = normalizeForexSymbol(symbolRef.current);
    const tf = timeframeRef.current;
    const store = storeRef.current;
    if (!store || isPausedRef.current) return;

    // Forex → polling only (no Binance WebSocket available)
    // XAUUSD gets aggressive realtime updates (1s tick + 2s candle polling)
    if (isForexSymbol(sym)) {
      const isGold = sym === 'XAUUSD';
      const forexPollMs = isGold ? 2000 : (tf === '1m' ? 3000 : tf === '5m' ? 5000 : 10000);
      const tickIntervalMs = isGold ? 1000 : 2000; // XAUUSD: 1s ticks, others: 2s ticks
      
      console.log(`[useWebSocket] ${sym} is forex — REST polling ${forexPollMs}ms + tick polling ${tickIntervalMs}ms ${isGold ? '(GOLD REALTIME)' : ''}`);
      updateFeedMeta({
        feedStatus: 'delayed',
        dataSource: 'Forex polling',
        marketStatus: null,
      });
      startPolling(forexPollMs);
      // Tick-level updates for forming candle (realtime price via GoldPrice.org for XAUUSD)
      startForexTickPolling(tickIntervalMs);
      setConnState('polling');
      return;
    }

    // Close previous WS cleanly
    if (wsRef.current) {
      try {
        wsRef.current.onopen = null;
        wsRef.current.onmessage = null;
        wsRef.current.onerror = null;
        wsRef.current.onclose = null;
        wsRef.current.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }

    const interval = toBinanceInterval(tf);
    const wsUrl = `wss://stream.binance.com:9443/ws/${sym.toLowerCase()}@kline_${interval}`;

    setConnState('connecting');

    try {
      const ws = new WebSocket(wsUrl);

      // Connection timeout
      connectTimeoutRef.current = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          console.warn('[useWebSocket] ⏱️ WS connect timeout');
          try { ws.close(); } catch { /* ignore */ }
          if (connStateRef.current !== 'ws_open') {
            scheduleReconnectRef.current();
          }
        }
      }, WS_CONNECT_TIMEOUT_MS);

      ws.onopen = () => {
        if (connectTimeoutRef.current) {
          clearTimeout(connectTimeoutRef.current);
          connectTimeoutRef.current = null;
        }

        console.log(`[useWebSocket] ✅ WS connected: ${sym}@kline_${interval}`);

        // Reset WS retries on success
        wsRetryCountRef.current = 0;
        wsGaveUpRef.current = false;
        setRetryCount(0);
        setConnState('ws_open');
        setError(null);
        updateFeedMeta({
          feedStatus: 'realtime',
          dataSource: 'Binance WebSocket',
          marketStatus: null,
        });

        // Cancel any WS retry cooldown timer
        if (wsRetryCooldownRef.current) {
          clearTimeout(wsRetryCooldownRef.current);
          wsRetryCooldownRef.current = null;
        }

        // Slow polling → reconciliation mode
        setPollingSpeed(POLL_SLOW_MS);

        // Fill any data gap
        fillGap();

        // Start heartbeat
        resetHeartbeat();
      };

      ws.onmessage = (event) => {
        // Reset heartbeat on every message
        resetHeartbeat();

        try {
          const data = JSON.parse(event.data);
          if (!data.k) return;
          if (normalizeForexSymbol(symbolRef.current) !== sym) return;

          const { candle, isClosed } = parseBinanceWsKline(data.k);
          const newlyClosed = store.processUpdate(candle, true);

          for (const closed of newlyClosed) {
            onMessageRef.current(toCandlestickData(closed));
          }

          if (!isClosed) {
            onMessageRef.current(toCandlestickData(candle));
          }
        } catch (err) {
          console.error('[useWebSocket] WS parse error:', err);
        }
      };

      ws.onerror = () => {
        if (connectTimeoutRef.current) {
          clearTimeout(connectTimeoutRef.current);
          connectTimeoutRef.current = null;
        }
        console.warn('[useWebSocket] ⚠️ WS error');
      };

      ws.onclose = (event) => {
        if (connectTimeoutRef.current) {
          clearTimeout(connectTimeoutRef.current);
          connectTimeoutRef.current = null;
        }
        if (heartbeatTimerRef.current) {
          clearTimeout(heartbeatTimerRef.current);
          heartbeatTimerRef.current = null;
        }

        console.log(
          `[useWebSocket] 🔌 WS closed (code=${event.code}, reason=${event.reason || 'none'})`,
        );

        // Only reconnect if this is still the active WS and not intentional
        if (wsRef.current === ws && !isIntentionallyClosed.current && symbolRef.current === sym) {
          startPolling(POLL_FAST_MS);
          scheduleReconnectRef.current();
        }
      };

      wsRef.current = ws;
    } catch (err) {
      console.error('[useWebSocket] WS creation failed:', err);
      scheduleReconnectRef.current();
    }
  }, [startPolling, setPollingSpeed, setConnState, fillGap, resetHeartbeat, startForexTickPolling, updateFeedMeta]);

  // Keep forward refs in sync
  useEffect(() => { connectWSRef.current = connectWS; }, [connectWS]);
  useEffect(() => { scheduleReconnectRef.current = scheduleReconnect; }, [scheduleReconnect]);

  // ── Fetch historical data ──

  const fetchHistorical = useCallback(async (): Promise<boolean> => {
    const sym = normalizeForexSymbol(symbolRef.current);
    const tf = timeframeRef.current;
    
    // ✅ FIX: Capture symbol at start for race condition detection
    const symbolAtStart = symbolRef.current;
    const fetchId = ++fetchIdRef.current;

    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    try {
      let rawKlines: (string | number)[][];

      if (useUnifiedAPIRef.current) {
        const tfMap: Record<Timeframe, string> = {
          '1m': 'M1', '5m': 'M5', '15m': 'M15', '30m': 'M30',
          '1h': 'H1', '4h': 'H4', '1d': 'D1',
        };
        const url = `/api/data?action=candles&symbol=${sym.toUpperCase()}&timeframe=${tfMap[tf] || 'H1'}&limit=500`;
        const res = await fetch(url, { signal });
        if (!res.ok) throw new Error(`Unified API ${res.status}`);
        rawKlines = await res.json();
        updateFeedMeta({
          feedStatus: 'delayed',
          dataSource: 'Unified API',
          marketStatus: null,
        });
      } else {
        // Smart routing: forex → /api/forex/klines, crypto → Binance
        const result = await fetchKlines(
          sym.toUpperCase(),
          toBinanceInterval(tf),
          500,
          signal,
        );
        rawKlines = result.klines;
        updateFeedMeta(result);
      }

      // ✅ FIX: Validate symbol AND fetchId before processing data
      if (signal.aborted) {
        console.log('[useWebSocket] Fetch aborted');
        return false;
      }
      
      if (symbolRef.current !== symbolAtStart || fetchIdRef.current !== fetchId) {
        console.log('[useWebSocket] ⚠️ Symbol changed during historical fetch, discarding data', {
          startSymbol: symbolAtStart,
          currentSymbol: symbolRef.current,
          fetchId,
          currentFetchId: fetchIdRef.current
        });
        return false;
      }

      const candles: OHLCVCandle[] = rawKlines.map(parseBinanceKline);

      const store = new CandleStore(tf as TFKey);
      store.loadHistorical(candles);
      storeRef.current = store;

      const all = store.getAllCandles().map(toCandlestickData);
      console.log(`[useWebSocket] ✅ Loaded ${all.length} candles for ${sym}/${tf}`);
      onHistoricalDataRef.current?.(all);

      return true;
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        console.log('[useWebSocket] Historical fetch aborted');
        return false;
      }
      console.error('[useWebSocket] Historical fetch failed:', err);
      setError('Failed to load data. Retrying…');
      return false;
    }
  }, [updateFeedMeta]);

  // ── Main connect flow ──

  const connect = useCallback(async () => {
    isIntentionallyClosed.current = false;
    isPausedRef.current = false;
    cleanup();

    setConnState('connecting');

    const success = await fetchHistorical();
    if (!success) {
      // Retry historical fetch with backoff
      if (historicalRetryCountRef.current >= MAX_HISTORICAL_RETRIES) {
        console.error('[useWebSocket] ❌ Failed to load historical data after max retries.');
        setConnState('error');
        setError('Failed to load chart data. Click Reconnect to try again.');
        return;
      }

      const delay = backoffDelay(historicalRetryCountRef.current);
      historicalRetryCountRef.current += 1;
      setRetryCount(historicalRetryCountRef.current);

      console.log(`[useWebSocket] Retrying historical fetch in ${delay}ms (attempt ${historicalRetryCountRef.current}/${MAX_HISTORICAL_RETRIES})`);

      reconnectTimerRef.current = setTimeout(() => {
        connect();
      }, delay);
      return;
    }

    // Reset retry counters on success
    historicalRetryCountRef.current = 0;
    wsRetryCountRef.current = 0;
    wsGaveUpRef.current = false;
    setRetryCount(0);

    // Start fast polling immediately
    startPolling(POLL_FAST_MS);
    setConnState('polling');

    // Connect WebSocket (upgrades to ws_open + slow polling)
    connectWSRef.current();
  }, [cleanup, fetchHistorical, startPolling, setConnState]);

  // ── User-triggered reconnect ──

  const reconnect = useCallback(() => {
    console.log('[useWebSocket] 🔁 Manual reconnect triggered');
    wsRetryCountRef.current = 0;
    historicalRetryCountRef.current = 0;
    wsGaveUpRef.current = false;
    setRetryCount(0);
    cleanup();
    if (wsRetryCooldownRef.current) {
      clearTimeout(wsRetryCooldownRef.current);
      wsRetryCooldownRef.current = null;
    }
    storeRef.current?.clear();
    storeRef.current = null;
    setError(null);
    connect();
  }, [cleanup, connect]);

  // ── Visibility change: pause when hidden, resume when visible ──

  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        isPausedRef.current = true;

        if (tickPollingRef.current) {
          clearInterval(tickPollingRef.current);
          tickPollingRef.current = null;
        }

        // Stop heartbeat (server may close WS naturally)
        if (heartbeatTimerRef.current) {
          clearTimeout(heartbeatTimerRef.current);
          heartbeatTimerRef.current = null;
        }

        // Slow polling
        setPollingSpeed(POLL_SLOW_MS);
        setConnState('paused');
        console.log('[useWebSocket] ⏸️ Tab hidden — paused');
      } else {
        isPausedRef.current = false;
        console.log('[useWebSocket] ▶️ Tab visible — resuming');

        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          // WS still alive
          resetHeartbeat();
          fillGap();
          setPollingSpeed(POLL_SLOW_MS);
          setConnState('ws_open');
        } else {
          // WS died while hidden → reconnect
          wsRetryCountRef.current = 0;
          wsGaveUpRef.current = false;
          startPolling(POLL_FAST_MS);
          connectWSRef.current();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [resetHeartbeat, fillGap, startPolling, setPollingSpeed, setConnState]);

  // ── Online/Offline events ──

  useEffect(() => {
    const handleOnline = () => {
      console.log('[useWebSocket] 🌐 Browser online — reconnecting');
      isPausedRef.current = false;
      wsRetryCountRef.current = 0;
      wsGaveUpRef.current = false;
      setRetryCount(0);
      setError(null);

      startPolling(POLL_FAST_MS);
      fillGap();
      connectWSRef.current();
    };

    const handleOffline = () => {
      console.log('[useWebSocket] 📡 Browser offline — pausing');
      isPausedRef.current = true;
      setConnState('error');
      setError('Network offline. Waiting for connection…');

      if (tickPollingRef.current) {
        clearInterval(tickPollingRef.current);
        tickPollingRef.current = null;
      }

      if (wsRef.current) {
        try { wsRef.current.close(); } catch { /* ignore */ }
        wsRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [startPolling, fillGap, setConnState]);

  // ── Main effect: connect on symbol/timeframe change ──

  useEffect(() => {
    console.log(`[useWebSocket] 🔄 ${symbol}/${timeframe} — connecting...`);

    isIntentionallyClosed.current = true;
    cleanup();
    if (wsRetryCooldownRef.current) {
      clearTimeout(wsRetryCooldownRef.current);
      wsRetryCooldownRef.current = null;
    }
    storeRef.current = null;
    wsRetryCountRef.current = 0;
    historicalRetryCountRef.current = 0;
    wsGaveUpRef.current = false;
    setRetryCount(0);
    setIsConnected(false);
    setError(null);
    setFeedStatus('unavailable');
    setDataSource(null);
    setMarketStatus(null);
    setConnState('idle');

    const delay = setTimeout(() => {
      connect();
    }, 50);

    return () => {
      clearTimeout(delay);
      isIntentionallyClosed.current = true;
      cleanup();
    };
  }, [symbol, timeframe]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cleanup on unmount ──

  useEffect(() => {
    return () => {
      isIntentionallyClosed.current = true;
      cleanup();
      if (wsRetryCooldownRef.current) {
        clearTimeout(wsRetryCooldownRef.current);
        wsRetryCooldownRef.current = null;
      }
    };
  }, [cleanup]);

  return {
    isConnected,
    connectionState,
    error,
    reconnect,
    retryCount,
    feedStatus,
    dataSource,
    marketStatus,
  };
}
