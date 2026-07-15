'use client';

import React, { useState, useEffect } from 'react';

interface MobileHeaderProps {
  symbol: string;
  price: number;
  priceDirection: 'up' | 'down' | 'neutral';
  timeframe: string;
  onTimeframeChangeAction: (tf: string) => void;
  onSymbolChangeAction: (symbol: string) => void;
}

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'];
const SYMBOLS = ['XAUUSD', 'BTCUSDT', 'ETHUSDT', 'EURUSD'];

export default function MobileHeader({
  symbol,
  price,
  priceDirection,
  timeframe,
  onTimeframeChangeAction,
  onSymbolChangeAction
}: MobileHeaderProps) {
  const [showSymbolPicker, setShowSymbolPicker] = useState(false);
  const [flash, setFlash] = useState(false);
  const [prevPrice, setPrevPrice] = useState(price);

  useEffect(() => {
    if (price !== prevPrice) {
      setFlash(true);
      setPrevPrice(price);
      const timer = setTimeout(() => setFlash(false), 300);
      return () => clearTimeout(timer);
    }
  }, [price, prevPrice]);

  const priceColor = priceDirection === 'up' 
    ? 'text-green-400' 
    : priceDirection === 'down' 
      ? 'text-red-400' 
      : 'text-white';

  return (
    <header className="bg-[#161B22] border-b border-[#21262D] px-3 py-2 safe-area-top">
      {/* Top Row: Symbol + Price */}
      <div className="flex items-center justify-between mb-2">
        {/* Symbol Selector */}
        <button
          onClick={() => setShowSymbolPicker(!showSymbolPicker)}
          className="flex items-center gap-1 bg-[#21262D] px-3 py-1.5 rounded-lg 
                     active:bg-[#30363D] transition-colors min-h-[44px]"
        >
          <span className="text-yellow-500 font-bold">{symbol}</span>
          <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Current Price */}
        <div className={`flex items-center gap-2 transition-transform ${flash ? 'scale-105' : ''}`}>
          <span className={`text-xl font-bold ${priceColor}`}>
            {price.toFixed(2)}
          </span>
          <span className={`text-sm ${priceColor}`}>
            {priceDirection === 'up' ? '▲' : priceDirection === 'down' ? '▼' : '●'}
          </span>
        </div>
      </div>

      {/* Bottom Row: Timeframe Pills (Horizontal Scroll) */}
      <div className="flex gap-1 overflow-x-auto scrollbar-hide -mx-3 px-3">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf}
            onClick={() => onTimeframeChangeAction(tf)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-md text-sm font-medium 
                       min-h-[36px] min-w-[44px] transition-colors
                       ${timeframe === tf
                         ? 'bg-blue-600 text-white'
                         : 'bg-[#21262D] text-gray-400 active:bg-[#30363D]'
                       }`}
          >
            {tf}
          </button>
        ))}
      </div>

      {/* Symbol Picker Dropdown */}
      {showSymbolPicker && (
        <>
          <div 
            className="fixed inset-0 z-40" 
            onClick={() => setShowSymbolPicker(false)} 
          />
          <div className="absolute left-3 top-14 bg-[#21262D] rounded-lg shadow-xl z-50 
                         border border-[#30363D] overflow-hidden">
            {SYMBOLS.map((s) => (
              <button
                key={s}
                onClick={() => {
                  onSymbolChangeAction(s);
                  setShowSymbolPicker(false);
                }}
                className={`w-full px-4 py-3 text-left min-h-[48px] transition-colors
                           ${symbol === s 
                             ? 'bg-blue-600 text-white' 
                             : 'text-gray-300 active:bg-[#30363D]'
                           }`}
              >
                {s}
              </button>
            ))}
          </div>
        </>
      )}
    </header>
  );
}
