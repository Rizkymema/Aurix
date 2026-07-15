'use client';

/**
 * Trading Dashboard v2.0
 * =======================
 * Enhanced trading dashboard dengan fitur:
 * 1. Risk/Reward Visualizer - Green/Red boxes otomatis
 * 2. Real-time P&L Meter - Persentase saldo
 * 3. Signal Health Gauge - Confidence meter
 * 4. Confirmation Modal - Validasi sebelum entry
 * 
 * Built for Next.js 15 + React 19 + lightweight-charts v5
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { FullFeaturedChart } from './components/chart/FullFeaturedChart';
import { SmartSignalCard, UnifiedSignalCard, useSmartSignal } from './components/signal';
import { PositionSizeCalculator } from './components/calculator';
import { BotStatusPanel } from './components/botStatus';
import { TradingLayout, Header, MarketInfoBar, Sidebar, SidebarSection, BottomPanel } from './components/layout';
import { CandlestickData, Timeframe } from './components/chart/types';
import { 
  RealTimePnLMeter, 
  SignalHealthGauge, 
  ConfirmationModal,
  QuickTradeWidget 
} from './components/trading';
import { RRBoxConfig, createRRBoxFromSignal } from './components/chart/RiskRewardBox';

const APP_API_KEY = process.env.NEXT_PUBLIC_APP_API_KEY;

// ==========================================
// TYPES
// ==========================================

interface Position {
  id: string;
  type: 'LONG' | 'SHORT';
  entryPrice: number;
  currentPrice: number;
  size: number;
  leverage?: number;
  openTime: number;
  symbol: string;
}

interface TradingSignal {
  type: 'BUY' | 'SELL' | 'HOLD';
  entry_zone: { high: number; low: number };
  sl: number;
  tp1: number;
  tp2?: number;
  validity_score: number;
  reason?: string;
  risk_reward_ratio?: number;
}

// ==========================================
// MAIN COMPONENT
// ==========================================

export default function TradingDashboard() {
  // ==========================================
  // STATE MANAGEMENT
  // ==========================================
  
  // Market Data
  const [candles, setCandles] = useState<CandlestickData[]>([]);
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [timeframe, setTimeframe] = useState<Timeframe>('1m');
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [previousPrice, setPreviousPrice] = useState<number | null>(null);
  const [priceChange, setPriceChange] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState('chart');
  const [high24h, setHigh24h] = useState<number | undefined>();
  const [low24h, setLow24h] = useState<number | undefined>();
  const [volume24h, setVolume24h] = useState<number | undefined>();

  // Bot & Trading State
  const [botRunning, setBotRunning] = useState(false);
  const [botMode, setBotMode] = useState<'live' | 'dry-run'>('dry-run');
  const [aiEnabled, setAiEnabled] = useState(true);
  const [isExecuting, setIsExecuting] = useState(false);

  // Account State
  const [accountBalance, setAccountBalance] = useState(10000); // Default $10,000
  const [positions, setPositions] = useState<Position[]>([]);

  // Modal State
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingOrder, setPendingOrder] = useState<TradingSignal | null>(null);

  // RR Box State for chart visualization (used for future canvas drawing)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [rrBoxes, setRrBoxes] = useState<RRBoxConfig[]>([]);
  const lastSignalRef = useRef<string | null>(null);

  // ==========================================
  // COMPUTED VALUES
  // ==========================================

  const priceDirection = useMemo((): 'up' | 'down' | 'neutral' => {
    if (!currentPrice || !previousPrice) return 'neutral';
    if (currentPrice > previousPrice) return 'up';
    if (currentPrice < previousPrice) return 'down';
    return 'neutral';
  }, [currentPrice, previousPrice]);

  // ==========================================
  // SIGNAL HOOK
  // ==========================================

  const [signalMode, setSignalMode] = useState<'simple' | 'unified'>('unified');

  const { 
    signal, 
    aiResponse, 
    isLoading: signalLoading, 
    source: signalSource, 
    refresh: refreshSignal,
    autoRefreshEnabled,
    setAutoRefreshEnabled,
    unifiedSignal,
    layerBreakdown,
    sentimentEnabled,
    setSentimentEnabled,
    geminiEnabled,
    setGeminiEnabled,
    generateUnified,
  } = useSmartSignal({
    symbol,
    candles,
    timeframe,
    enabled: candles.length > 20,
  });

  // ==========================================
  // AUTO RR BOX ON SIGNAL
  // ==========================================

  useEffect(() => {
    if (signal && candles.length > 0) {
      // Create unique key for signal
      const signalKey = `${signal.type}_${signal.entry_zone.high}_${signal.sl}_${signal.tp1}`;
      
      // Only add new box if signal changed
      if (signalKey !== lastSignalRef.current) {
        lastSignalRef.current = signalKey;
        
        const lastCandle = candles[candles.length - 1];
        const newBox = createRRBoxFromSignal(
          {
            type: signal.type,
            entry_zone: signal.entry_zone,
            sl: signal.sl,
            tp1: signal.tp1,
            tp2: signal.tp2,
          },
          lastCandle.time
        );
        
        // Keep only last 3 boxes
        setRrBoxes(prev => [...prev.slice(-2), newBox]);
      }
    }
  }, [signal, candles]);

  // Update current price in positions for P&L calculation
  useEffect(() => {
    if (currentPrice && positions.length > 0) {
      setPositions(prev => prev.map(pos => ({
        ...pos,
        currentPrice
      })));
    }
  }, [currentPrice, positions.length]);

  // ==========================================
  // DATA CALLBACKS
  // ==========================================

  const handleHistoricalData = useCallback((data: CandlestickData[]) => {
    setCandles(data);
    if (data.length > 0) {
      const firstPrice = data[0].close;
      const lastPrice = data[data.length - 1].close;
      setCurrentPrice(lastPrice);
      setPriceChange(((lastPrice - firstPrice) / firstPrice) * 100);
      
      const highs = data.map(d => d.high);
      const lows = data.map(d => d.low);
      const volumes = data.map(d => d.volume || 0);
      
      setHigh24h(Math.max(...highs));
      setLow24h(Math.min(...lows));
      setVolume24h(volumes.reduce((a, b) => a + b, 0));
    }
  }, []);

  const handleRealtimeUpdate = useCallback((candle: CandlestickData) => {
    setPreviousPrice(currentPrice);
    setCurrentPrice(candle.close);
    setCandles(prev => {
      if (prev.length === 0) return prev;
      
      const lastCandle = prev[prev.length - 1];
      if (candle.time === lastCandle.time) {
        return [...prev.slice(0, -1), candle];
      } else if (candle.time > lastCandle.time) {
        return [...prev, candle];
      }
      return prev;
    });
  }, [currentPrice]);

  // ==========================================
  // BOT CONTROLS
  // ==========================================

  const handleStartBot = useCallback(async () => {
    try {
      const response = await fetch('/api/bot/start', {
        method: 'POST',
        headers: {
          ...(APP_API_KEY ? { 'x-app-api-key': APP_API_KEY } : {}),
        },
      });
      if (response.ok) {
        setBotRunning(true);
      }
    } catch (err) {
      console.error('Failed to start bot:', err);
    }
  }, []);

  const handleStopBot = useCallback(async () => {
    try {
      const response = await fetch('/api/bot/stop', {
        method: 'POST',
        headers: {
          ...(APP_API_KEY ? { 'x-app-api-key': APP_API_KEY } : {}),
        },
      });
      if (response.ok) {
        setBotRunning(false);
      }
    } catch (err) {
      console.error('Failed to stop bot:', err);
    }
  }, []);

  const handleToggleMode = useCallback(() => {
    setBotMode(prev => prev === 'live' ? 'dry-run' : 'live');
  }, []);

  // ==========================================
  // TRADE EXECUTION
  // ==========================================

  const handleTradeClick = useCallback((type: 'BUY' | 'SELL') => {
    if (!signal) return;
    
    setPendingOrder({
      ...signal,
      type
    });
    setShowConfirmModal(true);
  }, [signal]);

  const handleConfirmTrade = useCallback(async () => {
    if (!pendingOrder) return;
    
    setIsExecuting(true);
    
    try {
      // Execute trade via API
      const response = await fetch('/api/bot/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(APP_API_KEY ? { 'x-app-api-key': APP_API_KEY } : {}),
        },
        body: JSON.stringify({
          symbol,
          type: pendingOrder.type,
          entryPrice: (pendingOrder.entry_zone.high + pendingOrder.entry_zone.low) / 2,
          stopLoss: pendingOrder.sl,
          takeProfit1: pendingOrder.tp1,
          takeProfit2: pendingOrder.tp2,
          riskPercent: 1,
        }),
      });

      if (response.ok) {
        const result = await response.json();
        
        // Add to positions
        const newPosition: Position = {
          id: result.orderId || Date.now().toString(),
          type: pendingOrder.type === 'BUY' ? 'LONG' : 'SHORT',
          entryPrice: (pendingOrder.entry_zone.high + pendingOrder.entry_zone.low) / 2,
          currentPrice: currentPrice || 0,
          size: result.size || 0.01,
          openTime: Date.now(),
          symbol,
        };
        
        setPositions(prev => [...prev, newPosition]);
      }
    } catch (err) {
      console.error('Trade execution failed:', err);
    } finally {
      setIsExecuting(false);
      setShowConfirmModal(false);
      setPendingOrder(null);
    }
  }, [pendingOrder, symbol, currentPrice]);

  // ==========================================
  // MOBILE FORMAT
  // ==========================================

  const mobileSignal = useMemo(() => {
    if (!signal) return null;
    return {
      type: signal.type as 'BUY' | 'SELL' | 'HOLD',
      entry: (signal.entry_zone.high + signal.entry_zone.low) / 2,
      stopLoss: signal.sl,
      takeProfit1: signal.tp1,
      takeProfit2: signal.tp2,
      confidence: signal.validity_score,
      reason: signal.reason || 'Signal generated based on technical analysis',
      riskReward: signal.risk_reward_ratio || 2,
    };
  }, [signal]);

  const sentimentData = useMemo(() => ({
    sentiment: (signal?.type === 'BUY' ? 'BULLISH' : signal?.type === 'SELL' ? 'BEARISH' : 'NEUTRAL') as 'BULLISH' | 'BEARISH' | 'NEUTRAL',
    confidence: signal?.validity_score || 50,
    fearGreed: 50,
    volume: 'INCREASING' as const,
    whales: 'BUYING' as const,
    shortTerm: 'UP' as const,
    midTerm: 'DOWN' as const,
    longTerm: 'UP' as const,
  }), [signal]);

  // ==========================================
  // DEMO DATA
  // ==========================================

  const executionLogs = useMemo(() => [
    { id: '1', time: Date.now() - 300000, type: 'INFO' as const, message: 'Bot initialized' },
    { id: '2', time: Date.now() - 240000, type: 'SIGNAL' as const, message: 'BUY signal detected @ 4292.50' },
    { id: '3', time: Date.now() - 180000, type: 'ENTRY' as const, message: 'Opened BUY 0.1 lot @ 4292.50, SL: 4280.00, TP: 4310.00' },
    { id: '4', time: Date.now() - 60000, type: 'INFO' as const, message: 'Monitoring position...' },
  ], []);

  // ==========================================
  // BOTTOM PANEL TABS
  // ==========================================

  const bottomTabs = useMemo(() => [
    {
      id: 'bot',
      label: 'Bot Status',
      icon: '🤖',
      content: (
        <BotStatusPanel
          botStatus={{
            running: botRunning,
            mode: botMode,
            lastUpdate: Date.now(),
            totalTrades: 24,
            winRate: 67.5,
            todayPnl: 156.80,
            totalPnl: 2450.00,
            maxDrawdown: 3.2,
            riskPerTrade: 1,
          }}
          positions={[]}
          logs={executionLogs}
          onStartBot={handleStartBot}
          onStopBot={handleStopBot}
          onToggleMode={handleToggleMode}
        />
      ),
    },
    {
      id: 'pnl',
      label: 'P&L Monitor',
      icon: '💰',
      content: (
        <div className="p-4">
          <RealTimePnLMeter
            positions={positions}
            accountBalance={accountBalance}
            currentPrice={currentPrice || 0}
          />
        </div>
      ),
    },
  ], [botRunning, botMode, executionLogs, handleStartBot, handleStopBot, handleToggleMode, positions, accountBalance, currentPrice]);

  // ==========================================
  // RENDER
  // ==========================================

  return (
    <>
      <TradingLayout
        // Mobile props
        symbol={symbol}
        price={currentPrice || 0}
        priceDirection={priceDirection}
        timeframe={timeframe}
        onTimeframeChangeAction={(tf) => setTimeframe(tf as Timeframe)}
        onSymbolChangeAction={setSymbol}
        botStatus={botRunning ? 'running' : 'stopped'}
        botMode={botMode}
        onBotStartAction={handleStartBot}
        onBotStopAction={handleStopBot}
        onBotModeChangeAction={(mode) => setBotMode(mode)}
        aiEnabled={aiEnabled}
        onAiToggleAction={setAiEnabled}
        signal={mobileSignal}
        sentimentData={sentimentData}
        // Desktop props
        header={
          <Header
            symbol={symbol}
            onSymbolChangeAction={setSymbol}
            activeTab={activeTab}
            onTabChangeAction={setActiveTab}
          />
        }
        marketInfo={
          <MarketInfoBar
            symbol={symbol}
            price={currentPrice}
            priceChange={priceChange}
            high24h={high24h}
            low24h={low24h}
            volume24h={volume24h}
          />
        }
        sidebar={
          <Sidebar>
            {/* Signal Health Gauge */}
            <SidebarSection title="Signal Health" icon="🎯" defaultOpen={true}>
              <div className="flex flex-col items-center py-2">
                <SignalHealthGauge
                  confidenceScore={signal?.validity_score || 0}
                  signalType={signal?.type as 'BUY' | 'SELL' | 'HOLD' | undefined}
                  size="md"
                />
              </div>
            </SidebarSection>

            {/* Quick Trade Widget */}
            <SidebarSection title="Quick Trade" icon="⚡" defaultOpen={true}>
              <QuickTradeWidget
                signal={signal}
                accountBalance={accountBalance}
                currentPrice={currentPrice || 0}
                symbol={symbol}
                onExecute={handleTradeClick}
                isExecuting={isExecuting}
              />
            </SidebarSection>

            {/* Real-time P&L */}
            {positions.length > 0 && (
              <SidebarSection title="Running P&L" icon="💰" defaultOpen={true}>
                <RealTimePnLMeter
                  positions={positions}
                  accountBalance={accountBalance}
                  currentPrice={currentPrice || 0}
                />
              </SidebarSection>
            )}

            {/* Signal Mode Toggle */}
            <SidebarSection title="Signal Intelligence" icon="🧠" defaultOpen={false}>
              <div className="flex gap-1 p-1 bg-gray-800/50 rounded-lg mb-3">
                <button
                  onClick={() => setSignalMode('simple')}
                  className={`flex-1 py-1.5 px-2 rounded text-xs font-medium transition-all ${
                    signalMode === 'simple'
                      ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                      : 'text-gray-500 hover:text-gray-400'
                  }`}
                >
                  ⚡ Simple
                </button>
                <button
                  onClick={() => setSignalMode('unified')}
                  className={`flex-1 py-1.5 px-2 rounded text-xs font-medium transition-all ${
                    signalMode === 'unified'
                      ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                      : 'text-gray-500 hover:text-gray-400'
                  }`}
                >
                  🧠 3-Layer AI
                </button>
              </div>

              {signalMode === 'simple' && (
                <SmartSignalCard
                  signal={signal}
                  aiResponse={aiResponse}
                  source={signalSource}
                  isLoading={signalLoading}
                  onRefresh={refreshSignal}
                  aiEnabled={aiEnabled}
                  onAiToggleAction={setAiEnabled}
                  autoRefreshEnabled={autoRefreshEnabled}
                  onAutoRefreshToggleAction={setAutoRefreshEnabled}
                />
              )}

              {signalMode === 'unified' && (
                <UnifiedSignalCard
                  signal={unifiedSignal}
                  layerBreakdown={layerBreakdown}
                  isLoading={signalLoading}
                  onRefresh={generateUnified}
                  sentimentEnabled={sentimentEnabled}
                  geminiEnabled={geminiEnabled}
                  onSentimentToggle={setSentimentEnabled}
                  onGeminiToggle={setGeminiEnabled}
                />
              )}
            </SidebarSection>
            
            {/* Position Calculator */}
            <SidebarSection title="Position Size" icon="📊" defaultOpen={false}>
              <PositionSizeCalculator
                symbol={symbol}
                entryPrice={currentPrice || 0}
              />
            </SidebarSection>

            {/* Account Settings */}
            <SidebarSection title="Account" icon="💼" defaultOpen={false}>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Account Balance ($)</label>
                  <input
                    type="number"
                    value={accountBalance}
                    onChange={(e) => setAccountBalance(Number(e.target.value))}
                    className="w-full bg-gray-800/50 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono text-sm"
                  />
                </div>
                <div className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg">
                  <span className="text-sm text-gray-400">Risk per Trade</span>
                  <span className="text-emerald-400 font-semibold">1%</span>
                </div>
              </div>
            </SidebarSection>

            {/* Bot Quick Controls */}
            <SidebarSection title="Bot Control" icon="🤖" defaultOpen={false}>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <div className={`w-2.5 h-2.5 rounded-full ${botRunning ? 'bg-emerald-500 animate-pulse' : 'bg-gray-600'}`} />
                    <span className="text-sm text-gray-300">
                      {botRunning ? 'Running' : 'Stopped'}
                    </span>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded ${
                    botMode === 'live' 
                      ? 'bg-red-500/20 text-red-400' 
                      : 'bg-yellow-500/20 text-yellow-400'
                  }`}>
                    {botMode.toUpperCase()}
                  </span>
                </div>

                <button
                  onClick={botRunning ? handleStopBot : handleStartBot}
                  className={`w-full py-3 rounded-lg font-semibold transition-all ${
                    botRunning
                      ? 'bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30'
                      : 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/30'
                  }`}
                >
                  {botRunning ? '⏹ Stop Bot' : '▶ Start Bot'}
                </button>
              </div>
            </SidebarSection>
          </Sidebar>
        }
        bottomPanel={
          <BottomPanel tabs={bottomTabs} defaultTab="bot" />
        }
      >
        {/* Main Chart with RR Boxes */}
        <div className="h-full p-2">
          <FullFeaturedChart
            symbol={symbol}
            initialTimeframe={timeframe}
            height={450}
            showMarketStructure={false}
            showSupplyDemand={false}
            showCandlePatterns={false}
            showTradingLevels={true}
            signal={signal ? {
              type: signal.type as 'BUY' | 'SELL',
              entry_zone: signal.entry_zone,
              sl: signal.sl,
              tp1: signal.tp1,
              tp2: signal.tp2,
            } : null}
            onHistoricalDataAction={handleHistoricalData}
            onRealtimeUpdateAction={handleRealtimeUpdate}
            onTimeframeChangeAction={setTimeframe}
          />
        </div>
      </TradingLayout>

      {/* Confirmation Modal */}
      {pendingOrder && (
        <ConfirmationModal
          isOpen={showConfirmModal}
          onCloseAction={() => {
            setShowConfirmModal(false);
            setPendingOrder(null);
          }}
          onConfirmAction={handleConfirmTrade}
          signalType={pendingOrder.type as 'BUY' | 'SELL'}
          entryPrice={(pendingOrder.entry_zone.high + pendingOrder.entry_zone.low) / 2}
          stopLoss={pendingOrder.sl}
          takeProfit1={pendingOrder.tp1}
          takeProfit2={pendingOrder.tp2}
          accountBalance={accountBalance}
          confidenceScore={pendingOrder.validity_score}
          symbol={symbol}
          isLoading={isExecuting}
        />
      )}
    </>
  );
}
