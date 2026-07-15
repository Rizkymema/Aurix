'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { CandlestickData } from '../chart/types';
import { SmartSignal } from './types';
import {
  generateSmartSignal,
  analyzeH4Trend,
  detectZones,
  calculateATR,
} from './signalGenerator';
import {
  generateUnifiedSignal,
  UnifiedSignal,
  SignalGeneratorConfig,
  DEFAULT_CONFIG,
  PriceZone,
  // Institutional engine
  generateInstitutionalSignal,
  InstitutionalOutput,
  InstitutionalSignalConfig,
  DEFAULT_INSTITUTIONAL_CONFIG,
  DisciplineState,
  createDisciplineState,
  recordTradeResult,
  tickCooldown,
  MonetisationTier,
} from '../../lib/unifiedSignalGenerator';
import { CandleData } from '../../lib/tradingRulesEngine';

const APP_API_KEY = process.env.NEXT_PUBLIC_APP_API_KEY;

interface AIAnalysisResponse {
  signal: 'BUY' | 'SELL' | 'WAIT';
  validity_score: number;
  trend: 'Bullish' | 'Bearish' | 'Neutral';
  entry: number;
  stop_loss: number;
  take_profit_1: number;
  take_profit_2: number;
  rrr: string;
  reason: string[];
  risk_warning: string;
  structure_valid: boolean;
  zone_quality: string;
  pattern_reliability: string;
  analysis: {
    trend: string;
    support_resistance: string;
    pattern: string;
    momentum: string;
    volume: string;
    confluence: string;
  };
}

interface UseSmartSignalOptions {
  symbol: string;
  candles: CandlestickData[];
  timeframe?: string;
  structure?: {
    swings: Array<{ type: string; price: number; time: number }>;
    breaks: Array<{ type: string; direction: string; price: number; time: number }>;
    trend: string;
  };
  zones?: Array<{
    type: 'supply' | 'demand';
    top: number;
    bottom: number;
    strength: number;
    status: string;
  }>;
  patterns?: Array<{
    name: string;
    type: string;
    reliability: string;
    time: number;
  }>;
  enabled?: boolean;
  // NEW: 3-Layer configuration
  layerConfig?: Partial<SignalGeneratorConfig>;
}

interface UseSmartSignalReturn {
  signal: SmartSignal | null;
  aiResponse: AIAnalysisResponse | null;
  isLoading: boolean;
  error: string | null;
  source: 'ai' | 'local' | 'unified' | 'institutional' | null;
  refresh: () => void;
  // AI toggle controls
  aiEnabled: boolean;
  setAiEnabled: (enabled: boolean) => void;
  autoRefreshEnabled: boolean;
  setAutoRefreshEnabled: (enabled: boolean) => void;
  // 3-Layer unified signal
  unifiedSignal: UnifiedSignal | null;
  layerBreakdown: {
    layer1: number;
    layer2: number;
    layer3: boolean;
  } | null;
  // Layer controls
  sentimentEnabled: boolean;
  setSentimentEnabled: (enabled: boolean) => void;
  geminiEnabled: boolean;
  setGeminiEnabled: (enabled: boolean) => void;
  // Generate unified signal function
  generateUnified: () => Promise<void>;
  // INSTITUTIONAL ENGINE
  institutionalSignal: InstitutionalOutput | null;
  institutionalEnabled: boolean;
  setInstitutionalEnabled: (enabled: boolean) => void;
  discipline: DisciplineState;
  tier: MonetisationTier;
  setTier: (tier: MonetisationTier) => void;
  generateInstitutional: () => Promise<void>;
  recordResult: (won: boolean) => void;
}

