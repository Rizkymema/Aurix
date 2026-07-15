/**
 * Trading Dashboard Widgets
 * ==========================
 * Reusable widgets for Trading Dashboard:
 * - Real-time P&L Meter
 * - Signal Health Gauge
 * - Confirmation Modal
 */

'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';

// ==========================================
// REAL-TIME P&L METER
// ==========================================

interface Position {
  id: string;
  type: 'LONG' | 'SHORT';
  entryPrice: number;
  currentPrice: number;
  size: number;
  leverage?: number;
}

interface PnLMeterProps {
  positions: Position[];
  accountBalance: number;
  currentPrice: number;
  currency?: string;
}

export function RealTimePnLMeter({
  positions,
  accountBalance,
  currentPrice,
  currency = 'USD'
}: PnLMeterProps): React.ReactElement {
  const [animatedPnL, setAnimatedPnL] = useState(0);

  // Calculate total P&L
  const { totalPnL, pnlPercent, isProfit } = useMemo(() => {
    let total = 0;

    for (const pos of positions) {
      const priceDiff = pos.type === 'LONG'
        ? currentPrice - pos.entryPrice
        : pos.entryPrice - currentPrice;
      
      const positionPnL = priceDiff * pos.size * (pos.leverage || 1);
      total += positionPnL;
    }

    return {
      totalPnL: total,
      pnlPercent: accountBalance > 0 ? (total / accountBalance) * 100 : 0,
      isProfit: total >= 0
    };
  }, [positions, currentPrice, accountBalance]);

  // Animate P&L changes
  useEffect(() => {
    const startValue = animatedPnL;
    const duration = 300;
    const diff = totalPnL - startValue;
    const startTime = Date.now();

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
      
      setAnimatedPnL(startValue + diff * eased);

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };

    requestAnimationFrame(animate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalPnL]);

  const formatCurrency = (value: number) => {
    const prefix = value >= 0 ? '+' : '';
    return `${prefix}${currency}${Math.abs(value).toFixed(2)}`;
  };

  const formatPercent = (value: number) => {
    const prefix = value >= 0 ? '+' : '';
    return `${prefix}${value.toFixed(2)}%`;
  };

  return (
    <div className={`rounded-xl p-4 border transition-all duration-300 ${
      isProfit 
        ? 'bg-emerald-500/10 border-emerald-500/30' 
        : 'bg-red-500/10 border-red-500/30'
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-gray-400">Running P&L</span>
        <div className={`flex items-center gap-1 text-xs ${
          isProfit ? 'text-emerald-400' : 'text-red-400'
        }`}>
          <span>{isProfit ? '📈' : '📉'}</span>
          <span>{positions.length} position{positions.length !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {/* Main P&L Display */}
      <div className="text-center mb-3">
        <div className={`text-3xl font-bold font-mono ${
          isProfit ? 'text-emerald-400' : 'text-red-400'
        }`}>
          {formatPercent(pnlPercent)}
        </div>
        <div className={`text-lg font-mono ${
          isProfit ? 'text-emerald-500/70' : 'text-red-500/70'
        }`}>
          {formatCurrency(animatedPnL)}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="relative h-2 bg-gray-800 rounded-full overflow-hidden">
        <div 
          className={`absolute top-0 h-full rounded-full transition-all duration-300 ${
            isProfit ? 'bg-emerald-500' : 'bg-red-500'
          }`}
          style={{ 
            left: isProfit ? '50%' : `${50 + pnlPercent}%`,
            width: `${Math.min(Math.abs(pnlPercent), 50)}%`,
          }}
        />
        {/* Center line */}
        <div className="absolute top-0 left-1/2 w-0.5 h-full bg-gray-600" />
      </div>

      {/* Balance Info */}
      <div className="flex justify-between mt-3 text-xs text-gray-500">
        <span>Balance: ${accountBalance.toLocaleString()}</span>
        <span>Equity: ${(accountBalance + totalPnL).toLocaleString()}</span>
      </div>
    </div>
  );
}

// ==========================================
// SIGNAL HEALTH GAUGE
// ==========================================

interface SignalHealthGaugeProps {
  confidenceScore: number;
  signalType?: 'BUY' | 'SELL' | 'HOLD' | null;
  showLabels?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export function SignalHealthGauge({
  confidenceScore,
  signalType,
  showLabels = true,
  size = 'md'
}: SignalHealthGaugeProps): React.ReactElement {
  const [animatedScore, setAnimatedScore] = useState(0);

  // Animate score changes
  useEffect(() => {
    const startValue = animatedScore;
    const duration = 500;
    const diff = confidenceScore - startValue;
    const startTime = Date.now();

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      
      setAnimatedScore(startValue + diff * eased);

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };

    requestAnimationFrame(animate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confidenceScore]);

  // Determine status and colors
  const { color, bgColor, statusLabel } = useMemo(() => {
    if (confidenceScore >= 80) {
      return {
        status: 'high',
        color: '#26A65B', // Green
        bgColor: 'rgba(38, 166, 91, 0.2)',
        statusLabel: 'High Probability'
      };
    } else if (confidenceScore >= 75) {
      return {
        status: 'medium',
        color: '#F0B90B', // Yellow
        bgColor: 'rgba(240, 185, 11, 0.2)',
        statusLabel: 'Medium'
      };
    } else {
      return {
        status: 'wait',
        color: '#8B8B8B', // Gray
        bgColor: 'rgba(139, 139, 139, 0.2)',
        statusLabel: 'Wait'
      };
    }
  }, [confidenceScore]);

  // Size configurations
  const sizes = {
    sm: { width: 100, height: 60, strokeWidth: 8, fontSize: 16 },
    md: { width: 150, height: 90, strokeWidth: 10, fontSize: 24 },
    lg: { width: 200, height: 120, strokeWidth: 12, fontSize: 32 },
  };

  const { width, height, strokeWidth, fontSize } = sizes[size];
  const radius = (width - strokeWidth) / 2;
  const circumference = Math.PI * radius; // Half circle
  const progress = (animatedScore / 100) * circumference;

  return (
    <div className="flex flex-col items-center">
      {/* Gauge SVG */}
      <div className="relative" style={{ width, height: height + 20 }}>
        <svg width={width} height={height} className="transform rotate-0">
          {/* Background arc */}
          <path
            d={`M ${strokeWidth / 2} ${height} A ${radius} ${radius} 0 0 1 ${width - strokeWidth / 2} ${height}`}
            fill="none"
            stroke="#21262D"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />
          
          {/* Progress arc */}
          <path
            d={`M ${strokeWidth / 2} ${height} A ${radius} ${radius} 0 0 1 ${width - strokeWidth / 2} ${height}`}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={`${progress} ${circumference}`}
            style={{ transition: 'stroke-dasharray 0.5s ease-out' }}
          />

          {/* Tick marks */}
          {[0, 25, 50, 75, 100].map((tick) => {
            const angle = (tick / 100) * 180;
            const tickRadius = radius - strokeWidth;
            const x = width / 2 + tickRadius * Math.cos((180 - angle) * Math.PI / 180);
            const y = height - tickRadius * Math.sin((180 - angle) * Math.PI / 180);
            
            return (
              <circle 
                key={tick} 
                cx={x} 
                cy={y} 
                r={2} 
                fill="#484F58"
              />
            );
          })}
        </svg>

        {/* Center value */}
        <div 
          className="absolute inset-0 flex flex-col items-center justify-end pb-2"
          style={{ top: height / 2 }}
        >
          <span 
            className="font-bold font-mono"
            style={{ fontSize, color }}
          >
            {Math.round(animatedScore)}%
          </span>
        </div>
      </div>

      {/* Status Label */}
      {showLabels && (
        <div className="mt-2 flex flex-col items-center gap-1">
          <span 
            className="px-3 py-1 rounded-full text-xs font-semibold"
            style={{ backgroundColor: bgColor, color }}
          >
            {statusLabel}
          </span>
          
          {signalType && signalType !== 'HOLD' && (
            <span className={`text-sm font-medium ${
              signalType === 'BUY' ? 'text-emerald-400' : 'text-red-400'
            }`}>
              {signalType} Signal
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ==========================================
// CONFIRMATION MODAL
// ==========================================

interface ConfirmationModalProps {
  isOpen: boolean;
  onCloseAction: () => void;
  onConfirmAction: () => void;
  signalType: 'BUY' | 'SELL';
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2?: number;
  accountBalance: number;
  riskPercent?: number;
  confidenceScore: number;
  symbol: string;
  isLoading?: boolean;
}

export function ConfirmationModal({
  isOpen,
  onCloseAction,
  onConfirmAction,
  signalType,
  entryPrice,
  stopLoss,
  takeProfit1,
  takeProfit2,
  accountBalance,
  riskPercent = 1,
  confidenceScore,
  symbol,
  isLoading = false
}: ConfirmationModalProps): React.ReactElement | null {
  const [countdown, setCountdown] = useState(3);
  const [canConfirm, setCanConfirm] = useState(false);

  // Reset countdown when modal opens
  useEffect(() => {
    if (isOpen) {
      setCountdown(3);
      setCanConfirm(false);
      
      const timer = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            clearInterval(timer);
            setCanConfirm(true);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => clearInterval(timer);
    }
  }, [isOpen]);

  // Calculate risk/reward
  const calculations = useMemo(() => {
    const riskAmount = accountBalance * (riskPercent / 100);
    const riskPips = Math.abs(entryPrice - stopLoss);
    const rewardPipsTP1 = Math.abs(takeProfit1 - entryPrice);
    const rewardPipsTP2 = takeProfit2 ? Math.abs(takeProfit2 - entryPrice) : 0;
    
    const rrrTP1 = riskPips > 0 ? rewardPipsTP1 / riskPips : 0;
    const rrrTP2 = riskPips > 0 ? rewardPipsTP2 / riskPips : 0;
    
    const potentialProfitTP1 = riskAmount * rrrTP1;
    const potentialProfitTP2 = riskAmount * rrrTP2;
    
    const profitPercentTP1 = (potentialProfitTP1 / accountBalance) * 100;
    const profitPercentTP2 = (potentialProfitTP2 / accountBalance) * 100;

    return {
      riskAmount,
      riskPips,
      rrrTP1,
      rrrTP2,
      potentialProfitTP1,
      potentialProfitTP2,
      profitPercentTP1,
      profitPercentTP2
    };
  }, [accountBalance, riskPercent, entryPrice, stopLoss, takeProfit1, takeProfit2]);

  // Handle keyboard
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      
      if (e.key === 'Escape') {
        onCloseAction();
      } else if (e.key === 'Enter' && canConfirm) {
        onConfirmAction();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, canConfirm, onCloseAction, onConfirmAction]);

  if (!isOpen) return null;

  const isBuy = signalType === 'BUY';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onCloseAction}
      />

      {/* Modal */}
      <div className="relative bg-[#161B22] rounded-2xl border border-[#30363D] w-full max-w-md overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className={`px-6 py-4 border-b border-[#30363D] ${
          isBuy ? 'bg-emerald-500/10' : 'bg-red-500/10'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">{isBuy ? '📈' : '📉'}</span>
              <div>
                <h2 className={`text-lg font-bold ${isBuy ? 'text-emerald-400' : 'text-red-400'}`}>
                  Confirm {signalType} Order
                </h2>
                <p className="text-sm text-gray-400">{symbol}</p>
              </div>
            </div>
            <button
              onClick={onCloseAction}
              className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Warning Message */}
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <span className="text-xl">⚠️</span>
              <div>
                <p className="text-yellow-400 font-medium">Apakah Anda yakin?</p>
                <p className="text-sm text-gray-400 mt-1">
                  Risiko Anda adalah <span className="text-red-400 font-semibold">{riskPercent}% (${calculations.riskAmount.toFixed(2)})</span> dengan 
                  potensi profit <span className="text-emerald-400 font-semibold">{calculations.profitPercentTP1.toFixed(1)}% (${calculations.potentialProfitTP1.toFixed(2)})</span>
                </p>
              </div>
            </div>
          </div>

          {/* Signal Health */}
          <div className="flex justify-center py-2">
            <SignalHealthGauge 
              confidenceScore={confidenceScore} 
              signalType={signalType}
              size="sm"
            />
          </div>

          {/* Order Details */}
          <div className="bg-[#0D1117] rounded-lg p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <span className="text-xs text-gray-500">Entry Price</span>
                <p className="font-mono text-blue-400">{entryPrice.toFixed(2)}</p>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-gray-500">Stop Loss</span>
                <p className="font-mono text-red-400">{stopLoss.toFixed(2)}</p>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-gray-500">Take Profit 1</span>
                <p className="font-mono text-emerald-400">{takeProfit1.toFixed(2)}</p>
              </div>
              {takeProfit2 && (
                <div className="space-y-1">
                  <span className="text-xs text-gray-500">Take Profit 2</span>
                  <p className="font-mono text-emerald-400">{takeProfit2.toFixed(2)}</p>
                </div>
              )}
            </div>

            <div className="border-t border-[#30363D] pt-3 grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <span className="text-xs text-gray-500">Risk (Pips)</span>
                <p className="font-mono text-red-400">{calculations.riskPips.toFixed(1)}</p>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-gray-500">Risk:Reward</span>
                <p className="font-mono text-emerald-400">1:{calculations.rrrTP1.toFixed(1)}</p>
              </div>
            </div>
          </div>

          {/* Account Summary */}
          <div className="flex justify-between text-sm text-gray-400">
            <span>Account Balance</span>
            <span className="font-mono">${accountBalance.toLocaleString()}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="px-6 py-4 border-t border-[#30363D] flex gap-3">
          <button
            onClick={onCloseAction}
            className="flex-1 py-3 rounded-lg bg-gray-700/50 hover:bg-gray-700 text-gray-300 font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirmAction}
            disabled={!canConfirm || isLoading}
            className={`flex-1 py-3 rounded-lg font-semibold transition-all ${
              canConfirm && !isLoading
                ? isBuy
                  ? 'bg-emerald-500 hover:bg-emerald-600 text-white'
                  : 'bg-red-500 hover:bg-red-600 text-white'
                : 'bg-gray-700 text-gray-500 cursor-not-allowed'
            }`}
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="animate-spin">⏳</span>
                Executing...
              </span>
            ) : canConfirm ? (
              `Confirm ${signalType}`
            ) : (
              `Wait ${countdown}s...`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// QUICK TRADE WIDGET
// ==========================================

interface QuickTradeWidgetProps {
  signal: {
    type: 'BUY' | 'SELL';
    entry_zone: { high: number; low: number };
    sl: number;
    tp1: number;
    tp2?: number;
    validity_score: number;
  } | null;
  accountBalance: number;
  currentPrice: number;
  symbol: string;
  onExecute?: (type: 'BUY' | 'SELL') => void;
  isExecuting?: boolean;
}

export function QuickTradeWidget({
  signal,
  accountBalance,
  symbol,
  onExecute,
  isExecuting = false
}: QuickTradeWidgetProps): React.ReactElement {
  const [showModal, setShowModal] = useState(false);

  const handleTradeClick = useCallback(() => {
    if (signal) {
      setShowModal(true);
    }
  }, [signal]);

  const handleConfirm = useCallback(() => {
    if (signal && onExecute) {
      onExecute(signal.type);
    }
    setShowModal(false);
  }, [signal, onExecute]);

  if (!signal) {
    return (
      <div className="bg-[#161B22] rounded-lg p-4 border border-[#30363D]">
        <div className="flex flex-col items-center justify-center py-6 text-gray-500">
          <span className="text-3xl mb-2">⏳</span>
          <span className="text-sm">Waiting for signal...</span>
        </div>
      </div>
    );
  }

  const isBuy = signal.type === 'BUY';
  const entryPrice = (signal.entry_zone.high + signal.entry_zone.low) / 2;

  return (
    <>
      <div className={`rounded-lg p-4 border transition-all ${
        isBuy 
          ? 'bg-emerald-500/5 border-emerald-500/30' 
          : 'bg-red-500/5 border-red-500/30'
      }`}>
        {/* Signal Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="text-xl">{isBuy ? '🚀' : '🔻'}</span>
            <span className={`font-bold ${isBuy ? 'text-emerald-400' : 'text-red-400'}`}>
              {signal.type} SIGNAL
            </span>
          </div>
          <SignalHealthGauge 
            confidenceScore={signal.validity_score} 
            size="sm"
            showLabels={false}
          />
        </div>

        {/* Quick Info */}
        <div className="grid grid-cols-3 gap-2 mb-4 text-sm">
          <div className="text-center">
            <p className="text-gray-500 text-xs">Entry</p>
            <p className="font-mono text-blue-400">{entryPrice.toFixed(2)}</p>
          </div>
          <div className="text-center">
            <p className="text-gray-500 text-xs">SL</p>
            <p className="font-mono text-red-400">{signal.sl.toFixed(2)}</p>
          </div>
          <div className="text-center">
            <p className="text-gray-500 text-xs">TP</p>
            <p className="font-mono text-emerald-400">{signal.tp1.toFixed(2)}</p>
          </div>
        </div>

        {/* Execute Button */}
        <button
          onClick={handleTradeClick}
          disabled={isExecuting}
          className={`w-full py-3 rounded-lg font-semibold transition-all ${
            isExecuting
              ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
              : isBuy
                ? 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg shadow-emerald-500/20'
                : 'bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/20'
          }`}
        >
          {isExecuting ? 'Executing...' : `Execute ${signal.type}`}
        </button>
      </div>

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={showModal}
        onCloseAction={() => setShowModal(false)}
        onConfirmAction={handleConfirm}
        signalType={signal.type}
        entryPrice={entryPrice}
        stopLoss={signal.sl}
        takeProfit1={signal.tp1}
        takeProfit2={signal.tp2}
        accountBalance={accountBalance}
        confidenceScore={signal.validity_score}
        symbol={symbol}
        isLoading={isExecuting}
      />
    </>
  );
}

const TradingWidgets = {
  RealTimePnLMeter,
  SignalHealthGauge,
  ConfirmationModal,
  QuickTradeWidget
};

export default TradingWidgets;
