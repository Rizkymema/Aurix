'use client';

import React, { useState } from 'react';
import MobileHeader from './MobileHeader';
import MobileNav from './MobileNav';
import BottomSheet from './BottomSheet';
import MobileBotControl from './MobileBotControl';
import MobileMarketSentiment from './MobileMarketSentiment';
import MobileSignalCard from './MobileSignalCard';
import MobileSettings from './MobileSettings';

type ActivePanel = 'chart' | 'signals' | 'bot' | 'settings' | null;

interface MobileLayoutProps {
  children: React.ReactNode;
  symbol: string;
  price: number;
  priceDirection: 'up' | 'down' | 'neutral';
  timeframe: string;
  onTimeframeChangeAction: (tf: string) => void;
  onSymbolChangeAction: (symbol: string) => void;
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
  // Market Sentiment props
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

export default function MobileLayout({
  children,
  symbol,
  price,
  priceDirection,
  timeframe,
  onTimeframeChangeAction,
  onSymbolChangeAction,
  botStatus = 'stopped',
  botMode = 'dry-run',
  onBotStartAction = () => {},
  onBotStopAction = () => {},
  onBotModeChangeAction = () => {},
  aiEnabled = true,
  onAiToggleAction = () => {},
  signal = null,
  sentimentData = {
    sentiment: 'NEUTRAL',
    confidence: 50,
    fearGreed: 50,
    volume: 'STABLE',
    whales: 'NEUTRAL',
    shortTerm: 'SIDEWAYS',
    midTerm: 'SIDEWAYS',
    longTerm: 'SIDEWAYS'
  }
}: MobileLayoutProps) {
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [sheetHeight, setSheetHeight] = useState<'collapsed' | 'half' | 'full'>('collapsed');

  const handleNavClick = (panel: ActivePanel) => {
    if (panel === 'chart') {
      setActivePanel(null);
      setSheetHeight('collapsed');
    } else if (activePanel === panel) {
      // Toggle between half and collapsed
      setSheetHeight(sheetHeight === 'collapsed' ? 'half' : 'collapsed');
      if (sheetHeight !== 'collapsed') {
        setActivePanel(null);
      }
    } else {
      setActivePanel(panel);
      setSheetHeight('half');
    }
  };

  const getPanelContent = () => {
    switch (activePanel) {
      case 'bot':
        return (
          <MobileBotControl
            status={botStatus}
            mode={botMode}
            onStartAction={onBotStartAction}
            onStopAction={onBotStopAction}
            onModeChangeAction={onBotModeChangeAction}
            aiEnabled={aiEnabled}
            onAiToggleAction={onAiToggleAction}
          />
        );
      case 'signals':
        return (
          <div className="space-y-4">
            <MobileSignalCard signal={signal} symbol={symbol} />
            <MobileMarketSentiment data={sentimentData} />
          </div>
        );
      case 'settings':
        return <MobileSettings />;
      default:
        return null;
    }
  };

  const getPanelTitle = () => {
    switch (activePanel) {
      case 'bot':
        return '🤖 Bot Control';
      case 'signals':
        return '⚡ Signals & Analysis';
      case 'settings':
        return '⚙️ Settings';
      default:
        return '';
    }
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-[#0D1117] md:hidden">
      {/* Fixed Header - Always visible at top */}
      <div className="fixed top-0 left-0 right-0 z-50">
        <MobileHeader
          symbol={symbol}
          price={price}
          priceDirection={priceDirection}
          timeframe={timeframe}
          onTimeframeChangeAction={onTimeframeChangeAction}
          onSymbolChangeAction={onSymbolChangeAction}
        />
      </div>

      {/* Chart Area - With padding for header and nav */}
      <main className="flex-1 overflow-auto pt-[88px] pb-[56px]">
        {children}
      </main>

      {/* Bottom Sheet for Panels */}
      <BottomSheet
        isOpen={activePanel !== null && sheetHeight !== 'collapsed'}
        height={sheetHeight}
        onHeightChangeAction={setSheetHeight}
        onCloseAction={() => {
          setActivePanel(null);
          setSheetHeight('collapsed');
        }}
        title={getPanelTitle()}
      >
        {getPanelContent()}
      </BottomSheet>

      {/* Fixed Bottom Navigation - Always visible at bottom */}
      <div className="fixed bottom-0 left-0 right-0 z-50">
        <MobileNav
          activeTab={activePanel || 'chart'}
          onTabChangeAction={handleNavClick}
        />
      </div>
    </div>
  );
}
