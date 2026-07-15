/**
 * PROBABILITY ENGINE — Dashboard UI Component
 * ==============================================
 * 
 * Professional trading dashboard displaying all engine output.
 * Shows: Signal, Phases, Confidence, Risk, Levels, and Justification.
 */

'use client';

import React from 'react';
import type { EngineOutput, PhaseResult, ConfidenceBreakdown } from '@/app/lib/probabilityEngine';

// ─── Props ───

interface ProbabilityDashboardProps {
  output: EngineOutput | null;
  loading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
}

// ─── Color palette ───

const colors = {
  bg: '#0D1117',
  card: '#161B22',
  cardBorder: '#21262D',
  text: '#E6EDF3',
  textMuted: '#8B949E',
  textDim: '#484F58',
  buy: '#26A65B',
  buyBg: 'rgba(38,166,91,0.12)',
  sell: '#E85C5C',
  sellBg: 'rgba(232,92,92,0.12)',
  wait: '#D29922',
  waitBg: 'rgba(210,153,34,0.12)',
  blue: '#58A6FF',
  blueBg: 'rgba(88,166,255,0.08)',
  phasePass: '#26A65B',
  phaseFail: '#E85C5C',
  phaseWait: '#484F58',
};

// ─── Sub-Components ───

function SignalBadge({ signal }: { signal: 'BUY' | 'SELL' | 'WAIT' }) {
  const config = {
    BUY: { color: colors.buy, bg: colors.buyBg, label: 'BUY' },
    SELL: { color: colors.sell, bg: colors.sellBg, label: 'SELL' },
    WAIT: { color: colors.wait, bg: colors.waitBg, label: 'WAIT' },
  }[signal];

  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      padding: '8px 20px', borderRadius: 8,
      background: config.bg, border: `1px solid ${config.color}`,
      fontSize: 24, fontWeight: 700, color: config.color,
      letterSpacing: 2,
    }}>
      <span style={{
        width: 10, height: 10, borderRadius: '50%',
        background: config.color,
        boxShadow: `0 0 8px ${config.color}`,
      }} />
      {config.label}
    </div>
  );
}

function PhaseRow({ phase }: { phase: PhaseResult }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '6px 0', borderBottom: `1px solid ${colors.cardBorder}`,
    }}>
      <span style={{
        width: 22, height: 22, borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 600,
        background: phase.passed ? colors.phasePass : colors.phaseFail,
        color: '#fff',
        flexShrink: 0,
      }}>
        {phase.passed ? '✓' : '✗'}
      </span>
      <span style={{ fontSize: 12, color: colors.textMuted, minWidth: 20 }}>
        P{phase.phase}
      </span>
      <span style={{ fontSize: 13, color: colors.text, flex: 1 }}>
        {phase.name}
      </span>
      <span style={{
        fontSize: 11, color: phase.passed ? colors.phasePass : colors.phaseFail,
        maxWidth: 260, textAlign: 'right', overflow: 'hidden',
        textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }} title={phase.reason}>
        {phase.reason}
      </span>
    </div>
  );
}

function ConfidenceBar({ breakdown }: { breakdown: ConfidenceBreakdown }) {
  const items: Array<{ label: string; value: number; max: number; color: string }> = [
    { label: 'Regime', value: breakdown.regimeClarity, max: 15, color: '#58A6FF' },
    { label: 'HTF', value: breakdown.htfAlignment, max: 20, color: '#A371F7' },
    { label: 'Setup', value: breakdown.mtfSetupQuality, max: 15, color: '#26A65B' },
    { label: 'LTF', value: breakdown.ltfConfirmation, max: 10, color: '#D29922' },
    { label: 'Indikator', value: breakdown.indicatorConfluence, max: 15, color: '#F778BA' },
    { label: 'Level', value: breakdown.keyLevelValidation, max: 15, color: '#79C0FF' },
    { label: 'R:R', value: breakdown.riskRewardViability, max: 10, color: '#7EE787' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map(item => (
        <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: colors.textMuted, minWidth: 60 }}>{item.label}</span>
          <div style={{
            flex: 1, height: 6, borderRadius: 3,
            background: colors.cardBorder, overflow: 'hidden',
          }}>
            <div style={{
              height: '100%', borderRadius: 3,
              width: `${(item.value / item.max) * 100}%`,
              background: item.color,
              transition: 'width 0.3s ease',
            }} />
          </div>
          <span style={{ fontSize: 11, color: colors.text, minWidth: 32, textAlign: 'right' }}>
            {item.value}/{item.max}
          </span>
        </div>
      ))}
    </div>
  );
}