export function useSmartSignal({
  symbol,
  candles,
  timeframe = '1h',
  structure,
  zones,
  patterns,
  enabled = true,
  layerConfig,
}: UseSmartSignalOptions): UseSmartSignalReturn {
  const [signal, setSignal] = useState<SmartSignal | null>(null);
  const [aiResponse, setAiResponse] = useState<AIAnalysisResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<'ai' | 'local' | 'unified' | 'institutional' | null>(null);
  const lastCandleTimeRef = useRef<number>(0);
  const lastAnalysisRef = useRef<number>(0);
  
  // AI toggle controls - default OFF to save API quota
  const [aiEnabled, setAiEnabled] = useState(false);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
  
  // 3-Layer controls
  const [sentimentEnabled, setSentimentEnabled] = useState(true);  // Layer 2 ON by default
  const [geminiEnabled, setGeminiEnabled] = useState(false);       // Layer 3 OFF by default
  const [unifiedSignal, setUnifiedSignal] = useState<UnifiedSignal | null>(null);
  const [layerBreakdown, setLayerBreakdown] = useState<{
    layer1: number;
    layer2: number;
    layer3: boolean;
  } | null>(null);

  // INSTITUTIONAL ENGINE state
  const [institutionalEnabled, setInstitutionalEnabled] = useState(true); // ON by default
  const [institutionalSignal, setInstitutionalSignal] = useState<InstitutionalOutput | null>(null);
  const [discipline, setDiscipline] = useState<DisciplineState>(createDisciplineState());
  const [tier, setTier] = useState<MonetisationTier>('PRO');
  
  // Rate limit tracking (must match server-side: 60s per symbol)
  const MIN_AI_INTERVAL = 65000; // 65s (slightly more than server's 60s to be safe)
  const rateLimitedUntilRef = useRef<number>(0);

  // NEW: Convert zones to PriceZone format for unified generator
  const convertZonesToPriceZones = useCallback((): PriceZone[] => {
    if (!zones) return [];
    
    return zones.map((z, index) => ({
      id: `zone-${index}-${z.type}`,
      type: z.type,
      high: z.top,
      low: z.bottom,
      strength: z.strength,
      created_at: Date.now() - (index * 3600000), // Approximate age
      status: z.status as 'fresh' | 'tested' | 'broken'
    }));
  }, [zones]);

  // NEW: Convert candles to CandleData format
  const convertCandles = useCallback((): CandleData[] => {
    return candles.map(c => ({
      time: typeof c.time === 'number' ? c.time : new Date(c.time).getTime() / 1000,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume
    }));
  }, [candles]);

  // NEW: Generate unified 3-layer signal
  const generateUnified = useCallback(async (): Promise<void> => {
    if (candles.length < 50) {
      setUnifiedSignal(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const priceZones = convertZonesToPriceZones();
      const candleData = convertCandles();
      
      const config: SignalGeneratorConfig = {
        ...DEFAULT_CONFIG,
        enableLayer2: sentimentEnabled,
        enableLayer3: geminiEnabled,
        ...layerConfig
      };

      console.log(`[useSmartSignal] Generating unified signal with config:`, {
        layer2: sentimentEnabled,
        layer3: geminiEnabled
      });

      const unified = await generateUnifiedSignal(
        candleData,
        priceZones,
        symbol,
        timeframe,
        config
      );

      if (unified) {
        setUnifiedSignal(unified);
        setLayerBreakdown({
          layer1: unified.layer_breakdown.layer1_technical,
          layer2: unified.layer_breakdown.layer2_sentiment,
          layer3: unified.layer_breakdown.layer3_ai > 0
        });
        setSource('unified');

        // Also set the legacy SmartSignal format for compatibility
        const legacySignal: SmartSignal = {
          type: unified.signal_type,
          symbol: unified.symbol,
          entry_zone: {
            high: unified.entry * 1.002,
            low: unified.entry * 0.998,
          },
          tp1: unified.take_profit_1,
          tp2: unified.take_profit_2,
          sl: unified.stop_loss,
          reason: unified.reasons_list.join(' | '),
          validity_score: unified.final_confidence,
          timestamp: unified.timestamp,
          risk_reward_ratio: unified.take_profit_1 && unified.stop_loss 
            ? Math.abs(unified.take_profit_1 - unified.entry) / Math.abs(unified.entry - unified.stop_loss)
            : 2,
          trend_alignment: unified.validations.trend_alignment,
          zone_confluence: unified.validations.zone_proximity,
        };
        setSignal(legacySignal);

        console.log(`[useSmartSignal] Unified signal: ${unified.signal_type} @ ${unified.entry} | Grade: ${unified.quality_grade} | Rec: ${unified.recommendation}`);
      } else {
        setUnifiedSignal(null);
        setSignal(null);
        console.log(`[useSmartSignal] No valid unified signal at this time`);
      }
    } catch (err) {
      console.error('[useSmartSignal] Unified signal error:', err);
      setError(err instanceof Error ? err.message : 'Failed to generate unified signal');
    } finally {
      setIsLoading(false);
    }
  }, [candles, symbol, timeframe, sentimentEnabled, geminiEnabled, layerConfig, convertZonesToPriceZones, convertCandles]);

  // INSTITUTIONAL: Generate institutional-grade signal
  const generateInstitutional = useCallback(async (): Promise<void> => {
    if (candles.length < 200) {
      console.log('[Institutional] Need 200+ candles, got', candles.length);
      setInstitutionalSignal(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const priceZones = convertZonesToPriceZones();
      const candleData = convertCandles();

      const config: InstitutionalSignalConfig = {
        ...DEFAULT_INSTITUTIONAL_CONFIG,
        tier,
        enableSentiment: sentimentEnabled,
        enableAIValidation: false, // AI validation done separately
      };

      console.log(`[Institutional] Running 11-step engine for ${symbol} ${timeframe}...`);

      const output = await generateInstitutionalSignal(
        candleData,
        priceZones,
        symbol,
        timeframe,
        discipline,
        config,
        [], // news events - empty for now
        null, // AI validation handled externally
      );

      setInstitutionalSignal(output);
      setSource('institutional');

      // Tick cooldown on each analysis (approximation of candle close)
      if (discipline.cooldown_active) {
        setDiscipline(prev => tickCooldown(prev));
      }

      // If TRADE, also set legacy signal for compatibility
      if (output.decision === 'TRADE' && output.entry !== null) {
        const legacySignal: SmartSignal = {
          type: output.direction as 'BUY' | 'SELL',
          symbol,
          entry_zone: {
            high: output.entry * 1.002,
            low: output.entry * 0.998,
          },
          tp1: output.take_profit[0] || output.entry,
          tp2: output.take_profit[1] || output.entry,
          sl: output.stop_loss || output.entry,
          reason: output.reason.join(' | '),
          validity_score: output.confidence,
          timestamp: Date.now(),
          risk_reward_ratio: output.stop_loss && output.take_profit[0]
            ? Math.abs(output.take_profit[0] - output.entry) / Math.abs(output.entry - output.stop_loss)
            : 2,
          trend_alignment: output.step_results.find(s => s.step === 2)?.passed || false,
          zone_confluence: output.step_results.find(s => s.step === 4)?.passed || false,
        };
        setSignal(legacySignal);
      } else {
        setSignal(null);
      }

      console.log(`[Institutional] Result: ${output.decision} | Grade: ${output.grade} | Score: ${output.score_breakdown.total}/100`);
    } catch (err) {
      console.error('[Institutional] Engine error:', err);
      setError(err instanceof Error ? err.message : 'Institutional engine failed');
    } finally {
      setIsLoading(false);
    }
  }, [candles, symbol, timeframe, discipline, tier, sentimentEnabled, convertZonesToPriceZones, convertCandles]);

  // INSTITUTIONAL: Record trade result for discipline tracking
  const recordResult = useCallback((won: boolean) => {
    if (!institutionalSignal) return;
    // Approximate candle duration from timeframe
    const tfMs: Record<string, number> = {
      '1m': 60000, '5m': 300000, '15m': 900000, '30m': 1800000,
      '1h': 3600000, '4h': 14400000, '1d': 86400000,
    };
    const candleDuration = tfMs[timeframe] || 3600000;
    setDiscipline(prev => recordTradeResult(prev, won, institutionalSignal.grade, candleDuration));
  }, [institutionalSignal, timeframe]);

  // Local signal generation (fallback)
  const generateLocalSignal = useCallback((): SmartSignal | null => {
    if (candles.length < 50) {
      return null;
    }

    const currentPrice = candles[candles.length - 1].close;
    const atr = calculateATR(candles);
    const h4Trend = analyzeH4Trend(candles);
    const { supplyZones, demandZones } = detectZones(candles, atr);

    return generateSmartSignal(symbol, {
      currentPrice,
      h4Trend,
      supplyZones,
      demandZones,
      atr,
    });
  }, [symbol, candles]);

  // Convert AI response to SmartSignal format
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const aiResponseToSignal = useCallback((ai: AIAnalysisResponse, _currentPrice: number): SmartSignal | null => {
    if (ai.signal === 'WAIT') {
      return null;
    }

    return {
      type: ai.signal as 'BUY' | 'SELL',
      symbol,
      entry_zone: {
        high: ai.entry * 1.002,
        low: ai.entry * 0.998,
      },
      tp1: ai.take_profit_1,
      tp2: ai.take_profit_2,
      sl: ai.stop_loss,
      reason: ai.reason.join('. '),
      validity_score: ai.validity_score,
      timestamp: Date.now(),
      risk_reward_ratio: parseFloat(ai.rrr.split(':')[1]) || 2,
      trend_alignment: ai.trend !== 'Neutral',
      zone_confluence: ai.zone_quality !== 'Weak',
    };
  }, [symbol]);

  // Call AI API for analysis
  const analyzeWithAI = useCallback(async (): Promise<AIAnalysisResponse | null> => {
    if (candles.length < 20) {
      return null;
    }

    const currentPrice = candles[candles.length - 1].close;

    try {
      const response = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(APP_API_KEY ? { 'x-app-api-key': APP_API_KEY } : {}),
        },
        body: JSON.stringify({
          symbol,
          timeframe,
          candles: candles.slice(-50).map(c => ({
            time: c.time,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume || 0,
          })),
          currentPrice,
          structure: structure ? {
            swings: structure.swings || [],
            breaks: structure.breaks || [],
            trend: structure.trend || 'neutral',
          } : undefined,
          zones: zones?.map(z => ({
            type: z.type,
            top: z.top,
            bottom: z.bottom,
            strength: z.strength,
            status: z.status,
          })),
          patterns: patterns?.map(p => ({
            name: p.name,
            type: p.type,
            reliability: p.reliability,
            time: p.time,
          })),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        // Throw rate limit errors so they can be handled specially
        if (response.status === 429) {
          throw new Error(errorData.error || 'Rate limited');
        }
        throw new Error(errorData.error || 'AI analysis failed');
      }

      const result = await response.json();
      return result.data as AIAnalysisResponse;
    } catch (err) {
      // Re-throw rate limit errors
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (errorMessage.includes('Rate limited')) {
        throw err;
      }
      console.error('AI analysis error:', err);
      return null;
    }
  }, [symbol, timeframe, candles, structure, zones, patterns]);

  // Main signal generation
  const generateSignal = useCallback(async (forceAI: boolean = false) => {
    if (!enabled || candles.length < 20) {
      setSignal(null);
      setAiResponse(null);
      return;
    }

    const lastCandle = candles[candles.length - 1];
    const now = Date.now();
    
    // Skip if same candle and analyzed recently (use MIN_AI_INTERVAL to match server)
    // But allow if forceAI is true (manual refresh)
    if (!forceAI && lastCandle.time === lastCandleTimeRef.current && 
        now - lastAnalysisRef.current < MIN_AI_INTERVAL) {
      return;
    }

    // If AI is disabled, only use local analysis
    if (!aiEnabled && !forceAI) {
      console.log(`[SmartSignal] AI disabled, using local analysis only...`);
      const localSignal = generateLocalSignal();
      setSignal(localSignal);
      setAiResponse(null);
      setSource('local');
      lastCandleTimeRef.current = lastCandle.time;
      return;
    }

    // Check if we're still rate-limited
    if (now < rateLimitedUntilRef.current) {
      const waitTime = Math.ceil((rateLimitedUntilRef.current - now) / 1000);
      console.log(`[SmartSignal] Rate limited, wait ${waitTime}s. Using local analysis...`);
      
      // Use local analysis during rate limit
      const localSignal = generateLocalSignal();
      if (localSignal) {
        setSignal(localSignal);
        setSource('local');
      }
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Try AI analysis first (only if aiEnabled or forceAI)
      console.log(`[SmartSignal] Requesting AI analysis for ${symbol}...`);
      const ai = await analyzeWithAI();
      
      if (ai) {
        setAiResponse(ai);
        lastCandleTimeRef.current = lastCandle.time;
        lastAnalysisRef.current = now;
        
        if (ai.signal !== 'WAIT') {
          const smartSignal = aiResponseToSignal(ai, lastCandle.close);
          setSignal(smartSignal);
          setSource('ai');
          console.log(`[SmartSignal] AI Signal: ${ai.signal} (${ai.validity_score}%)`);
        } else {
          setSignal(null);
          setSource('ai');
          console.log(`[SmartSignal] AI says WAIT - No trade setup`);
        }
        return;
      }

      // Fallback to local generation
      console.log(`[SmartSignal] AI unavailable, using local analysis...`);
      const localSignal = generateLocalSignal();
      setSignal(localSignal);
      setAiResponse(null);
      setSource('local');
      
    } catch (err) {
      console.error('Signal generation error:', err);
      
      // Check if it's a rate limit error (from API response)
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (errorMessage.includes('Rate limited')) {
        // Set rate limit until time
        rateLimitedUntilRef.current = now + MIN_AI_INTERVAL;
        console.log(`[SmartSignal] Rate limited by server, will retry in ${MIN_AI_INTERVAL / 1000}s`);
      }
      
      // Fallback to local on error
      const localSignal = generateLocalSignal();
      if (localSignal) {
        setSignal(localSignal);
        setSource('local');
      } else {
        setError('Failed to generate signal');
        setSignal(null);
      }
    } finally {
      setIsLoading(false);
    }
  }, [symbol, candles, enabled, aiEnabled, analyzeWithAI, aiResponseToSignal, generateLocalSignal]);

  // Generate signal when candle closes (new candle time) - only if AI or auto-refresh is enabled
  useEffect(() => {
    if (candles.length > 0 && (aiEnabled || autoRefreshEnabled)) {
      const lastCandle = candles[candles.length - 1];
      
      // Trigger on new candle or first load
      if (lastCandle.time !== lastCandleTimeRef.current) {
        generateSignal();
      }
    }
  }, [candles, generateSignal, aiEnabled, autoRefreshEnabled]);

  // Initial load - use local analysis by default
  useEffect(() => {
    if (enabled && candles.length >= 20 && !signal && !isLoading) {
      generateSignal();
    }
  }, [enabled, candles.length, signal, isLoading, generateSignal]);

  // Auto-refresh every 2 minutes - ONLY if autoRefreshEnabled
  useEffect(() => {
    if (!enabled || !autoRefreshEnabled || !aiEnabled) return;

    console.log(`[SmartSignal] Auto-refresh enabled, interval: 2 minutes`);
    const interval = setInterval(() => {
      generateSignal();
    }, 120000);

    return () => clearInterval(interval);
  }, [enabled, autoRefreshEnabled, aiEnabled, generateSignal]);

  // Manual refresh handler (always allows AI call)
  const manualRefresh = useCallback(() => {
    generateSignal(true);
  }, [generateSignal]);

  // Generate unified signal on initial load and when layer settings change
  useEffect(() => {
    if (enabled && candles.length >= 50 && !isLoading && !institutionalEnabled) {
      generateUnified();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, sentimentEnabled, geminiEnabled, institutionalEnabled]);

  // INSTITUTIONAL: Auto-generate when enabled and candles available
  useEffect(() => {
    if (enabled && institutionalEnabled && candles.length >= 200 && !isLoading) {
      generateInstitutional();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, institutionalEnabled, tier]);

  return {
    signal,
    aiResponse,
    isLoading,
    error,
    source,
    refresh: manualRefresh,
    // AI toggle controls
    aiEnabled,
    setAiEnabled,
    autoRefreshEnabled,
    setAutoRefreshEnabled,
    // 3-Layer unified signal
    unifiedSignal,
    layerBreakdown,
    // Layer controls
    sentimentEnabled,
    setSentimentEnabled,
    geminiEnabled,
    setGeminiEnabled,
    // Generate unified signal function
    generateUnified,
    // INSTITUTIONAL ENGINE
    institutionalSignal,
    institutionalEnabled,
    setInstitutionalEnabled,
    discipline,
    tier,
    setTier,
    generateInstitutional,
    recordResult,
  };
}

// ==================== HELPER HOOKS ====================

/**
 * Hook for unified signal quality assessment
 */
export function useSignalQuality(signal: UnifiedSignal | null) {
  if (!signal) {
    return {
      isGood: false,
      isExecutable: false,
      warningCount: 0,
      warnings: [] as string[],
      strengthLabel: 'No Signal',
      gradeColor: 'gray'
    };
  }
  
  const warnings: string[] = [];
  
  // Check validations
  if (!signal.validations.trend_alignment) {
    warnings.push('Trend tidak align dengan signal');
  }
  if (!signal.validations.zone_proximity) {
    warnings.push('Tidak ada konfirmasi zone');
  }
  if (!signal.validations.ema_order_valid) {
    warnings.push('EMA order tidak ideal');
  }
  if (signal.market_validation === 'CONFLICTING') {
    warnings.push('Sentiment berlawanan dengan signal');
  }
  
  // Determine strength label
  let strengthLabel: string;
  let gradeColor: string;
  
  switch (signal.quality_grade) {
    case 'A':
      strengthLabel = 'Sangat Kuat';
      gradeColor = 'emerald';
      break;
    case 'B':
      strengthLabel = 'Kuat';
      gradeColor = 'green';
      break;
    case 'C':
      strengthLabel = 'Moderat';
      gradeColor = 'yellow';
      break;
    case 'D':
      strengthLabel = 'Lemah';
      gradeColor = 'orange';
      break;
    default:
      strengthLabel = 'Sangat Lemah';
      gradeColor = 'red';
  }
  
  return {
    isGood: ['A', 'B', 'C'].includes(signal.quality_grade),
    isExecutable: signal.recommendation === 'EXECUTE',
    warningCount: warnings.length,
    warnings,
    strengthLabel,
    gradeColor
  };
}

/**
 * Hook for institutional signal quality assessment
 */
export function useInstitutionalQuality(signal: InstitutionalOutput | null) {
  if (!signal) {
    return {
      isGood: false,
      isTradeable: false,
      warningCount: 0,
      warnings: [] as string[],
      strengthLabel: 'No Signal',
      gradeColor: 'gray',
      gradeBg: 'bg-gray-500/10 border-gray-500/30',
    };
  }

  const warnings: string[] = [];
  const failedSteps = signal.step_results.filter(s => !s.passed);
  for (const step of failedSteps) {
    warnings.push(`Step ${step.step} (${step.name}): ${step.reason}`);
  }

  if (signal.cooldown) {
    warnings.push(`Cooldown: ${signal.discipline.cooldown_reason}`);
  }
  if (!signal.tier_filter.allowed) {
    warnings.push(`Tier blocked: ${signal.tier_filter.reason}`);
  }

  let strengthLabel: string;
  let gradeColor: string;
  let gradeBg: string;

  switch (signal.grade) {
    case 'A+':
      strengthLabel = 'Institutional Grade';
      gradeColor = 'amber';
      gradeBg = 'bg-amber-500/10 border-amber-500/30';
      break;
    case 'A':
      strengthLabel = 'High Probability';
      gradeColor = 'emerald';
      gradeBg = 'bg-emerald-500/10 border-emerald-500/30';
      break;
    case 'B':
      strengthLabel = 'Good Setup';
      gradeColor = 'blue';
      gradeBg = 'bg-blue-500/10 border-blue-500/30';
      break;
    default:
      strengthLabel = 'No Trade';
      gradeColor = 'red';
      gradeBg = 'bg-red-500/10 border-red-500/30';
  }

  return {
    isGood: signal.grade !== 'NO_TRADE',
    isTradeable: signal.decision === 'TRADE',
    warningCount: warnings.length,
    warnings,
    strengthLabel,
    gradeColor,
    gradeBg,
  };
}
