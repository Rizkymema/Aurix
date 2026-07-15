/**
 * SMC Strategy Panel
 * ===================
 * UI component untuk menampilkan hasil SMC analysis
 * 
 * Features:
 * - Signal card dengan confidence meter
 * - Setup display (Entry, SL, TP1, TP2)
 * - "Why This Signal" explanation
 * - Warning alerts
 */

'use client';

import React, { useMemo } from 'react';
import {
  SMCAnalysisResult,
  getConfidenceLevel,
  getConfidenceColor,
  DECISION_COLORS
} from './types';

interface SMCPanelProps {
  result: SMCAnalysisResult | null;
  isAnalyzing?: boolean;
  onRefresh?: () => void;
  serviceStatus?: 'online' | 'offline' | 'fallback';
}

export function SMCPanel({ 
  result, 
  isAnalyzing = false, 
  onRefresh,
  serviceStatus = 'offline'
}: SMCPanelProps): React.ReactElement {
  const confidenceLevel = useMemo(() => {
    if (!result) return 'very_low';
    return getConfidenceLevel(result.confidence_score);
  }, [result]);

  const confidenceColor = useMemo(() => {
    if (!result) return '#8B8B8B';
    return getConfidenceColor(result.confidence_score);
  }, [result]);

  const decisionColor = useMemo(() => {
    if (!result) return '#8B8B8B';
    return DECISION_COLORS[result.decision];
  }, [result]);

  return (
    <div className="bg-[#161B22] rounded-lg border border-[#30363D] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#30363D]">
        <div className="flex items-center gap-2">
          <span className="text-lg">🎯</span>
          <h3 className="font-semibold text-white">SMC Analysis</h3>
          <StatusBadge status={serviceStatus} />
        </div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={isAnalyzing}
            className={`px-3 py-1 rounded text-sm transition-colors ${
              isAnalyzing 
                ? 'bg-[#21262D] text-gray-500 cursor-not-allowed' 
                : 'bg-[#238636] hover:bg-[#2EA043] text-white'
            }`}
          >
            {isAnalyzing ? 'Analyzing...' : 'Refresh'}
          </button>
        )}
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        {isAnalyzing && !result && (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#58A6FF]" />
            <span className="ml-3 text-gray-400">Analyzing market structure...</span>
          </div>
        )}

        {result && (
          <>
            {/* Decision Card */}
            <div 
              className="rounded-lg p-4 text-center"
              style={{ backgroundColor: `${decisionColor}20` }}
            >
              <div 
                className="text-2xl font-bold mb-1"
                style={{ color: decisionColor }}
              >
                {result.decision === 'ENTRY' ? '✅ ENTRY SIGNAL' : '⏳ NO TRADE'}
              </div>
              <div className="text-sm text-gray-400">
                {result.timestamp && new Date(result.timestamp).toLocaleTimeString()}
              </div>
            </div>

            {/* Confidence Meter */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Confidence Score</span>
                <span 
                  className="font-semibold"
                  style={{ color: confidenceColor }}
                >
                  {result.confidence_score}% ({confidenceLevel.replace('_', ' ')})
                </span>
              </div>
              <div className="h-2 bg-[#21262D] rounded-full overflow-hidden">
                <div 
                  className="h-full rounded-full transition-all duration-500"
                  style={{ 
                    width: `${result.confidence_score}%`,
                    backgroundColor: confidenceColor
                  }}
                />
              </div>
            </div>

            {/* Logic Explanation */}
            <div className="bg-[#0D1117] rounded-lg p-3 border border-[#30363D]">
              <div className="text-xs text-gray-500 mb-1">💡 Why This Signal</div>
              <p className="text-sm text-gray-300">{result.logic}</p>
            </div>

            {/* Setup (if ENTRY) */}
            {result.setup && (
              <div className="space-y-2">
                <div className="text-sm font-medium text-gray-400">📈 Trading Setup</div>
                <div className="grid grid-cols-2 gap-2">
                  <SetupItem label="Entry" value={result.setup.entry} color="#58A6FF" />
                  <SetupItem label="Position" value={result.setup.position_type} color={result.setup.position_type === 'LONG' ? '#26A65B' : '#E85C5C'} />
                  <SetupItem label="Stop Loss" value={result.setup.sl} color="#E85C5C" />
                  <SetupItem label="Risk (pips)" value={result.setup.risk_pips.toFixed(1)} color="#E85C5C" />
                  <SetupItem label="TP1" value={result.setup.tp1} color="#26A65B" suffix={`(${result.setup.rrr_tp1.toFixed(1)}R)`} />
                  <SetupItem label="TP2" value={result.setup.tp2} color="#26A65B" suffix={`(${result.setup.rrr_tp2.toFixed(1)}R)`} />
                </div>
              </div>
            )}

            {/* Analysis Details */}
            {result.analysis && (
              <div className="space-y-2">
                <div className="text-sm font-medium text-gray-400">📊 Analysis Details</div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {result.analysis.trend_h4 && (
                    <div className="flex justify-between bg-[#0D1117] px-3 py-2 rounded">
                      <span className="text-gray-500">H4 Trend</span>
                      <span className={result.analysis.trend_h4 === 'bullish' ? 'text-green-400' : 'text-red-400'}>
                        {result.analysis.trend_h4.toUpperCase()}
                      </span>
                    </div>
                  )}
                  {result.analysis.confirmation && (
                    <div className="flex justify-between bg-[#0D1117] px-3 py-2 rounded">
                      <span className="text-gray-500">Confirmation</span>
                      <span className="text-[#58A6FF]">{result.analysis.confirmation}</span>
                    </div>
                  )}
                  {result.analysis.poi_zone && (
                    <div className="flex justify-between bg-[#0D1117] px-3 py-2 rounded col-span-2">
                      <span className="text-gray-500">POI Zone</span>
                      <span className={result.analysis.poi_zone.type === 'demand' ? 'text-green-400' : 'text-red-400'}>
                        {result.analysis.poi_zone.type.toUpperCase()} ({result.analysis.poi_zone.strength}%)
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Warnings */}
            {result.warnings && result.warnings.length > 0 && (
              <div className="space-y-1">
                <div className="text-sm font-medium text-yellow-500">⚠️ Warnings</div>
                {result.warnings.map((warning, index) => (
                  <div 
                    key={index}
                    className="text-xs text-yellow-400/80 bg-yellow-500/10 px-3 py-1.5 rounded"
                  >
                    {warning}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {!result && !isAnalyzing && (
          <div className="text-center py-8 text-gray-500">
            <div className="text-4xl mb-2">📊</div>
            <p>No analysis yet</p>
            <p className="text-sm">Click Refresh to analyze current market</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ==========================================
// SUB-COMPONENTS
// ==========================================

function StatusBadge({ status }: { status: string }): React.ReactElement {
  const colors = {
    online: 'bg-green-500/20 text-green-400',
    offline: 'bg-red-500/20 text-red-400',
    fallback: 'bg-yellow-500/20 text-yellow-400',
  };

  const labels = {
    online: 'Live',
    offline: 'Offline',
    fallback: 'Fallback',
  };

  return (
    <span className={`px-2 py-0.5 rounded text-xs ${colors[status as keyof typeof colors] || colors.offline}`}>
      {labels[status as keyof typeof labels] || 'Unknown'}
    </span>
  );
}

interface SetupItemProps {
  label: string;
  value: number | string;
  color: string;
  suffix?: string;
}

function SetupItem({ label, value, color, suffix }: SetupItemProps): React.ReactElement {
  const displayValue = typeof value === 'number' ? value.toFixed(2) : value;
  
  return (
    <div className="bg-[#0D1117] px-3 py-2 rounded border border-[#30363D]">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="font-mono text-sm" style={{ color }}>
        {displayValue}
        {suffix && <span className="text-gray-500 text-xs ml-1">{suffix}</span>}
      </div>
    </div>
  );
}

export default SMCPanel;
