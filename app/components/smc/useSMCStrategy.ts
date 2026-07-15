/**
 * useSMCStrategy Hook
 * ====================
 * React hook untuk Smart Money Concept analysis
 * 
 * Features:
 * - Analyze market dengan SMC methodology
 * - Auto-fallback ke local analysis jika Python service down
 * - Caching hasil analysis
 * - Error handling
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  SMCState,
  SMCAnalysisInput,
  SMCAnalysisResult,
  UseSMCReturn,
  SMC_CONFIG
} from './types';

const INITIAL_STATE: SMCState = {
  isAnalyzing: false,
  lastResult: null,
  error: null,
  serviceStatus: 'offline',
  analysisCount: 0,
};

export function useSMCStrategy(): UseSMCReturn {
  const [state, setState] = useState<SMCState>(INITIAL_STATE);
  const abortControllerRef = useRef<AbortController | null>(null);
  const cacheRef = useRef<Map<string, { result: SMCAnalysisResult; timestamp: number }>>(new Map());

  // Check service status on mount
  useEffect(() => {
    checkServiceStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Check if SMC service is available
   */
  const checkServiceStatus = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch('/api/smc/analyze', {
        method: 'GET',
      });

      if (response.ok) {
        const data = await response.json();
        setState(prev => ({
          ...prev,
          serviceStatus: data.status === 'fallback_mode' ? 'fallback' : 'online',
        }));
      } else {
        setState(prev => ({ ...prev, serviceStatus: 'offline' }));
      }
    } catch {
      setState(prev => ({ ...prev, serviceStatus: 'fallback' }));
    }
  }, []);

  /**
   * Generate cache key from input
   */
  const getCacheKey = useCallback((input: SMCAnalysisInput): string => {
    const h4Last = input.ohlc_h4[input.ohlc_h4.length - 1];
    const m15Last = input.ohlc_m15[input.ohlc_m15.length - 1];
    return `${input.symbol}_${h4Last.time}_${m15Last.time}_${h4Last.close.toFixed(2)}`;
  }, []);

  /**
   * Check cache for recent analysis
   */
  const checkCache = useCallback((key: string): SMCAnalysisResult | null => {
    const cached = cacheRef.current.get(key);
    if (cached) {
      const age = Date.now() - cached.timestamp;
      // Cache valid for 30 seconds
      if (age < 30000) {
        return cached.result;
      }
      cacheRef.current.delete(key);
    }
    return null;
  }, []);

  /**
   * Validate input data
   */
  const validateInput = useCallback((input: SMCAnalysisInput): string | null => {
    if (!input.ohlc_h4 || input.ohlc_h4.length < SMC_CONFIG.MIN_H4_CANDLES) {
      return `Minimal ${SMC_CONFIG.MIN_H4_CANDLES} candle H4 diperlukan (current: ${input.ohlc_h4?.length || 0})`;
    }

    if (!input.ohlc_m15 || input.ohlc_m15.length < SMC_CONFIG.MIN_M15_CANDLES) {
      return `Minimal ${SMC_CONFIG.MIN_M15_CANDLES} candle M15 diperlukan (current: ${input.ohlc_m15?.length || 0})`;
    }

    return null;
  }, []);

  /**
   * Run SMC analysis
   */
  const analyze = useCallback(async (input: SMCAnalysisInput): Promise<SMCAnalysisResult> => {
    // Validate input
    const validationError = validateInput(input);
    if (validationError) {
      const errorResult: SMCAnalysisResult = {
        decision: 'NO_TRADE',
        confidence_score: 0,
        logic: `⚠️ Validation Error: ${validationError}`,
        warnings: [validationError],
        timestamp: new Date().toISOString(),
      };
      setState(prev => ({ ...prev, error: validationError, lastResult: errorResult }));
      return errorResult;
    }

    // Check cache
    const cacheKey = getCacheKey(input);
    const cachedResult = checkCache(cacheKey);
    if (cachedResult) {
      setState(prev => ({ ...prev, lastResult: cachedResult }));
      return cachedResult;
    }

    // Cancel any pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    setState(prev => ({ ...prev, isAnalyzing: true, error: null }));

    try {
      const response = await fetch('/api/smc/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ohlc_h4: input.ohlc_h4,
          ohlc_m15: input.ohlc_m15,
          supply_demand_zones: input.supply_demand_zones || [],
          market_structure: input.market_structure || {},
          current_volume: input.current_volume || 0,
          symbol: input.symbol || 'XAUUSD',
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const result: SMCAnalysisResult = await response.json();

      // Cache result
      cacheRef.current.set(cacheKey, { result, timestamp: Date.now() });

      setState(prev => ({
        ...prev,
        isAnalyzing: false,
        lastResult: result,
        analysisCount: prev.analysisCount + 1,
      }));

      return result;

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // Request was cancelled, not an error
        return state.lastResult || {
          decision: 'NO_TRADE',
          confidence_score: 0,
          logic: 'Analysis cancelled',
          timestamp: new Date().toISOString(),
        };
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setState(prev => ({
        ...prev,
        isAnalyzing: false,
        error: errorMessage,
      }));

      return {
        decision: 'NO_TRADE',
        confidence_score: 0,
        logic: `❌ Analysis Error: ${errorMessage}`,
        warnings: [errorMessage],
        timestamp: new Date().toISOString(),
      };
    }
  }, [validateInput, getCacheKey, checkCache, state.lastResult]);

  /**
   * Clear current result
   */
  const clearResult = useCallback((): void => {
    setState(prev => ({ ...prev, lastResult: null, error: null }));
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return {
    ...state,
    analyze,
    clearResult,
    checkServiceStatus,
  };
}

export default useSMCStrategy;
