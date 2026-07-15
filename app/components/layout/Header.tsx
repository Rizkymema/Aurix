'use client';

import React from 'react';

interface HeaderProps {
  symbol: string;
  onSymbolChangeAction?: (symbol: string) => void;
  activeTab: string;
  onTabChangeAction?: (tab: string) => void;
}

const SYMBOLS = [
  'XAUUSD', // Gold
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'SOLUSDT',
  'ADAUSDT', 'DOGEUSDT', 'DOTUSDT', 'MATICUSDT', 'LTCUSDT',
];

const TABS = [
  { id: 'chart', label: 'Chart', icon: '📈' },
  { id: 'analysis', label: 'Analysis', icon: '🔍' },
  { id: 'bot', label: 'Bot', icon: '🤖' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
];

export function Header({ symbol, onSymbolChangeAction, activeTab, onTabChangeAction }: HeaderProps) {
  return (
    <div className="h-14 flex items-center justify-between px-4">
      {/* Logo */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center font-bold text-white text-sm">
          FX
        </div>
        <span className="font-semibold text-lg hidden sm:block">AI Trading</span>
      </div>

      {/* Navigation Tabs */}
      <nav className="flex items-center gap-1">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => onTabChangeAction?.(tab.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.id
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
          >
            <span className="mr-2">{tab.icon}</span>
            <span className="hidden md:inline">{tab.label}</span>
          </button>
        ))}
      </nav>

      {/* Symbol Selector & Actions */}
      <div className="flex items-center gap-3">
        {/* Symbol Dropdown */}
        <select
          value={symbol}
          onChange={(e) => onSymbolChangeAction?.(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
        >
          {SYMBOLS.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        {/* Connection Status */}
        <div className="flex items-center gap-2 px-3 py-2 bg-gray-800/50 rounded-lg">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-xs text-gray-400 hidden lg:block">Live</span>
        </div>

        {/* User Avatar */}
        <div className="w-8 h-8 bg-gray-700 rounded-full flex items-center justify-center text-sm">
          👤
        </div>
      </div>
    </div>
  );
}