function MetricCard({ label, value, unit, color }: {
  label: string; value: string | number; unit?: string; color?: string;
}) {
  return (
    <div style={{
      padding: '10px 12px', borderRadius: 6,
      background: colors.card, border: `1px solid ${colors.cardBorder}`,
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: color || colors.text }}>
        {value}{unit && <span style={{ fontSize: 11, color: colors.textMuted }}> {unit}</span>}
      </div>
    </div>
  );
}

// ─── Main Component ───

export default function ProbabilityDashboard({ output, loading, error, onRefresh }: ProbabilityDashboardProps) {

  // Waiting/empty state
  if (!output && !loading && !error) {
    return (
      <div style={{
        padding: 32, textAlign: 'center', color: colors.textMuted,
        background: colors.bg, borderRadius: 12,
      }}>
        <div style={{ fontSize: 18, marginBottom: 8 }}>Probability Engine</div>
        <div style={{ fontSize: 13 }}>Menunggu data candle...</div>
      </div>
    );
  }

  const signalColor = output?.signal === 'BUY' ? colors.buy
    : output?.signal === 'SELL' ? colors.sell
    : colors.wait;

  const regimeLabel = output?.marketRegime?.replace(/_/g, ' ') || 'N/A';
  const dirLabel = output?.htfTrendDirection || 'N/A';

  return (
    <div style={{
      background: colors.bg, borderRadius: 12, padding: 16,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color: colors.text, maxWidth: 480,
    }}>
      {/* === HEADER === */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 16,
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>
            Probability Engine
          </div>
          <div style={{ fontSize: 11, color: colors.textMuted }}>
            {output?.symbol} · {output?.timeframe} · {output ? new Date(output.timestamp).toLocaleTimeString() : ''}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {loading && (
            <span style={{ fontSize: 11, color: colors.blue }}>Analyzing...</span>
          )}
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={loading}
              style={{
                padding: '4px 10px', borderRadius: 4, border: `1px solid ${colors.cardBorder}`,
                background: colors.card, color: colors.textMuted, cursor: 'pointer',
                fontSize: 11, opacity: loading ? 0.5 : 1,
              }}
            >
              ↻ Refresh
            </button>
          )}
        </div>
      </div>

      {/* === ERROR === */}
      {error && (
        <div style={{
          padding: 10, borderRadius: 6, marginBottom: 12,
          background: colors.sellBg, border: `1px solid ${colors.sell}`,
          fontSize: 12, color: colors.sell,
        }}>
          Error: {error}
        </div>
      )}

      {output && (
        <>
          {/* === SIGNAL === */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 16px', borderRadius: 8, marginBottom: 12,
            background: output.signal === 'WAIT' ? colors.waitBg : output.signal === 'BUY' ? colors.buyBg : colors.sellBg,
            border: `1px solid ${signalColor}30`,
          }}>
            <SignalBadge signal={output.signal} />
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: signalColor }}>
                {output.confidenceScore}%
              </div>
              <div style={{ fontSize: 10, color: colors.textMuted }}>Confidence Score</div>
            </div>
          </div>

          {/* === KEY METRICS === */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 6, marginBottom: 12,
          }}>
            <MetricCard
              label="Entry"
              value={output.entryPrice?.toFixed(2) || '—'}
              color={signalColor}
            />
            <MetricCard
              label="Stop Loss"
              value={output.stopLoss?.toFixed(2) || '—'}
              color={colors.sell}
            />
            <MetricCard
              label="TP1"
              value={output.takeProfit1?.toFixed(2) || '—'}
              color={colors.buy}
            />
            <MetricCard
              label="R:R"
              value={output.riskRewardRatio ? `1:${output.riskRewardRatio.toFixed(1)}` : '—'}
              color={output.riskRewardRatio >= 2 ? colors.buy : colors.sell}
            />
          </div>

          {/* === MARKET INFO BAR === */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 6, marginBottom: 12,
          }}>
            <MetricCard label="Market Regime" value={regimeLabel} />
            <MetricCard label="HTF Trend" value={dirLabel} color={
              dirLabel === 'BULLISH' ? colors.buy : dirLabel === 'BEARISH' ? colors.sell : colors.wait
            } />
            <MetricCard
              label="Setup"
              value={output.setupType?.replace(/_/g, ' ') || 'NONE'}
            />
          </div>

          {/* === RISK & POSITION === */}
          {output.risk && output.signal !== 'WAIT' && (
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 6, marginBottom: 12,
            }}>
              <MetricCard label="Position Size" value={output.positionSize.toFixed(4)} />
              <MetricCard label="Risk ($)" value={output.risk.riskAmount.toFixed(2)} color={colors.sell} />
              <MetricCard label="Reward ($)" value={output.risk.potentialReward.toFixed(2)} color={colors.buy} />
              <MetricCard label="EV ($)" value={output.estimatedExpectedValue.toFixed(2)} color={
                output.estimatedExpectedValue > 0 ? colors.buy : colors.sell
              } />
            </div>
          )}

          {/* === PHASE STATUS === */}
          <div style={{
            padding: 12, borderRadius: 8, marginBottom: 12,
            background: colors.card, border: `1px solid ${colors.cardBorder}`,
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, marginBottom: 8 }}>
              7-Phase Pipeline
            </div>
            {output.phases.map((phase: PhaseResult) => (
              <PhaseRow key={phase.phase} phase={phase} />
            ))}
            {output.phases.length === 0 && (
              <div style={{ fontSize: 12, color: colors.textDim, padding: 8 }}>
                Menunggu data...
              </div>
            )}
          </div>

          {/* === CONFIDENCE BREAKDOWN === */}
          <div style={{
            padding: 12, borderRadius: 8, marginBottom: 12,
            background: colors.card, border: `1px solid ${colors.cardBorder}`,
          }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              marginBottom: 8,
            }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted }}>
                Confidence Breakdown
              </span>
              <span style={{
                fontSize: 16, fontWeight: 700,
                color: output.confidenceScore >= 80 ? colors.buy
                  : output.confidenceScore >= 60 ? colors.wait : colors.sell,
              }}>
                {output.confidenceScore}/100
              </span>
            </div>
            <ConfidenceBar breakdown={output.confidenceBreakdown} />
          </div>

          {/* === INDICATORS === */}
          <div style={{
            padding: 12, borderRadius: 8, marginBottom: 12,
            background: colors.card, border: `1px solid ${colors.cardBorder}`,
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, marginBottom: 8 }}>
              Indicators
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
              <div style={{ fontSize: 11, color: colors.textMuted }}>
                EMA50: <span style={{ color: colors.text }}>{output.indicators.ema50.toFixed(2)}</span>
              </div>
              <div style={{ fontSize: 11, color: colors.textMuted }}>
                EMA200: <span style={{ color: colors.text }}>{output.indicators.ema200.toFixed(2)}</span>
              </div>
              <div style={{ fontSize: 11, color: colors.textMuted }}>
                RSI: <span style={{
                  color: output.indicators.rsi > 70 ? colors.sell
                    : output.indicators.rsi < 30 ? colors.buy : colors.text,
                }}>{output.indicators.rsi.toFixed(1)}</span>
              </div>
              <div style={{ fontSize: 11, color: colors.textMuted }}>
                ADX: <span style={{
                  color: output.indicators.adx > 25 ? colors.buy : colors.textDim,
                }}>{output.indicators.adx.toFixed(1)}</span>
              </div>
              <div style={{ fontSize: 11, color: colors.textMuted }}>
                ATR: <span style={{ color: colors.text }}>{output.indicators.atr.toFixed(4)}</span>
              </div>
              <div style={{ fontSize: 11, color: colors.textMuted }}>
                ATR SMA: <span style={{ color: colors.text }}>{output.indicators.atrSma.toFixed(4)}</span>
              </div>
            </div>
          </div>

          {/* === DISCIPLINE === */}
          <div style={{
            padding: 10, borderRadius: 8, marginBottom: 12,
            background: output.discipline.canTrade ? colors.blueBg : colors.sellBg,
            border: `1px solid ${output.discipline.canTrade ? colors.blue + '30' : colors.sell + '30'}`,
          }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontSize: 12, color: colors.textMuted }}>
                Disiplin: {output.discipline.reason}
              </span>
              <span style={{
                fontSize: 12, fontWeight: 600,
                color: output.discipline.canTrade ? colors.buy : colors.sell,
              }}>
                {output.discipline.tradesRemaining} trade tersisa
              </span>
            </div>
          </div>

          {/* === TECHNICAL JUSTIFICATION === */}
          <div style={{
            padding: 10, borderRadius: 8,
            background: colors.card, border: `1px solid ${colors.cardBorder}`,
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, marginBottom: 6 }}>
              Technical Justification
            </div>
            <div style={{ fontSize: 12, color: colors.text, lineHeight: 1.6 }}>
              {output.technicalJustification}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
