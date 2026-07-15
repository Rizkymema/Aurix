/**
 * AI Signal Panel Component
 * =========================
 * Menampilkan hasil analisis dari AI Trading System Core.
 * 
 * Features:
 * - Real-time signal display
 * - Validity score with color coding
 * - Trade levels visualization
 * - "Why This Signal" explanation
 * - No Trade reasons
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { 
  aiTradingService, 
  AITradingSignal, 
  AISignalRequest,
  parseSignalForDisplay,
  getGradeColor,
  getDirectionColor
} from '../../services/aiTradingService';
import { CandlestickData } from '../chart/types';

// ==================== TYPES ====================

interface AISignalPanelProps {
  symbol: string;
  h4Candles?: CandlestickData[];
  h1Candles?: CandlestickData[];
  m15Candles?: CandlestickData[];
  m5Candles?: CandlestickData[];
  zones?: Array<{
    type: 'supply' | 'demand';
    high: number;
    low: number;
    strength: number;
    timeframe: string;
    status: 'fresh' | 'tested' | 'broken';
  }>;
  autoRefresh?: boolean;
  refreshInterval?: number;
  onSignalGenerated?: (signal: AITradingSignal) => void;
}

// ==================== COMPONENT ====================

export function AISignalPanel({
  symbol,
  h4Candles = [],
  h1Candles = [],
  m15Candles = [],
  m5Candles = [],
  zones = [],
  autoRefresh = false,
  refreshInterval = 60000, // 1 minute
  onSignalGenerated
}: AISignalPanelProps) {
  const [signal, setSignal] = useState<AITradingSignal | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  // ==================== ANALYSIS ====================

  const runAnalysis = useCallback(async () => {
    // Validate minimum data
    if (h4Candles.length < 200) {
      setError(`Insufficient H4 data: ${h4Candles.length}/200`);
      return;
    }
    if (h1Candles.length < 100) {
      setError(`Insufficient H1 data: ${h1Candles.length}/100`);
      return;
    }
    if (m15Candles.length < 50) {
      setError(`Insufficient M15 data: ${m15Candles.length}/50`);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const request: AISignalRequest = {
        symbol,
        h4_candles: h4Candles,
        h1_candles: h1Candles,
        m15_candles: m15Candles,
        m5_candles: m5Candles.length > 0 ? m5Candles : undefined,
        zones: zones.length > 0 ? zones : undefined
      };

      const response = await aiTradingService.analyze(request);

      if (response.success && response.signal) {
        setSignal(response.signal);
        setLastUpdate(new Date());
        onSignalGenerated?.(response.signal);
      } else {
        setError(response.error || 'Analysis failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [symbol, h4Candles, h1Candles, m15Candles, m5Candles, zones, onSignalGenerated]);

  // ==================== AUTO REFRESH ====================

  useEffect(() => {
    if (autoRefresh && h4Candles.length >= 200) {
      runAnalysis();
      const interval = setInterval(runAnalysis, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [autoRefresh, refreshInterval, runAnalysis, h4Candles.length]);

  // ==================== RENDER ====================

  const parsed = signal ? parseSignalForDisplay(signal) : null;

  return (
    <div className="bg-[#161B22] rounded-lg border border-[#30363D] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#30363D]">
        <div className="flex items-center gap-2">
          <span className="text-lg">🤖</span>
          <h3 className="text-white font-medium">AI Trading Signal</h3>
          <span className="text-xs text-gray-500">{symbol}</span>
        </div>
        <button
          onClick={runAnalysis}
          disabled={loading || h4Candles.length < 200}
          className={`px-3 py-1 text-sm rounded transition-colors ${
            loading || h4Candles.length < 200
              ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-500 text-white'
          }`}
        >
          {loading ? 'Analyzing...' : 'Analyze'}
        </button>
      </div>

      {/* Content */}
      <div className="p-4">
        {error && (
          <div className="bg-red-900/30 border border-red-700 rounded p-3 mb-4">
            <span className="text-red-400 text-sm">{error}</span>
          </div>
        )}

        {!signal && !loading && !error && (
          <div className="text-center py-8 text-gray-500">
            <p className="mb-2">Click &quot;Analyze&quot; to generate signal</p>
            <p className="text-xs">
              Data: H4={h4Candles.length}/200, H1={h1Candles.length}/100, M15={m15Candles.length}/50
            </p>
          </div>
        )}

        {loading && (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-3" />
            <p className="text-gray-400">Analyzing market structure...</p>
          </div>
        )}

        {signal && parsed && (
          <div className="space-y-4">
            {/* Signal Status */}
            <div className={`p-4 rounded-lg ${
              parsed.isValid 
                ? 'bg-gradient-to-r from-green-900/30 to-green-800/30 border border-green-700/50' 
                : 'bg-gradient-to-r from-gray-800/30 to-gray-700/30 border border-gray-600/50'
            }`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <span 
                    className="text-2xl font-bold"
                    style={{ color: getDirectionColor(parsed.direction) }}
                  >
                    {parsed.direction}
                  </span>
                  {parsed.isValid && (
                    <span 
                      className="px-2 py-1 rounded text-sm font-medium"
                      style={{ 
                        backgroundColor: `${getGradeColor(parsed.grade)}20`,
                        color: getGradeColor(parsed.grade)
                      }}
                    >
                      Grade {parsed.grade}
                    </span>
                  )}
                </div>
                {parsed.isValid && (
                  <div className="text-right">
                    <div className="text-2xl font-bold text-white">
                      {parsed.validityScore}
                    </div>
                    <div className="text-xs text-gray-400">Validity Score</div>
                  </div>
                )}
              </div>

              {/* Validity Score Bar */}
              {parsed.isValid && (
                <div className="w-full bg-gray-700 rounded-full h-2 mb-3">
                  <div 
                    className="h-2 rounded-full transition-all duration-500"
                    style={{ 
                      width: `${parsed.validityScore}%`,
                      backgroundColor: getGradeColor(parsed.grade)
                    }}
                  />
                </div>
              )}

              {/* Trade Levels or Rejection Reasons */}
              {parsed.isValid ? (
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-gray-400">Entry:</span>
                    <span className="text-white ml-2 font-mono">{parsed.entry}</span>
                  </div>
                  <div>
                    <span className="text-gray-400">Stop Loss:</span>
                    <span className="text-red-400 ml-2 font-mono">{parsed.stopLoss}</span>
                  </div>
                  <div>
                    <span className="text-gray-400">TP1:</span>
                    <span className="text-green-400 ml-2 font-mono">{parsed.takeProfit1}</span>
                  </div>
                  <div>
                    <span className="text-gray-400">TP2:</span>
                    <span className="text-green-400 ml-2 font-mono">{parsed.takeProfit2}</span>
                  </div>
                  <div>
                    <span className="text-gray-400">Risk:</span>
                    <span className="text-white ml-2">{parsed.riskPips} pips</span>
                  </div>
                  <div>
                    <span className="text-gray-400">RRR:</span>
                    <span className="text-white ml-2">{parsed.rrrTP1}</span>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-gray-400 text-sm mb-2">Rejection Reasons:</p>
                  {parsed.reasons.map((reason, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <span className="text-red-400">•</span>
                      <span className="text-gray-300">{reason}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Technical Reasons */}
            {parsed.isValid && parsed.reasons.length > 0 && (
              <div className="bg-[#0D1117] rounded-lg p-4">
                <h4 className="text-white font-medium mb-3 flex items-center gap-2">
                  <span>📊</span> Technical Analysis
                </h4>
                <div className="space-y-2">
                  {parsed.reasons.map((reason, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <span className={reason.startsWith('✅') ? 'text-green-400' : reason.startsWith('❌') ? 'text-red-400' : 'text-yellow-400'}>
                        {reason.charAt(0)}
                      </span>
                      <span className="text-gray-300">{reason.slice(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Why This Signal */}
            {parsed.explanation && (
              <div className="bg-[#0D1117] rounded-lg p-4">
                <h4 className="text-white font-medium mb-3 flex items-center gap-2">
                  <span>💡</span> Why This Signal?
                </h4>
                <pre className="text-gray-300 text-sm whitespace-pre-wrap font-mono">
                  {parsed.explanation}
                </pre>
              </div>
            )}

            {/* Trend Analysis */}
            {signal.trend_analysis && (
              <div className="bg-[#0D1117] rounded-lg p-4">
                <h4 className="text-white font-medium mb-3 flex items-center gap-2">
                  <span>🔒</span> MTF Hierarchy
                </h4>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div className="text-center p-2 bg-[#161B22] rounded">
                    <div className="text-gray-400 text-xs mb-1">H4 (Boss)</div>
                    <div className={`font-medium ${
                      signal.trend_analysis.h4_trend === 'BUY' ? 'text-green-400' : 
                      signal.trend_analysis.h4_trend === 'SELL' ? 'text-red-400' : 'text-gray-400'
                    }`}>
                      {signal.trend_analysis.h4_trend || 'N/A'}
                    </div>
                    <div className="text-gray-500 text-xs">{signal.trend_analysis.h4_structure}</div>
                  </div>
                  <div className="text-center p-2 bg-[#161B22] rounded">
                    <div className="text-gray-400 text-xs mb-1">H1 (Validate)</div>
                    <div className="text-gray-300 font-medium">
                      {signal.trend_analysis.h1_structure || 'N/A'}
                    </div>
                  </div>
                  <div className="text-center p-2 bg-[#161B22] rounded">
                    <div className="text-gray-400 text-xs mb-1">Aligned</div>
                    <div className={signal.trend_analysis.hierarchy_aligned ? 'text-green-400' : 'text-red-400'}>
                      {signal.trend_analysis.hierarchy_aligned ? '✅ YES' : '❌ NO'}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* News Filter */}
            {signal.news_filter && (
              <div className={`rounded-lg p-4 ${
                signal.news_filter.clear 
                  ? 'bg-green-900/20 border border-green-700/30' 
                  : 'bg-yellow-900/20 border border-yellow-700/30'
              }`}>
                <div className="flex items-center gap-2">
                  <span>{signal.news_filter.clear ? '✅' : '⚠️'}</span>
                  <span className={signal.news_filter.clear ? 'text-green-400' : 'text-yellow-400'}>
                    {signal.news_filter.clear 
                      ? 'No high impact news nearby' 
                      : `News alert: ${signal.news_filter.upcoming.join(', ')}`
                    }
                  </span>
                </div>
              </div>
            )}

            {/* Last Update */}
            {lastUpdate && (
              <div className="text-xs text-gray-500 text-right">
                Last updated: {lastUpdate.toLocaleTimeString()}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default AISignalPanel;
