'use client';

import React, { useState } from 'react';
import type { InstitutionalOutput } from '../../lib/unifiedSignalGenerator';
import { useInstitutionalQuality } from './useSmartSignal';

// ==================== TYPES ====================

interface InstitutionalSignalCardProps {
  signal: InstitutionalOutput | null;
  isLoading?: boolean;
  onRefresh?: () => void;
  onRecordWin?: () => void;
  onRecordLoss?: () => void;
  
  // Controls
  enabled?: boolean;
  onToggle?: (enabled: boolean) => void;
  tier?: string;
  onTierChange?: (tier: string) => void;
}

// ==================== HELPERS ====================

const formatPrice = (price: number | null): string => {
  if (price === null) return '-';
  if (price >= 1000) return price.toFixed(2);
  if (price >= 1) return price.toFixed(4);
  return price.toFixed(6);
};

const gradeStyles: Record<string, { bg: string; text: string; border: string; glow: string }> = {
  'A+': { bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/40', glow: 'shadow-amber-500/20' },
  'A': { bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/40', glow: 'shadow-emerald-500/20' },
  'B': { bg: 'bg-blue-500/15', text: 'text-blue-400', border: 'border-blue-500/40', glow: 'shadow-blue-500/20' },
  'NO_TRADE': { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/30', glow: '' },
};

// ==================== COMPONENTS ====================

/** Score bar for individual scoring factors */
const ScoreBar = ({ label, value, max }: { label: string; value: number; max: number }) => {
  const pct = max > 0 ? (value / max) * 100 : 0;
  const color = pct >= 75 ? 'bg-emerald-500' : pct >= 50 ? 'bg-blue-500' : pct >= 25 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-400 w-24 truncate">{label}</span>
      <div className="flex-1 h-1.5 bg-gray-700/50 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-300 w-10 text-right">{value}/{max}</span>
    </div>
  );
};

/** Step result row */
const StepRow = ({ step, name, passed, reason }: { step: number; name: string; passed: boolean; reason: string }) => (
  <div className={`flex items-start gap-2 py-1.5 ${passed ? '' : 'opacity-70'}`}>
    <span className={`text-xs mt-0.5 ${passed ? 'text-emerald-400' : 'text-red-400'}`}>
      {passed ? '✓' : '✗'}
    </span>
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-gray-500">#{step}</span>
        <span className="text-xs text-gray-300 font-medium">{name}</span>
      </div>
      <p className="text-[10px] text-gray-500 truncate">{reason}</p>
    </div>
  </div>
);

/** Cooldown banner */
const CooldownBanner = ({ reason, remaining }: { reason: string; remaining: number }) => (
  <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg px-3 py-2 mb-3">
    <div className="flex items-center gap-2">
      <span className="text-orange-400 text-sm">🔒</span>
      <div>
        <p className="text-xs text-orange-300 font-medium">COOLDOWN ACTIVE</p>
        <p className="text-[10px] text-orange-400/80">{reason}</p>
        {remaining > 0 && (
          <p className="text-[10px] text-orange-500">{remaining} candles remaining</p>
        )}
      </div>
    </div>
  </div>
);

// ==================== MAIN COMPONENT ====================

export default function InstitutionalSignalCard({
  signal,
  isLoading = false,
  onRefresh,
  onRecordWin,
  onRecordLoss,
  enabled = true,
  onToggle,
  tier,
  onTierChange,
}: InstitutionalSignalCardProps) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_showDetails, _setShowDetails] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _quality = useInstitutionalQuality(signal);

  // Loading state
  if (isLoading) {
    return (
      <div className="bg-[#161B22] border border-gray-700/50 rounded-xl p-4 animate-pulse">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-16 h-8 bg-gray-700 rounded" />
          <div className="flex-1 h-4 bg-gray-700 rounded" />
        </div>
        <div className="space-y-2">
          <div className="h-3 bg-gray-700 rounded w-3/4" />
          <div className="h-3 bg-gray-700 rounded w-1/2" />
          <div className="h-3 bg-gray-700 rounded w-2/3" />
        </div>
      </div>
    );
  }

  // No signal / engine disabled
  if (!signal) {
    return (
      <div className="bg-[#161B22] border border-gray-700/50 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-base">🏦</span>
            <span className="text-sm font-medium text-gray-300">Institutional Engine</span>
          </div>
          {onToggle && (
            <button
              onClick={() => onToggle(!enabled)}
              className={`relative inline-flex items-center h-5 w-9 rounded-full transition-colors ${
                enabled ? 'bg-emerald-500' : 'bg-gray-700'
              }`}
            >
              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
              }`} />
            </button>
          )}
        </div>
        <p className="text-xs text-gray-500">
          {enabled ? 'Waiting for data (need 200+ candles)...' : 'Institutional engine disabled'}
        </p>
      </div>
    );
  }

  const gs = gradeStyles[signal.grade] || gradeStyles['NO_TRADE'];
  const isTrade = signal.decision === 'TRADE';
  const dirColor = signal.direction === 'BUY' ? 'text-emerald-400' : signal.direction === 'SELL' ? 'text-red-400' : 'text-gray-400';
  const dirBg = signal.direction === 'BUY' ? 'bg-emerald-500/15' : signal.direction === 'SELL' ? 'bg-red-500/15' : 'bg-gray-500/15';

  return (
    <div className={`bg-[#161B22] border rounded-xl overflow-hidden ${gs.border} ${gs.glow ? `shadow-lg ${gs.glow}` : ''}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700/30">
        <div className="flex items-center gap-2">
          <span className="text-base">🏦</span>
          <span className="text-sm font-medium text-gray-300">Institutional Engine</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Tier selector */}
          {onTierChange && (
            <select
              value={tier || 'PRO'}
              onChange={(e) => onTierChange(e.target.value)}
              className="bg-gray-800 border border-gray-600/50 text-xs text-gray-300 rounded px-2 py-1"
            >
              <option value="FREE">FREE</option>
              <option value="PRO">PRO</option>
              <option value="ELITE">ELITE</option>
            </select>
          )}
          {/* Refresh */}
          {onRefresh && (
            <button
              onClick={onRefresh}
              className="text-gray-400 hover:text-gray-200 transition-colors p-1"
              title="Re-analyze"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          )}
          {/* Toggle */}
          {onToggle && (
            <button
              onClick={() => onToggle(!enabled)}
              className={`relative inline-flex items-center h-5 w-9 rounded-full transition-colors ${
                enabled ? 'bg-emerald-500' : 'bg-gray-700'
              }`}
            >
              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
              }`} />
            </button>
          )}
        </div>
      </div>

      <div className="p-4 space-y-3">
        {/* Cooldown */}
        {signal.cooldown && (
          <CooldownBanner
            reason={signal.discipline.cooldown_reason}
            remaining={signal.discipline.locked_candles_remaining}
          />
        )}

        {/* Grade + Direction + Decision */}
        <div className="flex items-center gap-3">
          {/* Grade badge */}
          <div className={`px-3 py-1.5 rounded-lg ${gs.bg} border ${gs.border}`}>
            <span className={`text-xl font-bold ${gs.text}`}>{signal.grade}</span>
          </div>

          {/* Direction + Market condition */}
          <div className="flex-1">
            <div className="flex items-center gap-2">
              {isTrade && (
                <span className={`px-2 py-0.5 rounded text-xs font-bold ${dirBg} ${dirColor}`}>
                  {signal.direction}
                </span>
              )}
              <span className={`text-xs ${isTrade ? 'text-emerald-400' : 'text-red-400'}`}>
                {signal.decision}
              </span>
            </div>
            <p className="text-[10px] text-gray-500 mt-0.5">
              {signal.market_condition} / {signal.volatility_quality}
            </p>
          </div>

          {/* Confidence circle */}
          <div className="relative w-12 h-12">
            <svg viewBox="0 0 36 36" className="transform -rotate-90 w-12 h-12">
              <circle cx="18" cy="18" r="16" fill="none" stroke="#21262D" strokeWidth="3" />
              <circle
                cx="18" cy="18" r="16" fill="none"
                stroke={isTrade ? (signal.grade === 'A+' ? '#F59E0B' : '#26A65B') : '#E85C5C'}
                strokeWidth="3"
                strokeDasharray={`${signal.confidence} 100`}
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-xs font-bold text-gray-200">{signal.confidence}</span>
            </div>
          </div>
        </div>

        {/* Score Breakdown */}
        <div className="space-y-1.5">
          <ScoreBar label="Trend" value={signal.score_breakdown.trend_clarity} max={25} />
          <ScoreBar label="Structure" value={signal.score_breakdown.structure_validity} max={20} />
          <ScoreBar label="Zone" value={signal.score_breakdown.zone_quality} max={20} />
          <ScoreBar label="Entry" value={signal.score_breakdown.entry_candle} max={15} />
          <ScoreBar label="Sentiment" value={signal.score_breakdown.sentiment_alignment} max={10} />
          <ScoreBar label="RRR Bonus" value={signal.score_breakdown.rrr_bonus} max={10} />
          <div className="flex items-center gap-2 pt-1 border-t border-gray-700/30">
            <span className="text-xs text-gray-300 w-24 font-medium">Total</span>
            <div className="flex-1 h-2 bg-gray-700/50 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  signal.score_breakdown.total >= 90 ? 'bg-amber-500' :
                  signal.score_breakdown.total >= 80 ? 'bg-emerald-500' :
                  signal.score_breakdown.total >= 70 ? 'bg-blue-500' : 'bg-red-500'
                }`}
                style={{ width: `${signal.score_breakdown.total}%` }}
              />
            </div>
            <span className="text-xs font-bold text-gray-200 w-10 text-right">{signal.score_breakdown.total}/100</span>
          </div>
        </div>

        {/* Trade Levels (only if TRADE) */}
        {isTrade && signal.entry !== null && (
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-gray-800/50 rounded-lg p-2">
              <p className="text-[10px] text-gray-500 mb-0.5">Entry</p>
              <p className="text-sm font-mono text-gray-200">{formatPrice(signal.entry)}</p>
            </div>
            <div className="bg-gray-800/50 rounded-lg p-2">
              <p className="text-[10px] text-red-400 mb-0.5">Stop Loss</p>
              <p className="text-sm font-mono text-red-300">{formatPrice(signal.stop_loss)}</p>
            </div>
            {signal.take_profit.map((tp, i) => (
              <div key={i} className="bg-gray-800/50 rounded-lg p-2">
                <p className="text-[10px] text-emerald-400 mb-0.5">TP{i + 1}</p>
                <p className="text-sm font-mono text-emerald-300">{formatPrice(tp)}</p>
              </div>
            ))}
          </div>
        )}

        {/* Reasons */}
        {signal.reason.length > 0 && (
          <div className="space-y-1">
            {signal.reason.map((r, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <span className="text-emerald-400 text-xs mt-0.5">•</span>
                <span className="text-xs text-gray-400">{r}</span>
              </div>
            ))}
          </div>
        )}

        {/* Invalidation conditions */}
        {isTrade && signal.invalid_if.length > 0 && (
          <div className="bg-red-500/5 border border-red-500/10 rounded-lg px-3 py-2">
            <p className="text-[10px] text-red-400 font-medium mb-1">INVALID IF:</p>
            {signal.invalid_if.map((c, i) => (
              <p key={i} className="text-[10px] text-red-400/80">• {c.label} — {c.description}</p>
            ))}
          </div>
        )}

        {/* Tier filter warning */}
        {!signal.tier_filter.allowed && (
          <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg px-3 py-2">
            <p className="text-xs text-purple-300">🔐 {signal.tier_filter.reason}</p>
          </div>
        )}

        {/* Record trade result buttons (only if TRADE) */}
        {isTrade && (onRecordWin || onRecordLoss) && (
          <div className="flex gap-2 pt-1">
            {onRecordWin && (
              <button
                onClick={onRecordWin}
                className="flex-1 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-xs text-emerald-400 hover:bg-emerald-500/20 transition-colors"
              >
                ✓ Win
              </button>
            )}
            {onRecordLoss && (
              <button
                onClick={onRecordLoss}
                className="flex-1 py-1.5 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400 hover:bg-red-500/20 transition-colors"
              >
                ✗ Loss
              </button>
            )}
          </div>
        )}

        {/* Expandable: Step Details */}
        <button
          onClick={() => setShowSteps(!showSteps)}
          className="w-full flex items-center justify-between py-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          <span>11-Step Analysis Details</span>
          <svg className={`w-3.5 h-3.5 transition-transform ${showSteps ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showSteps && (
          <div className="space-y-0.5 border-t border-gray-700/30 pt-2">
            {signal.step_results.map((step) => (
              <StepRow
                key={step.step}
                step={step.step}
                name={step.name}
                passed={step.passed}
                reason={step.reason}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
