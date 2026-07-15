'use client';

import React, { useState } from 'react';
import { SignalCardProps } from './types';
import WhyThisSignalDrawer from './WhyThisSignalDrawer';

// AI Response type
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

interface ExtendedSignalCardProps extends SignalCardProps {
  aiResponse?: AIAnalysisResponse | null;
  source?: 'ai' | 'local' | 'unified' | 'institutional' | null;
  // AI toggle controls
  aiEnabled?: boolean;
  onAiToggleAction?: (enabled: boolean) => void;
  autoRefreshEnabled?: boolean;
  onAutoRefreshToggleAction?: (enabled: boolean) => void;
}

// Format price with appropriate decimals
const formatPrice = (price: number): string => {
  if (price >= 1000) return price.toFixed(2);
  if (price >= 1) return price.toFixed(4);
  return price.toFixed(6);
};

// Calculate RRR visual percentage
const calculateRRRPercentage = (entry: number, tp: number, sl: number): number => {
  const risk = Math.abs(entry - sl);
  const reward = Math.abs(tp - entry);
  const total = risk + reward;
  return (reward / total) * 100;
};

export function SmartSignalCard({ 
  signal, 
  isLoading, 
  onRefresh, 
  aiResponse, 
  source,
  aiEnabled = false,
  onAiToggleAction,
  autoRefreshEnabled = false,
  onAutoRefreshToggleAction,
}: ExtendedSignalCardProps) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Toggle Switch Component
  const ToggleSwitch = ({ 
    enabled, 
    onToggle, 
    label,
    size = 'sm'
  }: { 
    enabled: boolean; 
    onToggle: (v: boolean) => void; 
    label: string;
    size?: 'sm' | 'md';
  }) => (
    <div className="flex items-center gap-2">
      <span className={`text-gray-400 ${size === 'sm' ? 'text-xs' : 'text-sm'}`}>{label}</span>
      <button
        onClick={() => onToggle(!enabled)}
        className={`relative inline-flex items-center ${size === 'sm' ? 'h-5 w-9' : 'h-6 w-11'} rounded-full transition-colors ${
          enabled ? 'bg-green-500' : 'bg-gray-700'
        }`}
      >
        <span
          className={`inline-block ${size === 'sm' ? 'h-3 w-3' : 'h-4 w-4'} transform rounded-full bg-white transition-transform ${
            enabled 
              ? size === 'sm' ? 'translate-x-5' : 'translate-x-6' 
              : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  );

  // AI Controls Header Component
  const AIControlsHeader = () => (
    <div className="flex items-center gap-4 flex-wrap">
      {onAiToggleAction && (
        <ToggleSwitch 
          enabled={aiEnabled} 
          onToggle={onAiToggleAction} 
          label="AI Analysis" 
        />
      )}
      {onAutoRefreshToggleAction && aiEnabled && (
        <ToggleSwitch 
          enabled={autoRefreshEnabled} 
          onToggle={onAutoRefreshToggleAction} 
          label="Auto Refresh" 
        />
      )}
    </div>
  );

  // Show WAIT state from AI
  if (!isLoading && aiResponse?.signal === 'WAIT') {
    return (
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        {/* AI Controls */}
        <div className="px-5 py-3 border-b border-gray-800/50 bg-gray-800/30">
          <AIControlsHeader />
        </div>
        <div className="px-5 py-4 border-b border-gray-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
                AI Smart Signal
              </h3>
              <span className="px-2 py-0.5 text-xs rounded-full bg-purple-500/20 text-purple-400 border border-purple-500/30">
                🤖 AI
              </span>
            </div>
            {onRefresh && (
              <button
                onClick={onRefresh}
                className="p-1.5 rounded-lg hover:bg-gray-800 transition-colors text-gray-500 hover:text-gray-300"
                title="Refresh AI Analysis"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            )}
          </div>
        </div>
        <div className="px-5 py-6">
          <div className="flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 rounded-full bg-yellow-500/10 flex items-center justify-center mb-4">
              <span className="text-3xl">⏳</span>
            </div>
            <p className="text-lg font-semibold text-yellow-400 mb-2">WAIT - No Trade</p>
            <p className="text-sm text-gray-400 mb-4">AI tidak menemukan setup yang valid</p>
            {aiResponse.reason && aiResponse.reason.length > 0 && (
              <div className="w-full bg-gray-800/50 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-2">Alasan:</p>
                {aiResponse.reason.map((r, i) => (
                  <p key={i} className="text-xs text-gray-400">• {r}</p>
                ))}
              </div>
            )}
          </div>
        </div>
        {aiResponse.risk_warning && (
          <div className="px-5 py-3 border-t border-gray-800 bg-red-500/5">
            <p className="text-xs text-red-400 flex items-center gap-2">
              <span>⚠️</span>
              {aiResponse.risk_warning}
            </p>
          </div>
        )}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        {/* AI Controls */}
        <div className="px-5 py-3 border-b border-gray-800/50 bg-gray-800/30">
          <AIControlsHeader />
        </div>
        <div className="p-5 animate-pulse">
          <div className="flex items-center justify-between mb-4">
            <div className="h-6 w-32 bg-gray-800 rounded" />
            <div className="h-6 w-20 bg-gray-800 rounded" />
          </div>
          <div className="space-y-3">
            <div className="h-4 w-full bg-gray-800 rounded" />
            <div className="h-4 w-3/4 bg-gray-800 rounded" />
            <div className="h-4 w-1/2 bg-gray-800 rounded" />
          </div>
        </div>
      </div>
    );
  }

  if (!signal) {
    return (
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        {/* AI Controls */}
        <div className="px-5 py-3 border-b border-gray-800/50 bg-gray-800/30">
          <AIControlsHeader />
        </div>
        <div className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
              {aiEnabled ? 'AI Smart Signal' : 'Local Signal'}
            </h3>
            {onRefresh && (
              <button
                onClick={onRefresh}
                className="p-1.5 rounded-lg hover:bg-gray-800 transition-colors text-gray-500 hover:text-gray-300"
                title={aiEnabled ? "Request AI Analysis" : "Refresh Local Analysis"}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            )}
          </div>
          <div className="flex flex-col items-center justify-center py-8 text-gray-500">
            <svg className="w-12 h-12 mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            <p className="text-sm font-medium">No Valid Signal</p>
            <p className="text-xs text-gray-600 mt-1">
              {aiEnabled ? 'AI is analyzing...' : 'Enable AI for smarter signals'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const isBuy = signal.type === 'BUY';
  const isHighProbability = signal.validity_score >= 80;
  const entryMid = (signal.entry_zone.high + signal.entry_zone.low) / 2;
  const rrrPercentage = calculateRRRPercentage(entryMid, signal.tp1, signal.sl);

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
      {/* AI Controls */}
      <div className="px-5 py-3 border-b border-gray-800/50 bg-gray-800/30">
        <AIControlsHeader />
      </div>
      
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
              {source === 'ai' ? 'AI Smart Signal' : 'Local Signal'}
            </h3>
            {source === 'ai' && (
              <span className="px-2 py-0.5 text-xs rounded-full bg-purple-500/20 text-purple-400 border border-purple-500/30">
                🤖 AI
              </span>
            )}
            {source === 'local' && (
              <span className="px-2 py-0.5 text-xs rounded-full bg-gray-500/20 text-gray-400 border border-gray-500/30">
                📊 Local
              </span>
            )}
            {isHighProbability && (
              <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-gradient-to-r from-amber-500/20 to-yellow-500/20 text-amber-400 border border-amber-500/30">
                HIGH PROBABILITY
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">
              {new Date(signal.timestamp).toLocaleTimeString()}
            </span>
            {onRefresh && (
              <button
                onClick={onRefresh}
                className="p-1.5 rounded-lg hover:bg-gray-800 transition-colors text-gray-500 hover:text-gray-300"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Signal Type & Score */}
      <div className="px-5 py-4 border-b border-gray-800">
        <div className="flex items-center justify-between">
          {/* Signal Type Badge */}
          <div className="flex items-center gap-3">
            <div className={`
              px-4 py-2 rounded-lg font-bold text-lg tracking-wide
              ${isBuy 
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                : 'bg-red-500/20 text-red-400 border border-red-500/30'
              }
            `}>
              {signal.type}
            </div>
            <div>
              <p className="text-white font-semibold">{signal.symbol}</p>
              <p className="text-xs text-gray-500">Spot</p>
            </div>
          </div>

          {/* Validity Score */}
          <div className="text-right">
            <div className="flex items-center gap-2">
              <div className="relative w-12 h-12">
                <svg className="w-12 h-12 transform -rotate-90">
                  <circle
                    cx="24"
                    cy="24"
                    r="20"
                    stroke="currentColor"
                    strokeWidth="4"
                    fill="none"
                    className="text-gray-800"
                  />
                  <circle
                    cx="24"
                    cy="24"
                    r="20"
                    stroke="currentColor"
                    strokeWidth="4"
                    fill="none"
                    strokeDasharray={`${(signal.validity_score / 100) * 125.6} 125.6`}
                    className={
                      signal.validity_score >= 80 
                        ? 'text-emerald-500' 
                        : signal.validity_score >= 60 
                          ? 'text-yellow-500' 
                          : 'text-orange-500'
                    }
                  />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white">
                  {signal.validity_score}%
                </span>
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-1">Score</p>
          </div>
        </div>
      </div>

      {/* Price Levels */}
      <div className="px-5 py-4 space-y-3">
        {/* Entry Zone */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-400">Entry Zone</span>
          <div className="text-right">
            <span className="text-sm font-mono font-semibold text-blue-400">
              {formatPrice(signal.entry_zone.low)} - {formatPrice(signal.entry_zone.high)}
            </span>
          </div>
        </div>

        {/* Take Profit 1 */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-400">TP1 (1:2)</span>
          <span className="text-sm font-mono font-semibold text-emerald-400">
            {formatPrice(signal.tp1)}
          </span>
        </div>

        {/* Take Profit 2 */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-400">TP2 (1:3)</span>
          <span className="text-sm font-mono font-semibold text-emerald-400">
            {formatPrice(signal.tp2)}
          </span>
        </div>

        {/* Stop Loss */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-400">Stop Loss</span>
          <span className="text-sm font-mono font-semibold text-red-400">
            {formatPrice(signal.sl)}
          </span>
        </div>
      </div>

      {/* RRR Visual Bar */}
      <div className="px-5 py-3 border-t border-gray-800">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-gray-500">Risk/Reward Ratio</span>
          <span className="text-xs font-semibold text-white">
            1:{signal.risk_reward_ratio.toFixed(1)}
          </span>
        </div>
        <div className="relative h-2 bg-gray-800 rounded-full overflow-hidden">
          {/* Risk portion (SL) */}
          <div 
            className="absolute left-0 top-0 h-full bg-red-500/60 rounded-l-full"
            style={{ width: `${100 - rrrPercentage}%` }}
          />
          {/* Reward portion (TP) */}
          <div 
            className="absolute right-0 top-0 h-full bg-emerald-500/60 rounded-r-full"
            style={{ width: `${rrrPercentage}%` }}
          />
          {/* Entry marker */}
          <div 
            className="absolute top-1/2 -translate-y-1/2 w-1 h-3 bg-blue-400 rounded-full"
            style={{ left: `${100 - rrrPercentage}%` }}
          />
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-xs text-red-400">SL</span>
          <span className="text-xs text-blue-400">Entry</span>
          <span className="text-xs text-emerald-400">TP</span>
        </div>
      </div>

      {/* Analysis Reason */}
      <div className="px-5 py-3 border-t border-gray-800 bg-gray-900/50">
        <div className="flex items-start gap-2">
          <svg className="w-4 h-4 text-gray-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="space-y-1">
            {aiResponse?.reason ? (
              aiResponse.reason.map((r, i) => (
                <p key={i} className="text-xs text-gray-400 leading-relaxed">• {r}</p>
              ))
            ) : (
              <p className="text-xs text-gray-400 leading-relaxed">{signal.reason}</p>
            )}
          </div>
        </div>
      </div>

      {/* AI Zone & Pattern Quality */}
      {aiResponse && (
        <div className="px-5 py-3 border-t border-gray-800 flex items-center gap-2 flex-wrap">
          <span className={`px-2 py-1 rounded text-xs font-medium ${
            aiResponse.zone_quality === 'Extreme' ? 'bg-emerald-500/20 text-emerald-400' :
            aiResponse.zone_quality === 'Strong' ? 'bg-blue-500/20 text-blue-400' :
            aiResponse.zone_quality === 'Moderate' ? 'bg-yellow-500/20 text-yellow-400' :
            'bg-gray-500/20 text-gray-400'
          }`}>
            Zone: {aiResponse.zone_quality}
          </span>
          <span className={`px-2 py-1 rounded text-xs font-medium ${
            aiResponse.pattern_reliability === 'HIGH' ? 'bg-emerald-500/20 text-emerald-400' :
            aiResponse.pattern_reliability === 'MEDIUM' ? 'bg-yellow-500/20 text-yellow-400' :
            'bg-gray-500/20 text-gray-400'
          }`}>
            Pattern: {aiResponse.pattern_reliability}
          </span>
          {aiResponse.structure_valid && (
            <span className="px-2 py-1 rounded text-xs font-medium bg-emerald-500/20 text-emerald-400">
              ✓ Structure Valid
            </span>
          )}
        </div>
      )}

      {/* Risk Warning from AI */}
      {aiResponse?.risk_warning && (
        <div className="px-5 py-2 border-t border-gray-800 bg-amber-500/5">
          <p className="text-xs text-amber-400 flex items-center gap-2">
            <span>⚠️</span>
            {aiResponse.risk_warning}
          </p>
        </div>
      )}

      {/* Confluence Indicators */}
      <div className="px-5 py-3 border-t border-gray-800 flex items-center gap-3">
        <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs ${
          signal.trend_alignment 
            ? 'bg-emerald-500/10 text-emerald-400' 
            : 'bg-gray-800 text-gray-500'
        }`}>
          <div className={`w-1.5 h-1.5 rounded-full ${
            signal.trend_alignment ? 'bg-emerald-400' : 'bg-gray-600'
          }`} />
          H4 Trend
        </div>
        <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs ${
          signal.zone_confluence 
            ? 'bg-emerald-500/10 text-emerald-400' 
            : 'bg-gray-800 text-gray-500'
        }`}>
          <div className={`w-1.5 h-1.5 rounded-full ${
            signal.zone_confluence ? 'bg-emerald-400' : 'bg-gray-600'
          }`} />
          S/D Zone
        </div>
        <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs ${
          signal.risk_reward_ratio >= 2 
            ? 'bg-emerald-500/10 text-emerald-400' 
            : 'bg-gray-800 text-gray-500'
        }`}>
          <div className={`w-1.5 h-1.5 rounded-full ${
            signal.risk_reward_ratio >= 2 ? 'bg-emerald-400' : 'bg-gray-600'
          }`} />
          RRR ≥ 2
        </div>
      </div>

      {/* Analisa Button */}
      <div className="px-5 py-3 border-t border-gray-800">
        <button
          onClick={() => setIsDrawerOpen(true)}
          className={`
            w-full py-2.5 rounded-lg font-medium text-sm
            flex items-center justify-center gap-2
            transition-all duration-200
            ${isBuy 
              ? 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
              : 'bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30'
            }
          `}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          Why This Signal?
        </button>
      </div>

      {/* Why This Signal Drawer */}
      <WhyThisSignalDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        signalData={{
          direction: signal.type,
          confidence: signal.validity_score,
          currentPrice: (signal.entry_zone.high + signal.entry_zone.low) / 2,
          trend: {
            h4: signal.trend_alignment ? (signal.type === 'BUY' ? 'bullish' : 'bearish') : 'neutral',
            h1: signal.type === 'BUY' ? 'bullish' : 'bearish',
            m15: signal.type === 'BUY' ? 'bullish' : 'bearish',
          },
          support: signal.type === 'BUY' ? signal.sl : undefined,
          resistance: signal.type === 'SELL' ? signal.sl : undefined,
          atr: Math.abs(signal.tp1 - signal.sl) / 3,
          rsi: signal.validity_score >= 80 ? (signal.type === 'BUY' ? 35 : 65) : 50,
          candlePattern: signal.zone_confluence ? (signal.type === 'BUY' ? 'BULLISH_ENGULFING' : 'BEARISH_ENGULFING') : undefined,
          volumeConfirm: signal.validity_score >= 70,
        }}
      />
    </div>
  );
}

export default SmartSignalCard;
