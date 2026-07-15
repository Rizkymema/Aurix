'use client';

import React, { useState } from 'react';
import { UnifiedSignal } from '../../lib/unifiedSignalGenerator';
import { useSignalQuality } from './useSmartSignal';

// ==================== TYPES ====================

interface UnifiedSignalCardProps {
  signal: UnifiedSignal | null;
  isLoading?: boolean;
  onRefresh?: () => void;
  
  // Layer controls
  sentimentEnabled?: boolean;
  onSentimentToggle?: (enabled: boolean) => void;
  geminiEnabled?: boolean;
  onGeminiToggle?: (enabled: boolean) => void;
  
  // Layer breakdown
  layerBreakdown?: {
    layer1: number;
    layer2: number;
    layer3: boolean;
  } | null;
}

// ==================== HELPERS ====================

const formatPrice = (price: number): string => {
  if (price >= 1000) return price.toFixed(2);
  if (price >= 1) return price.toFixed(4);
  return price.toFixed(6);
};

const getGradeBgColor = (grade: string): string => {
  switch (grade) {
    case 'A': return 'bg-emerald-500/10 border-emerald-500/30';
    case 'B': return 'bg-green-500/10 border-green-500/30';
    case 'C': return 'bg-yellow-500/10 border-yellow-500/30';
    case 'D': return 'bg-orange-500/10 border-orange-500/30';
    default: return 'bg-red-500/10 border-red-500/30';
  }
};

const getRecommendationStyle = (rec: string): { bg: string; text: string; icon: string } => {
  switch (rec) {
    case 'EXECUTE':
      return { bg: 'bg-emerald-500/20', text: 'text-emerald-400', icon: '✓' };
    case 'WAIT':
      return { bg: 'bg-yellow-500/20', text: 'text-yellow-400', icon: '⏳' };
    default:
      return { bg: 'bg-red-500/20', text: 'text-red-400', icon: '✗' };
  }
};

// ==================== COMPONENTS ====================

