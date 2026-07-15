/**
 * PROBABILITY ENGINE — React Hook
 * =================================
 * 
 * useProbabilityEngine() — Main hook for UI integration.
 * Manages engine state, auto-refresh, and discipline tracking.
 * 
 * Usage:
 *   const { output, loading, refresh } = useProbabilityEngine({
 *     symbol: 'BTCUSDT',
 *     timeframe: '15m',
 *     candles: [...],
 *   });
 */

'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type {
  EngineOutput,
  EngineInput,
  DisciplineState,
} from '@/app/lib/probabilityEngine';
import {
  runProbabilityEngine,
  createDisciplineState,
  recordTradeResult,
} from '@/app/lib/probabilityEngine';

// ─── Config ───

export interface ProbabilityEngineConfig {
  symbol: string;
  timeframe: string;
  candles: Array<{ time: number; open: number; high: number; low: number; close: number; volume?: number }>;
  htfCandles?: Array<{ time: number; open: number; high: number; low: number; close: number; volume?: number }>;
  mtfCandles?: Array<{ time: number; open: number; high: number; low: number; close: number; volume?: number }>;
  accountBalance?: number;
  riskPercent?: number;
  autoRefreshMs?: number;  // 0 = disabled
  useAPI?: boolean;        // Use API route instead of local engine
}

// ─── Return type ───

export interface ProbabilityEngineReturn {
  output: EngineOutput | null;
  loading: boolean;
  error: string | null;
  lastUpdate: number;
  discipline: DisciplineState;
  refresh: () => void;
  recordWin: () => void;
  recordLoss: () => void;
  resetDiscipline: () => void;
}

// ─── Hook ───

export function useProbabilityEngine(config: ProbabilityEngineConfig): ProbabilityEngineReturn {
  const [output, setOutput] = useState<EngineOutput | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState(0);
  const [discipline, setDiscipline] = useState<DisciplineState>(createDisciplineState);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const configRef = useRef(config);
  configRef.current = config;

  const runEngine = useCallback(async () => {
    const cfg = configRef.current;
    if (!cfg.candles || cfg.candles.length < 50) {
      setError('Insufficient candle data');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      if (cfg.useAPI) {
        // Use API route (server-side, can fetch MTF/HTF data)
        const res = await fetch('/api/probability-engine', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol: cfg.symbol,
            timeframe: cfg.timeframe,
            candles: cfg.candles,
            htfCandles: cfg.htfCandles,
            mtfCandles: cfg.mtfCandles,
            accountBalance: cfg.accountBalance || 10000,
            riskPercent: cfg.riskPercent || 1,
            discipline,
          }),
        });

        const data = await res.json();
        if (data.success && data.data) {
          setOutput(data.data);
          setLastUpdate(Date.now());
        } else {
          setError(data.error || 'API error');
        }
      } else {
        // Run locally (faster, no network)
        const input: EngineInput = {
          symbol: cfg.symbol,
          timeframe: cfg.timeframe,
          candles: cfg.candles,
          htfCandles: cfg.htfCandles,
          mtfCandles: cfg.mtfCandles,
          accountBalance: cfg.accountBalance || 10000,
          riskPercent: cfg.riskPercent || 1,
          discipline,
        };

        const result = runProbabilityEngine(input);
        setOutput(result);
        setLastUpdate(Date.now());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Engine error');
    } finally {
      setLoading(false);
    }
  }, [discipline]);

  // Auto-refresh
  useEffect(() => {
    if (config.autoRefreshMs && config.autoRefreshMs > 0) {
      timerRef.current = setInterval(runEngine, config.autoRefreshMs);
      return () => {
        if (timerRef.current) clearInterval(timerRef.current);
      };
    }
  }, [config.autoRefreshMs, runEngine]);

  // Run on candle data change (debounced)
  const prevCandleCountRef = useRef(0);
  useEffect(() => {
    const count = config.candles?.length || 0;
    if (count > 0 && count !== prevCandleCountRef.current) {
      prevCandleCountRef.current = count;
      runEngine();
    }
  }, [config.candles?.length, runEngine]);

  // Discipline actions
  const recordWin = useCallback(() => {
    setDiscipline((prev: DisciplineState) => recordTradeResult(prev, true));
  }, []);

  const recordLoss = useCallback(() => {
    setDiscipline((prev: DisciplineState) => recordTradeResult(prev, false));
  }, []);

  const resetDiscipline = useCallback(() => {
    setDiscipline(createDisciplineState());
  }, []);

  return {
    output,
    loading,
    error,
    lastUpdate,
    discipline,
    refresh: runEngine,
    recordWin,
    recordLoss,
    resetDiscipline,
  };
}
