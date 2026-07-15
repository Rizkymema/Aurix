'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { CandlestickData } from '../chart/types';

const APP_API_KEY = process.env.NEXT_PUBLIC_APP_API_KEY;

/**
 * Trading Signal - Output dari AI Decision Engine
 */
export interface TradingSignal {
  market: string;
  timeframe: string;
  signal: 'BUY' | 'SELL' | 'WAIT';
  entry: number | null;
  stop_loss: number | null;
  take_profit_1: number | null;
  take_profit_2: number | null;
  bot_mode: 'LIVE' | 'DRY_RUN';
  risk_reward: number | null;
  confidence: number;
  timestamp: string;
  reason: string;
}

interface UseTradingSignalOptions {
  symbol: string;
  timeframe: string;
  candles: CandlestickData[];
  botMode: 'live' | 'dry-run';
  aiEnabled: boolean;
  autoRefresh?: boolean;
  refreshInterval?: number; // in ms, default 30000 (30s)
}

interface UseTradingSignalReturn {
  signal: TradingSignal | null;
  isLoading: boolean;
  error: string | null;
  lastFetch: number | null;
  fetchSignal: () => Promise<void>;
}

const DEFAULT_SIGNAL: TradingSignal = {
  market: 'BTCUSDT',
  timeframe: '1h',
  signal: 'WAIT',
  entry: null,
  stop_loss: null,
  take_profit_1: null,
  take_profit_2: null,
  bot_mode: 'DRY_RUN',
  risk_reward: null,
  confidence: 0,
  timestamp: new Date().toISOString(),
  reason: 'Initializing...'
};

/**
 * Hook untuk fetch trading signal dari AI Decision Engine
 */
export function useTradingSignal({
  symbol,
  timeframe,
  candles,
  botMode,
  aiEnabled,
  autoRefresh = true,
  refreshInterval = 30000,
}: UseTradingSignalOptions): UseTradingSignalReturn {
  const [signal, setSignal] = useState<TradingSignal | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<number | null>(null);
  
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchSignal = useCallback(async () => {
    // Need at least 200 candles for proper analysis
    if (candles.length < 50) {
      setSignal({
        ...DEFAULT_SIGNAL,
        market: symbol,
        timeframe,
        bot_mode: botMode === 'live' ? 'LIVE' : 'DRY_RUN',
        reason: `Waiting for data (${candles.length}/200 candles)`
      });
      return;
    }
    
    if (!aiEnabled) {
      setSignal({
        ...DEFAULT_SIGNAL,
        market: symbol,
        timeframe,
        bot_mode: botMode === 'live' ? 'LIVE' : 'DRY_RUN',
        reason: 'AI Analysis is OFF'
      });
      return;
    }
    
    // Cancel previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/bot/signal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(APP_API_KEY ? { 'x-app-api-key': APP_API_KEY } : {}),
        },
        body: JSON.stringify({
          candles,
          symbol,
          timeframe,
          botMode: botMode === 'live' ? 'LIVE' : 'DRY_RUN',
          aiEnabled,
        }),
        signal: abortControllerRef.current.signal,
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data: TradingSignal = await response.json();
      setSignal(data);
      setLastFetch(Date.now());
      
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        // Request was cancelled, ignore
        return;
      }
      
      console.error('[useTradingSignal] Error:', err);
      const errMessage = err instanceof Error ? err.message : 'Failed to fetch signal';
      setError(errMessage);
      setSignal({
        ...DEFAULT_SIGNAL,
        market: symbol,
        timeframe,
        bot_mode: botMode === 'live' ? 'LIVE' : 'DRY_RUN',
        reason: `Error: ${errMessage}`
      });
    } finally {
      setIsLoading(false);
    }
  }, [candles, symbol, timeframe, botMode, aiEnabled]);

  // Fetch on mount and when dependencies change
  useEffect(() => {
    fetchSignal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, timeframe, botMode, aiEnabled]); // Don't include candles to avoid too many fetches
  
  // Auto-refresh interval
  useEffect(() => {
    if (!autoRefresh || !aiEnabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }
    
    intervalRef.current = setInterval(() => {
      fetchSignal();
    }, refreshInterval);
    
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [autoRefresh, aiEnabled, refreshInterval, fetchSignal]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  return {
    signal,
    isLoading,
    error,
    lastFetch,
    fetchSignal,
  };
}

export default useTradingSignal;