const ToggleSwitch = ({ 
  enabled, 
  onToggle, 
  label,
  sublabel,
  disabled = false
}: { 
  enabled: boolean; 
  onToggle: (v: boolean) => void; 
  label: string;
  sublabel?: string;
  disabled?: boolean;
}) => (
  <div className={`flex items-center justify-between py-2 ${disabled ? 'opacity-50' : ''}`}>
    <div className="flex flex-col">
      <span className="text-sm text-gray-300">{label}</span>
      {sublabel && <span className="text-xs text-gray-500">{sublabel}</span>}
    </div>
    <button
      onClick={() => !disabled && onToggle(!enabled)}
      disabled={disabled}
      className={`relative inline-flex items-center h-6 w-11 rounded-full transition-colors ${
        enabled ? 'bg-emerald-500' : 'bg-gray-700'
      } ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          enabled ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  </div>
);

const LayerBreakdownBar = ({ 
  layer1, 
  layer2, 
  layer3Enabled 
}: { 
  layer1: number; 
  layer2: number; 
  layer3Enabled: boolean;
}) => {
  const total = layer1 + Math.abs(layer2);
  const layer1Width = total > 0 ? (layer1 / total) * 100 : 100;
  
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-400">Layer Breakdown</span>
        <span className="text-gray-500">L1 + L2 {layer3Enabled ? '+ L3' : ''}</span>
      </div>
      
      <div className="h-2 rounded-full bg-gray-800 overflow-hidden flex">
        {/* Layer 1 - Technical */}
        <div 
          className="h-full bg-blue-500 transition-all duration-300"
          style={{ width: `${layer1Width}%` }}
          title={`Layer 1: ${layer1}%`}
        />
        {/* Layer 2 - Sentiment boost/reduction */}
        <div 
          className={`h-full transition-all duration-300 ${layer2 >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`}
          style={{ width: `${100 - layer1Width}%` }}
          title={`Layer 2: ${layer2 >= 0 ? '+' : ''}${layer2}%`}
        />
      </div>
      
      <div className="flex items-center gap-4 text-xs">
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-blue-500" />
          <span className="text-gray-400">Technical: {layer1}%</span>
        </div>
        <div className="flex items-center gap-1">
          <div className={`w-2 h-2 rounded-full ${layer2 >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`} />
          <span className="text-gray-400">Sentiment: {layer2 >= 0 ? '+' : ''}{layer2}%</span>
        </div>
        {layer3Enabled && (
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-purple-500" />
            <span className="text-gray-400">AI: ON</span>
          </div>
        )}
      </div>
    </div>
  );
};

const ValidationChecklist = ({ validations }: { validations: UnifiedSignal['validations'] }) => {
  const checks = [
    { key: 'trend_alignment', label: 'Trend Alignment', value: validations.trend_alignment },
    { key: 'ema_order_valid', label: 'EMA Order', value: validations.ema_order_valid },
    { key: 'zone_proximity', label: 'Zone Proximity', value: validations.zone_proximity },
    { key: 'risk_reward_valid', label: 'RRR ≥ 2', value: validations.risk_reward_valid },
    { key: 'volume_confirmation', label: 'Volume', value: validations.volume_confirmation },
    { key: 'atr_valid', label: 'Volatility', value: validations.atr_valid },
  ];
  
  return (
    <div className="grid grid-cols-2 gap-2">
      {checks.map(check => (
        <div key={check.key} className="flex items-center gap-2 text-xs">
          <span className={check.value ? 'text-emerald-400' : 'text-red-400'}>
            {check.value ? '✓' : '✗'}
          </span>
          <span className={check.value ? 'text-gray-300' : 'text-gray-500'}>
            {check.label}
          </span>
        </div>
      ))}
    </div>
  );
};

// ==================== MAIN COMPONENT ====================

export function UnifiedSignalCard({
  signal,
  isLoading = false,
  onRefresh,
  sentimentEnabled = true,
  onSentimentToggle,
  geminiEnabled = false,
  onGeminiToggle,
  layerBreakdown
}: UnifiedSignalCardProps) {
  const [showDetails, setShowDetails] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  
  const quality = useSignalQuality(signal);
  
  // Loading state
  if (isLoading) {
    return (
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
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
  
  // No signal state
  if (!signal) {
    return (
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        {/* Header with settings */}
        <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
            🎯 Smart Signal
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="p-1.5 rounded-lg hover:bg-gray-800 transition-colors text-gray-500 hover:text-gray-300"
              title="Settings"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            {onRefresh && (
              <button
                onClick={onRefresh}
                className="p-1.5 rounded-lg hover:bg-gray-800 transition-colors text-gray-500 hover:text-gray-300"
                title="Refresh"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            )}
          </div>
        </div>
        
        {/* Settings panel */}
        {showSettings && (
          <div className="px-5 py-3 border-b border-gray-800 bg-gray-800/30">
            {onSentimentToggle && (
              <ToggleSwitch
                enabled={sentimentEnabled}
                onToggle={onSentimentToggle}
                label="Layer 2: Sentiment"
                sublabel="KOL API (2 credits)"
              />
            )}
            {onGeminiToggle && (
              <ToggleSwitch
                enabled={geminiEnabled}
                onToggle={onGeminiToggle}
                label="Layer 3: AI Context"
                sublabel="Gemini (optional)"
              />
            )}
          </div>
        )}
        
        <div className="px-5 py-8">
          <div className="flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 rounded-full bg-gray-800 flex items-center justify-center mb-4">
              <span className="text-3xl">📊</span>
            </div>
            <p className="text-gray-400 mb-2">Menunggu signal...</p>
            <p className="text-xs text-gray-500">Signal akan muncul ketika ada setup yang valid</p>
          </div>
        </div>
      </div>
    );
  }
  
  // Signal found - main card
  const isBuy = signal.signal_type === 'BUY';
  const recStyle = getRecommendationStyle(signal.recommendation);
  
  return (
    <div className={`bg-gray-900 rounded-xl border overflow-hidden ${
      isBuy ? 'border-emerald-500/30' : 'border-red-500/30'
    }`}>
      {/* Header */}
      <div className={`px-5 py-4 border-b border-gray-800 ${
        isBuy ? 'bg-emerald-500/5' : 'bg-red-500/5'
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
              🎯 Smart Signal
            </h3>
            
            {/* Grade badge */}
            <div className={`px-2 py-0.5 rounded text-xs font-bold ${getGradeBgColor(signal.quality_grade)} border`}>
              Grade {signal.quality_grade}
            </div>
            
            {/* Recommendation badge */}
            <div className={`px-2 py-0.5 rounded text-xs ${recStyle.bg} ${recStyle.text}`}>
              {recStyle.icon} {signal.recommendation}
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="p-1.5 rounded-lg hover:bg-gray-800 transition-colors text-gray-500 hover:text-gray-300"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
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
      
      {/* Settings panel */}
      {showSettings && (
        <div className="px-5 py-3 border-b border-gray-800 bg-gray-800/30">
          {onSentimentToggle && (
            <ToggleSwitch
              enabled={sentimentEnabled}
              onToggle={onSentimentToggle}
              label="Layer 2: Sentiment"
              sublabel="KOL API validation"
            />
          )}
          {onGeminiToggle && (
            <ToggleSwitch
              enabled={geminiEnabled}
              onToggle={onGeminiToggle}
              label="Layer 3: AI Context"
              sublabel="Gemini explanation"
            />
          )}
        </div>
      )}
      
      {/* Main signal display */}
      <div className="px-5 py-4">
        {/* Signal type and confidence */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`text-3xl font-bold ${isBuy ? 'text-emerald-400' : 'text-red-400'}`}>
              {isBuy ? '📈 BUY' : '📉 SELL'}
            </div>
            <div className="text-sm text-gray-400">
              {signal.symbol}
            </div>
          </div>
          
          {/* Confidence meter */}
          <div className="text-right">
            <div className="text-2xl font-bold text-white">
              {signal.final_confidence}%
            </div>
            <div className="text-xs text-gray-500">
              {quality.strengthLabel}
            </div>
          </div>
        </div>
        
        {/* Entry, SL, TP levels */}
        <div className="grid grid-cols-4 gap-3 mb-4">
          <div className="bg-gray-800/50 rounded-lg p-3">
            <div className="text-xs text-gray-500 mb-1">Entry</div>
            <div className="text-sm font-medium text-white">{formatPrice(signal.entry)}</div>
          </div>
          <div className="bg-red-500/10 rounded-lg p-3 border border-red-500/20">
            <div className="text-xs text-red-400 mb-1">Stop Loss</div>
            <div className="text-sm font-medium text-red-400">{formatPrice(signal.stop_loss)}</div>
          </div>
          <div className="bg-emerald-500/10 rounded-lg p-3 border border-emerald-500/20">
            <div className="text-xs text-emerald-400 mb-1">TP1</div>
            <div className="text-sm font-medium text-emerald-400">{formatPrice(signal.take_profit_1)}</div>
          </div>
          <div className="bg-emerald-500/10 rounded-lg p-3 border border-emerald-500/20">
            <div className="text-xs text-emerald-400 mb-1">TP2</div>
            <div className="text-sm font-medium text-emerald-400">{formatPrice(signal.take_profit_2)}</div>
          </div>
        </div>
        
        {/* Layer breakdown */}
        {layerBreakdown && (
          <div className="mb-4 p-3 bg-gray-800/30 rounded-lg">
            <LayerBreakdownBar 
              layer1={layerBreakdown.layer1}
              layer2={layerBreakdown.layer2}
              layer3Enabled={layerBreakdown.layer3}
            />
          </div>
        )}
        
        {/* Market validation status */}
        {signal.market_validation && (
          <div className={`mb-4 p-3 rounded-lg flex items-center gap-2 ${
            signal.market_validation === 'ALIGNED' 
              ? 'bg-emerald-500/10 border border-emerald-500/20' 
              : signal.market_validation === 'CONFLICTING'
              ? 'bg-red-500/10 border border-red-500/20'
              : 'bg-gray-800/50'
          }`}>
            <span className="text-lg">
              {signal.market_validation === 'ALIGNED' ? '✅' : 
               signal.market_validation === 'CONFLICTING' ? '⚠️' : '📊'}
            </span>
            <div>
              <div className={`text-sm font-medium ${
                signal.market_validation === 'ALIGNED' ? 'text-emerald-400' :
                signal.market_validation === 'CONFLICTING' ? 'text-red-400' : 'text-gray-400'
              }`}>
                Market Sentiment: {signal.market_validation}
              </div>
              {signal.sentiment && (
                <div className="text-xs text-gray-500">
                  {signal.sentiment.sentiment} ({signal.sentiment.confidence}%) | Fear/Greed: {signal.sentiment.fear_greed_index}
                </div>
              )}
            </div>
          </div>
        )}
        
        {/* Expand/collapse details */}
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="w-full py-2 text-sm text-gray-400 hover:text-gray-300 flex items-center justify-center gap-2"
        >
          {showDetails ? 'Sembunyikan Detail' : 'Lihat Detail'}
          <svg 
            className={`w-4 h-4 transition-transform ${showDetails ? 'rotate-180' : ''}`} 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>
      
      {/* Details section */}
      {showDetails && (
        <div className="px-5 py-4 border-t border-gray-800 space-y-4">
          {/* Confidence breakdown */}
          <div>
            <h4 className="text-xs text-gray-500 uppercase mb-2">Confidence Breakdown</h4>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">Trend</span>
                <div className="flex items-center gap-2">
                  <div className="w-24 h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-blue-500" 
                      style={{ width: `${signal.trend_confidence}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-300">{signal.trend_confidence}%</span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">Zone</span>
                <div className="flex items-center gap-2">
                  <div className="w-24 h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-purple-500" 
                      style={{ width: `${signal.zone_confidence}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-300">{signal.zone_confidence}%</span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">RRR</span>
                <div className="flex items-center gap-2">
                  <div className="w-24 h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-emerald-500" 
                      style={{ width: `${signal.riskReward_confidence}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-300">{signal.riskReward_confidence}%</span>
                </div>
              </div>
            </div>
          </div>
          
          {/* Validation checklist */}
          <div>
            <h4 className="text-xs text-gray-500 uppercase mb-2">Validation Checklist</h4>
            <ValidationChecklist validations={signal.validations} />
          </div>
          
          {/* Reasons list */}
          <div>
            <h4 className="text-xs text-gray-500 uppercase mb-2">Alasan Signal</h4>
            <div className="space-y-1">
              {signal.reasons_list.map((reason, i) => (
                <p key={i} className="text-xs text-gray-400">{reason}</p>
              ))}
            </div>
          </div>
          
          {/* AI explanation if available */}
          {signal.gemini_context && (
            <div className="mt-4 p-3 bg-purple-500/10 rounded-lg border border-purple-500/20">
              <h4 className="text-xs text-purple-400 uppercase mb-2 flex items-center gap-2">
                <span>🤖</span> AI Explanation
              </h4>
              <div className="text-xs text-gray-300 whitespace-pre-wrap">
                {signal.gemini_context}
              </div>
            </div>
          )}
        </div>
      )}
      
      {/* Warnings footer */}
      {quality.warningCount > 0 && (
        <div className="px-5 py-3 border-t border-gray-800 bg-yellow-500/5">
          <div className="flex items-start gap-2">
            <span className="text-yellow-400">⚠️</span>
            <div className="text-xs text-yellow-400/80">
              {quality.warnings.map((w, i) => (
                <p key={i}>• {w}</p>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default UnifiedSignalCard;
