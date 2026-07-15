'use client';

import React, { useState, useCallback } from 'react';
import { MobileLayout } from '../mobile';

interface TradingLayoutProps {
  children: React.ReactNode;
  header?: React.ReactNode;
  marketInfo?: React.ReactNode;
  sidebar?: React.ReactNode;
  bottomPanel?: React.ReactNode;
  // Mobile-specific props
  symbol?: string;
  price?: number;
  priceDirection?: 'up' | 'down' | 'neutral';
  timeframe?: string;
  onTimeframeChangeAction?: (tf: string) => void;
  onSymbolChangeAction?: (symbol: string) => void;
  // Bot props
  botStatus?: 'running' | 'stopped' | 'error';
  botMode?: 'dry-run' | 'live';
  onBotStartAction?: () => void;
  onBotStopAction?: () => void;
  onBotModeChangeAction?: (mode: 'dry-run' | 'live') => void;
  aiEnabled?: boolean;
  onAiToggleAction?: (enabled: boolean) => void;
  // Signal props
  signal?: {
    type: 'BUY' | 'SELL' | 'HOLD';
    entry: number;
    stopLoss: number;
    takeProfit1: number;
    takeProfit2?: number;
    confidence: number;
    reason: string;
    riskReward: number;
  } | null;
  // Sentiment props
  sentimentData?: {
    sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    confidence: number;
    fearGreed: number;
    volume: 'INCREASING' | 'DECREASING' | 'STABLE';
    whales: 'BUYING' | 'SELLING' | 'NEUTRAL';
    shortTerm: 'UP' | 'DOWN' | 'SIDEWAYS';
    midTerm: 'UP' | 'DOWN' | 'SIDEWAYS';
    longTerm: 'UP' | 'DOWN' | 'SIDEWAYS';
  };
}

export function TradingLayout({
  children,
  header,
  marketInfo,
  sidebar,
  bottomPanel,
  // Mobile props with defaults
  symbol = 'BTCUSDT',
  price = 0,
  priceDirection = 'neutral',
  timeframe = '1m',
  onTimeframeChangeAction = () => {},
  onSymbolChangeAction = () => {},
  botStatus = 'stopped',
  botMode = 'dry-run',
  onBotStartAction = () => {},
  onBotStopAction = () => {},
  onBotModeChangeAction = () => {},
  aiEnabled = true,
  onAiToggleAction = () => {},
  signal = null,
  sentimentData,
}: TradingLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [bottomCollapsed, setBottomCollapsed] = useState(false);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => !prev);
  }, []);

  const toggleBottom = useCallback(() => {
    setBottomCollapsed(prev => !prev);
  }, []);

  // Mobile Layout for screens < 768px
  const mobileView = (
    <MobileLayout
      symbol={symbol}
      price={price}
      priceDirection={priceDirection}
      timeframe={timeframe}
      onTimeframeChangeAction={onTimeframeChangeAction}
      onSymbolChangeAction={onSymbolChangeAction}
      botStatus={botStatus}
      botMode={botMode}
      onBotStartAction={onBotStartAction}
      onBotStopAction={onBotStopAction}
      onBotModeChangeAction={onBotModeChangeAction}
      aiEnabled={aiEnabled}
      onAiToggleAction={onAiToggleAction}
      signal={signal}
      sentimentData={sentimentData}
    >
      {children}
    </MobileLayout>
  );

  // Desktop Layout for screens >= 768px
  const desktopView = (
    <div className="h-screen flex flex-col bg-[#0a0a0f] text-gray-100 overflow-hidden hidden md:flex">
      {/* Fixed Header */}
      {header && (
        <header className="flex-shrink-0 border-b border-gray-800 bg-[#0d0d14]">
          {header}
        </header>
      )}

      {/* Market Info Bar */}
      {marketInfo && (
        <div className="flex-shrink-0 border-b border-gray-800 bg-[#0a0a0f]">
          {marketInfo}
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Chart + Main Content */}
        <main 
          className={`flex-1 flex flex-col overflow-hidden transition-all duration-300 ${
            sidebarCollapsed ? 'mr-0' : 'mr-0'
          }`}
        >
          {/* Chart Area */}
          <div className={`flex-1 overflow-hidden transition-all duration-300 ${
            bottomCollapsed ? '' : ''
          }`}>
            {children}
          </div>

          {/* Bottom Panel */}
          {bottomPanel && (
            <div 
              className={`flex-shrink-0 border-t border-gray-800 bg-[#0d0d14] transition-all duration-300 overflow-hidden ${
                bottomCollapsed ? 'h-10' : 'h-64'
              }`}
            >
              <div className="h-full flex flex-col">
                {/* Bottom Panel Header */}
                <div 
                  className="flex-shrink-0 h-10 flex items-center justify-between px-4 border-b border-gray-800 cursor-pointer hover:bg-gray-800/30"
                  onClick={toggleBottom}
                >
                  <span className="text-xs font-medium text-gray-400">Analysis Panels</span>
                  <button className="text-gray-500 hover:text-gray-300 transition-colors">
                    {bottomCollapsed ? '▲' : '▼'}
                  </button>
                </div>
                {/* Bottom Panel Content */}
                {!bottomCollapsed && (
                  <div className="flex-1 overflow-hidden">
                    {bottomPanel}
                  </div>
                )}
              </div>
            </div>
          )}
        </main>

        {/* Right Sidebar */}
        {sidebar && (
          <aside 
            className={`flex-shrink-0 border-l border-gray-800 bg-[#0d0d14] transition-all duration-300 overflow-hidden ${
              sidebarCollapsed ? 'w-10' : 'w-80'
            }`}
          >
            <div className="h-full flex flex-col">
              {/* Sidebar Toggle */}
              <div 
                className="flex-shrink-0 h-10 flex items-center justify-center border-b border-gray-800 cursor-pointer hover:bg-gray-800/30"
                onClick={toggleSidebar}
              >
                <button className="text-gray-500 hover:text-gray-300 transition-colors text-sm">
                  {sidebarCollapsed ? '«' : '»'}
                </button>
              </div>
              {/* Sidebar Content */}
              {!sidebarCollapsed && (
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                  {sidebar}
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile View - shows on small screens */}
      <div className="md:hidden">
        {mobileView}
      </div>
      {/* Desktop View - shows on medium+ screens */}
      {desktopView}
    </>
  );
}
