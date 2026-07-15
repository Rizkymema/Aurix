'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { CandlestickData, CHART_COLORS, Timeframe } from './components/chart/types';
import { useWebSocket } from './components/chart/hooks/useWebSocket';
import { useTradingSignal } from './components/signal/useTradingSignal';
import { MarketSentimentPanel } from './components/analysis/MarketSentimentPanel';
import { useZoomPan } from './components/chart/hooks/useZoomPan';
import { MobileLayout } from './components/mobile';
import ProbabilityDashboard from './components/probabilityEngine/ProbabilityDashboard';
import { useProbabilityEngine } from './hooks/useProbabilityEngine';

const APP_API_KEY = process.env.NEXT_PUBLIC_APP_API_KEY;

// Validate price matches expected symbol range
const isPriceValidForSymbol = (price: number, sym: string): boolean => {
  const upperSymbol = sym.toUpperCase();
  
  // XAUUSD (Gold) - price should be $2000-$8000 range
  if (upperSymbol === 'XAUUSD') {
    return price >= 2000 && price <= 8000;
  }
  
  // BTCUSDT - price should be > $10000
  if (upperSymbol === 'BTCUSDT') {
    return price >= 10000;
  }
  
  // ETHUSDT - price should be > $500
  if (upperSymbol === 'ETHUSDT') {
    return price >= 500;
  }
  
  // For other symbols, accept any positive price
  return price > 0;
};

/**
 * AI MARKET VISUALIZATION & TRADING DECISION ENGINE
 * Real-time charting platform with TradingView-style interactions
 * 
 * FEATURES:
 * - Real-time price sync with Binance (no smoothing/prediction)
 * - Interactive zoom & pan with kinetic scrolling
 * - AI signal based on visible chart range
 * - Automatic trading level overlay
 */
type ChartApi = ReturnType<typeof import('lightweight-charts').createChart>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SeriesApi = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PriceLineApi = any;

function getFeedBadge(status: 'realtime' | 'delayed' | 'stale' | 'unavailable') {
  switch (status) {
    case 'realtime':
      return {
        label: 'Realtime',
        dot: 'bg-emerald-500',
        text: 'text-emerald-400',
      };
    case 'delayed':
      return {
        label: 'Delayed',
        dot: 'bg-amber-500',
        text: 'text-amber-400',
      };
    case 'stale':
      return {
        label: 'Stale',
        dot: 'bg-orange-500',
        text: 'text-orange-400',
      };
    default:
      return {
        label: 'Unavailable',
        dot: 'bg-red-500',
        text: 'text-red-400',
      };
  }
}

export default function TradingDashboard() {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ChartApi | null>(null);
  const candlestickSeriesRef = useRef<SeriesApi>(null);
  const volumeSeriesRef = useRef<SeriesApi>(null);
  const tradingLinesRef = useRef<PriceLineApi[]>([]);
  
  // Track current symbol to prevent stale data
  const symbolRef = useRef<string>('BTCUSDT');
  
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [timeframe, setTimeframe] = useState<Timeframe>('1m'); // Default 1m for realtime feel
  const [isChartReady, setIsChartReady] = useState(false);
  const [candles, setCandles] = useState<CandlestickData[]>([]);
  const [mounted, setMounted] = useState(false);
  
  // Update symbolRef when symbol changes
  useEffect(() => {
    console.log(`[Dashboard] 🔄 Symbol changed to: ${symbol}`);
    symbolRef.current = symbol;
    // Clear candles when symbol changes
    setCandles([]);
    setCurrentPrice(null);
    setPreviousClose(null);
    setPriceChange(0);
    setPriceChangePercent(0);
  }, [symbol]);
  
  // REALTIME PRICE STATE (tidak boleh di-smooth atau di-delay)
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [previousClose, setPreviousClose] = useState<number | null>(null);
  const [priceChange, setPriceChange] = useState<number>(0);
  const [priceChangePercent, setPriceChangePercent] = useState<number>(0);
  const [lastTickTime, setLastTickTime] = useState<number | null>(null);
  const [tickCount, setTickCount] = useState<number>(0);
  
  // Bot State
  const [botRunning, setBotRunning] = useState(false);
  const [botMode, setBotMode] = useState<'live' | 'dry-run'>('dry-run');
  const [aiEnabled, setAiEnabled] = useState(true);
  
  // Visible range for AI analysis
  const [visibleCandles, setVisibleCandles] = useState<CandlestickData[]>([]);

  // Probability Engine
  const probEngine = useProbabilityEngine({
    symbol,
    timeframe,
    candles: candles.map(c => ({
      time: typeof c.time === 'number' ? c.time : Math.floor(new Date(c.time as unknown as string).getTime() / 1000),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    })),
    accountBalance: 10000,
    riskPercent: 1,
    autoRefreshMs: 30000,
  });
  
  // Activity logs
  const [logs, setLogs] = useState<Array<{time: string; type: string; message: string}>>([]);
  const lastFeedWarningRef = useRef<string | null>(null);
  
  // Mobile detection
  const [isMobile, setIsMobile] = useState(false);
  
  // Check for mobile screen on mount and resize
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Price direction for mobile
  const priceDirection = useMemo((): 'up' | 'down' | 'neutral' => {
    if (priceChange > 0) return 'up';
    if (priceChange < 0) return 'down';
    return 'neutral';
  }, [priceChange]);

  /**
   * HANDLE HISTORICAL DATA
   * Load initial candles and set baseline for price change calculation
   */
  const handleHistoricalData = useCallback((data: CandlestickData[]) => {
    if (data.length > 0) {
      const currentSymbol = symbolRef.current;
      const lastCandle = data[data.length - 1];
      
      // Validate price matches current symbol
      if (!isPriceValidForSymbol(lastCandle.close, currentSymbol)) {
        console.warn(`[Dashboard] ⚠️ Price ${lastCandle.close.toFixed(2)} doesn't match ${currentSymbol}, discarding ${data.length} candles`);
        return;
      }
      
      console.log(`[Dashboard] ✓ Received ${data.length} candles for ${currentSymbol}, price: $${lastCandle.close.toFixed(2)}`);
      setCandles(data);
      
      // Set current price dari candle terakhir
      setCurrentPrice(lastCandle.close);
      
      // Previous close untuk price change (24h ago atau candle pertama)
      const prevClose = data.length > 24 ? data[data.length - 25].close : data[0].close;
      setPreviousClose(prevClose);
      
      // Calculate price change
      const change = lastCandle.close - prevClose;
      const changePercent = (change / prevClose) * 100;
      setPriceChange(change);
      setPriceChangePercent(changePercent);
      setLastTickTime(Date.now());
    }
  }, []);

  /**
   * HANDLE REALTIME UPDATE (CRITICAL)
   * - Harga HARUS naik/turun sesuai data market aktual
   * - TIDAK boleh smoothing atau prediksi
   * - TIDAK boleh mengunci harga pada satu nilai
   */
  const handleRealtimeUpdate = useCallback((candle: CandlestickData) => {
    // Validate price matches current symbol
    const currentSymbol = symbolRef.current;
    if (!isPriceValidForSymbol(candle.close, currentSymbol)) {
      // Silently discard mismatched data
      return;
    }
    
    // Update current price IMMEDIATELY (no delay/smoothing)
    setCurrentPrice(candle.close);
    setLastTickTime(Date.now());
    setTickCount(prev => prev + 1);
    
    // Calculate realtime price change from previous close
    if (previousClose !== null) {
      const change = candle.close - previousClose;
      const changePercent = (change / previousClose) * 100;
      setPriceChange(change);
      setPriceChangePercent(changePercent);
    }
    
    // Update or append candle to data
    setCandles(prev => {
      if (prev.length === 0) return [candle];
      const lastCandle = prev[prev.length - 1];
      
      if (lastCandle.time === candle.time) {
        // Update existing candle (incomplete candle getting ticks)
        return [...prev.slice(0, -1), candle];
      } else if (candle.time > lastCandle.time) {
        // New candle closed - update previousClose for next period
        setPreviousClose(lastCandle.close);
        return [...prev, candle];
      }
      return prev;
    });
  }, [previousClose]);

  // WebSocket for real-time data
  const { isConnected, error, feedStatus, dataSource, marketStatus } = useWebSocket({
    symbol,
    timeframe,
    onMessageAction: handleRealtimeUpdate,
    onHistoricalDataAction: handleHistoricalData,
  });

  const feedBadge = useMemo(() => getFeedBadge(feedStatus), [feedStatus]);

  // Zoom & Pan hook - TradingView-style interactions
  const { resetZoom, fitAll, visibleCandles: zoomVisibleCount, isZoomedOut } = useZoomPan({
    chartRef: chartRef as React.MutableRefObject<ChartApi>,
    containerRef,
    enabled: isChartReady,
    minZoom: 10,
    maxZoom: 200,
    zoomSensitivity: 0.15,
    enableAutoHideOnZoom: true,
  });

  // Update visible candles when zoom changes
  useEffect(() => {
    if (!chartRef.current || candles.length === 0) return;
    
    try {
      const timeScale = chartRef.current.timeScale();
      const logicalRange = timeScale.getVisibleLogicalRange();
      
      if (logicalRange) {
        const fromIdx = Math.max(0, Math.floor(logicalRange.from as number));
        const toIdx = Math.min(candles.length - 1, Math.ceil(logicalRange.to as number));
        const visible = candles.slice(fromIdx, toIdx + 1);
        setVisibleCandles(visible);
      }
    } catch {
      // Fallback: use all candles
      setVisibleCandles(candles);
    }
  }, [candles, zoomVisibleCount]);

  /**
   * TRADING SIGNAL from AI Decision Engine
   * - Uses VISIBLE candles only (respects zoom level)
   * - AI tidak mengontrol UI, hanya menyesuaikan output dengan kondisi chart
   * - Auto-refresh lebih cepat saat bot running (10 detik)
   */
  const { signal, fetchSignal } = useTradingSignal({
    symbol,
    timeframe,
    candles: visibleCandles.length > 50 ? visibleCandles : candles, // Use visible or full if not enough
    botMode,
    aiEnabled,
    autoRefresh: botRunning,
    refreshInterval: botRunning ? 10000 : 30000, // Faster when bot running
  });

  // Mobile signal format
  const mobileSignal = useMemo(() => {
    if (!signal || signal.signal === 'WAIT') return null;
    return {
      type: signal.signal as 'BUY' | 'SELL' | 'HOLD',
      entry: signal.entry || 0,
      stopLoss: signal.stop_loss || 0,
      takeProfit1: signal.take_profit_1 || 0,
      takeProfit2: signal.take_profit_2 || undefined,
      confidence: signal.confidence || 0,
      reason: signal.reason || 'Signal generated based on technical analysis',
      riskReward: signal.risk_reward || 2,
    };
  }, [signal]);

  // Mobile sentiment data
  const sentimentData = useMemo(() => ({
    sentiment: (signal?.signal === 'BUY' ? 'BULLISH' : signal?.signal === 'SELL' ? 'BEARISH' : 'NEUTRAL') as 'BULLISH' | 'BEARISH' | 'NEUTRAL',
    confidence: signal?.confidence || 50,
    fearGreed: 50,
    volume: 'INCREASING' as const,
    whales: 'BUYING' as const,
    shortTerm: 'UP' as const,
    midTerm: 'DOWN' as const,
    longTerm: 'UP' as const,
  }), [signal]);

  // Format price utility - defined early for use in effects
  const formatPrice = useCallback((price: number | null) => {
    if (price === null) return '---';
    return price >= 1000 ? price.toFixed(2) : price.toFixed(5);
  }, []);

  // Add log entry
  const addLog = useCallback((type: string, message: string) => {
    setLogs(prev => [
      { time: new Date().toLocaleTimeString(), type, message },
      ...prev.slice(0, 49) // Keep last 50 logs
    ]);
  }, []);

  // Log realtime price updates (setiap 10 tick)
  useEffect(() => {
    if (tickCount > 0 && tickCount % 10 === 0 && currentPrice) {
      addLog('TICK', `Price: ${formatPrice(currentPrice)} (${tickCount} ticks)`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickCount, currentPrice, addLog]);

  useEffect(() => {
    if (!botRunning) {
      lastFeedWarningRef.current = null;
      return;
    }

    if (feedStatus === 'realtime') {
      lastFeedWarningRef.current = null;
      return;
    }

    const warningKey = `${feedStatus}:${dataSource || 'unknown'}`;
    if (lastFeedWarningRef.current === warningKey) return;

    lastFeedWarningRef.current = warningKey;
    addLog('WARN', `Trade guard aktif: feed ${feedStatus}${dataSource ? ` (${dataSource})` : ''}`);
  }, [botRunning, feedStatus, dataSource, addLog]);

  /**
   * AUTO EXECUTE TRADE when signal is valid and bot is running
   */
  useEffect(() => {
    if (!botRunning || !signal || signal.signal === 'WAIT') return;
    if (!currentPrice || !signal.entry) return;
    if (feedStatus !== 'realtime') return;
    
    // Check if price reached entry level (within 0.1% tolerance)
    const entryTolerance = signal.entry * 0.001;
    const priceNearEntry = Math.abs(currentPrice - signal.entry) < entryTolerance;
    
    if (priceNearEntry && signal.confidence >= 70) {
      addLog('TRADE', `🎯 Entry triggered @ ${formatPrice(currentPrice)}`);
      
      // Execute trade via API
      const executeTrade = async () => {
        try {
          const response = await fetch('/api/bot/execute', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(APP_API_KEY ? { 'x-app-api-key': APP_API_KEY } : {}),
            },
            body: JSON.stringify({
              signal,
              currentPrice,
              symbol,
              timeframe,
              mode: botMode,
            }),
          });
          
          if (response.ok) {
            const result = await response.json();
            addLog('TRADE', `✅ ${result.message || 'Trade executed'}`);
          } else {
            addLog('ERROR', `Trade execution failed: HTTP ${response.status}`);
          }
        } catch (err) {
          addLog('ERROR', `Trade execution error: ${err}`);
        }
      };
      
      if (botMode === 'live') {
        executeTrade();
      } else {
        addLog('DRY-RUN', `Would execute ${signal.signal} @ ${formatPrice(signal.entry)}`);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botRunning, signal, currentPrice, botMode, symbol, timeframe, addLog, feedStatus]);

  // Initialize on client side only (fix hydration)
  useEffect(() => {
    setMounted(true);
    addLog('INFO', 'System initialized');
  }, [addLog]);

  // Initialize chart
  useEffect(() => {
    if (!containerRef.current || chartRef.current) return;

    const initChart = async () => {
      try {
        const lwc = await import('lightweight-charts');
        
        const chart = lwc.createChart(containerRef.current!, {
          layout: {
            background: { color: CHART_COLORS.background },
            textColor: CHART_COLORS.text,
          },
          grid: {
            vertLines: { visible: false },
            horzLines: { color: CHART_COLORS.grid, style: 1 },
          },
          crosshair: {
            mode: lwc.CrosshairMode.Normal,
            vertLine: { color: CHART_COLORS.crosshair, width: 1, style: 2 },
            horzLine: { color: CHART_COLORS.crosshair, width: 1, style: 2 },
          },
          rightPriceScale: {
            borderColor: CHART_COLORS.grid,
            scaleMargins: { top: 0.1, bottom: 0.2 },
          },
          timeScale: {
            borderColor: CHART_COLORS.grid,
            timeVisible: true,
            secondsVisible: false,
          },
          handleScroll: { mouseWheel: true, pressedMouseMove: true },
          handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
        });

        // Candlestick series
        const candleSeries = chart.addSeries(lwc.CandlestickSeries, {
          upColor: CHART_COLORS.bullish,
          downColor: CHART_COLORS.bearish,
          borderUpColor: CHART_COLORS.bullish,
          borderDownColor: CHART_COLORS.bearish,
          wickUpColor: CHART_COLORS.bullishWick,
          wickDownColor: CHART_COLORS.bearishWick,
        });

        // Volume series
        const volumeSeries = chart.addSeries(lwc.HistogramSeries, {
          priceFormat: { type: 'volume' },
          priceScaleId: '',
        });
        volumeSeries.priceScale().applyOptions({
          scaleMargins: { top: 0.85, bottom: 0 },
        });

        chartRef.current = chart;
        candlestickSeriesRef.current = candleSeries;
        volumeSeriesRef.current = volumeSeries;
        setIsChartReady(true);

        // Handle resize
        const handleResize = () => {
          if (containerRef.current && chartRef.current) {
            chartRef.current.applyOptions({
              width: containerRef.current.clientWidth,
              height: containerRef.current.clientHeight,
            });
          }
        };
        window.addEventListener('resize', handleResize);
        handleResize();

        return () => {
          window.removeEventListener('resize', handleResize);
          chart.remove();
        };
      } catch (err) {
        console.error('Failed to init chart:', err);
      }
    };

    initChart();
  }, []);

  // Update chart data when candles change - INITIAL LOAD
  useEffect(() => {
    if (!isChartReady || !candlestickSeriesRef.current || candles.length === 0) return;

    // Helper to ensure time is always a number
    const getTimeAsNumber = (time: unknown): number => {
      if (typeof time === 'number') return time;
      if (typeof time === 'object' && time !== null) {
        // Handle UTCTimestamp object or Date
        if ('getTime' in (time as object)) return Math.floor((time as Date).getTime() / 1000);
        return Math.floor(Date.now() / 1000);
      }
      return Number(time) || Math.floor(Date.now() / 1000);
    };

    const chartData = candles.map((c: CandlestickData) => ({
      time: getTimeAsNumber(c.time),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    const volumeData = candles.map((c: CandlestickData) => ({
      time: getTimeAsNumber(c.time),
      value: c.volume || 0,
      color: c.close >= c.open 
        ? 'rgba(38, 166, 91, 0.3)' 
        : 'rgba(232, 92, 92, 0.3)',
    }));

    try {
      candlestickSeriesRef.current.setData(chartData);
      volumeSeriesRef.current?.setData(volumeData);
    } catch (err) {
      console.error('Chart setData error:', err);
    }
    
    // Only fit content on initial load, not on every update
    if (candles.length > 100) {
      chartRef.current?.timeScale().scrollToRealTime();
    } else {
      chartRef.current?.timeScale().fitContent();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isChartReady, candles.length > 0 ? candles[0]?.time : 0]); // Only run on initial load

  // REALTIME CHART UPDATE - Update last candle every tick
  useEffect(() => {
    if (!isChartReady || !candlestickSeriesRef.current || !currentPrice || candles.length === 0) return;

    const lastCandle = candles[candles.length - 1];
    if (!lastCandle || !lastCandle.time) return;

    // Ensure time is a number (Unix timestamp in seconds)
    const candleTime = typeof lastCandle.time === 'object' 
      ? Math.floor(new Date().getTime() / 1000) // Fallback to current time
      : Number(lastCandle.time);

    if (isNaN(candleTime) || candleTime <= 0) return;

    // Update the last candle with current tick price
    const updatedCandle = {
      time: candleTime,
      open: lastCandle.open,
      high: Math.max(lastCandle.high, currentPrice),
      low: Math.min(lastCandle.low, currentPrice),
      close: currentPrice,
    };

    // Update candlestick
    try {
      candlestickSeriesRef.current.update(updatedCandle);
    } catch {
      // Ignore update errors (e.g., time order issues)
    }

    // Update volume bar
    if (volumeSeriesRef.current) {
      try {
        volumeSeriesRef.current.update({
          time: candleTime,
          value: lastCandle.volume || 0,
          color: currentPrice >= lastCandle.open 
            ? 'rgba(38, 166, 91, 0.3)' 
            : 'rgba(232, 92, 92, 0.3)',
        });
      } catch {
        // Ignore update errors
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isChartReady, currentPrice, tickCount]); // Update on every tick

  // Draw trading levels when signal changes
  useEffect(() => {
    if (!isChartReady || !candlestickSeriesRef.current || !signal) return;
    if (signal.signal === 'WAIT') return;
    
    // Remove previous lines
    tradingLinesRef.current.forEach(line => {
      try {
        candlestickSeriesRef.current?.removePriceLine(line);
      } catch { /* ignore */ }
    });
    tradingLinesRef.current = [];
    
    // Draw new trading levels
    const createLine = (price: number, color: string, title: string, style: number = 0) => {
      const line = candlestickSeriesRef.current.createPriceLine({
        price,
        color,
        lineWidth: 2,
        lineStyle: style, // 0=solid, 2=dashed
        axisLabelVisible: true,
        title,
      });
      tradingLinesRef.current.push(line);
    };
    
    if (signal.entry) {
      createLine(signal.entry, '#3B82F6', 'ENTRY', 0);
    }
    if (signal.stop_loss) {
      createLine(signal.stop_loss, '#EF4444', 'SL', 2);
    }
    if (signal.take_profit_1) {
      createLine(signal.take_profit_1, '#10B981', 'TP1', 0);
    }
    if (signal.take_profit_2) {
      createLine(signal.take_profit_2, '#6EE7B7', 'TP2', 2);
    }
  }, [isChartReady, signal]);

  // Bot control handlers
  const handleStartBot = useCallback(async () => {
    if (botRunning) {
      // Stop bot
      setBotRunning(false);
      addLog('INFO', 'Bot stopped');
      
      // Call backend stop
      try {
        await fetch('/api/bot/stop', {
          method: 'POST',
          headers: {
            ...(APP_API_KEY ? { 'x-app-api-key': APP_API_KEY } : {}),
          },
        });
      } catch { /* ignore */ }
    } else {
      // Start bot
      setBotRunning(true);
      addLog('INFO', `Bot started in ${botMode.toUpperCase()} mode`);
      
      // Call backend start
      try {
        await fetch('/api/bot/start', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(APP_API_KEY ? { 'x-app-api-key': APP_API_KEY } : {}),
          },
          body: JSON.stringify({
            symbol,
            timeframe,
            dry_run: botMode === 'dry-run',
          })
        });
      } catch {
        addLog('ERROR', 'Failed to connect to bot backend');
      }
      
      // Fetch initial signal
      fetchSignal();
    }
  }, [botRunning, botMode, symbol, timeframe, addLog, fetchSignal]);

  // CONTINUOUS SIGNAL POLLING when bot is running
  useEffect(() => {
    if (!botRunning) return;
    
    // Poll signal every 5 seconds when bot is active
    const pollInterval = setInterval(() => {
      fetchSignal();
      console.log('[Bot] 🔍 Polling for new signal...');
    }, 5000);
    
    return () => clearInterval(pollInterval);
  }, [botRunning, fetchSignal]);

  // Log signal changes
  useEffect(() => {
    if (!signal) return;
    
    if (signal.signal !== 'WAIT') {
      addLog('SIGNAL', `${signal.signal} @ ${signal.entry} | SL: ${signal.stop_loss} | TP1: ${signal.take_profit_1}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signal?.signal, signal?.entry, addLog]);

  // ========================================
  // MOBILE VIEW
  // ========================================
  if (isMobile) {
    return (
      <MobileLayout
        symbol={symbol}
        price={currentPrice || 0}
        priceDirection={priceDirection}
        timeframe={timeframe}
        onTimeframeChangeAction={(tf) => setTimeframe(tf as Timeframe)}
        onSymbolChangeAction={setSymbol}
        botStatus={botRunning ? 'running' : 'stopped'}
        botMode={botMode}
        onBotStartAction={() => {
          setBotRunning(true);
          addLog('INFO', `Bot started in ${botMode.toUpperCase()} mode`);
          fetchSignal();
        }}
        onBotStopAction={() => {
          setBotRunning(false);
          addLog('INFO', 'Bot stopped');
        }}
        onBotModeChangeAction={(mode) => setBotMode(mode)}
        aiEnabled={aiEnabled}
        onAiToggleAction={setAiEnabled}
        signal={mobileSignal}
        sentimentData={sentimentData}
      >
        {/* Mobile Chart Container */}
        <div className="h-full w-full relative">
          <div ref={containerRef} className="absolute inset-0" />
          
          {/* Zoom Controls */}
          <div className="absolute top-2 right-2 flex gap-1 z-10">
            <button
              onClick={resetZoom}
              className="px-2 py-1 bg-blue-600/80 rounded text-xs text-white"
            >
              ▶▶ Latest
            </button>
            <button
              onClick={fitAll}
              className="px-2 py-1 bg-gray-800/80 rounded text-xs text-gray-300"
            >
              ↔ Fit All
            </button>
          </div>
          
          {/* Connection Status */}
          <div className="absolute bottom-2 left-2 z-10 bg-gray-900/80 rounded px-2 py-1 text-xs">
            <span className={isConnected ? 'text-emerald-400' : 'text-red-400'}>
              {isConnected ? '● LIVE' : '○ OFFLINE'}
            </span>
          </div>
        </div>
      </MobileLayout>
    );
  }

  // ========================================
  // DESKTOP VIEW
  // ========================================
  return (
    <div className="h-screen flex flex-col bg-[#0D1117] text-gray-100">
      {/* Header */}
      <header className="flex-shrink-0 px-4 py-3 border-b border-gray-800 bg-[#0D1117]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Symbol Selector */}
            <select
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm font-medium"
            >
              <option value="XAUUSD">XAUUSD (Gold)</option>
              <option value="BTCUSDT">BTCUSDT</option>
              <option value="ETHUSDT">ETHUSDT</option>
              <option value="EURUSD">EURUSD</option>
            </select>

            {/* Timeframe */}
            <div className="flex gap-1">
              {(['1m', '5m', '15m', '1h', '4h', '1d'] as const).map(tf => (
                <button
                  key={tf}
                  onClick={() => setTimeframe(tf)}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                    timeframe === tf
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>

            {/* Connection Status */}
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${isConnected ? feedBadge.dot : 'bg-red-500'}`} />
              <span className={`text-xs ${isConnected ? feedBadge.text : 'text-red-400'}`}>
                {isConnected ? feedBadge.label : 'Offline'}
              </span>
            </div>
          </div>

          {/* REALTIME PRICE DISPLAY - TradingView Style */}
          <div className="flex items-center gap-6">
            {/* Main Price */}
            <div className="text-right">
              <div className="flex items-baseline gap-2">
                <span className={`text-3xl font-bold tabular-nums transition-colors duration-100 ${
                  priceChange >= 0 ? 'text-emerald-400' : 'text-red-400'
                }`}>
                  {formatPrice(currentPrice)}
                </span>
                {/* Live indicator */}
                <span className="relative flex h-2 w-2">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${feedBadge.dot} opacity-75`}></span>
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${feedBadge.dot}`}></span>
                </span>
              </div>
              
              {/* Price Change */}
              <div className={`text-sm font-medium tabular-nums ${
                priceChange >= 0 ? 'text-emerald-400' : 'text-red-400'
              }`}>
                <span>{priceChange >= 0 ? '+' : ''}{formatPrice(priceChange)}</span>
                <span className="ml-1">({priceChangePercent >= 0 ? '+' : ''}{priceChangePercent.toFixed(2)}%)</span>
              </div>
            </div>
            
            {/* Tick Counter & Zoom Info */}
            <div className="text-xs text-gray-500 border-l border-gray-700 pl-4">
              <div>Ticks: {tickCount}</div>
              <div>Candles: {isZoomedOut ? `${zoomVisibleCount}↔` : zoomVisibleCount}</div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Chart Area */}
        <div className="flex-1 relative">
          <div ref={containerRef} className="absolute inset-0" />
          
          {/* Zoom Controls Overlay */}
          <div className="absolute top-3 right-3 flex gap-2 z-10">
            <button
              onClick={resetZoom}
              className="px-3 py-1.5 bg-blue-600/80 hover:bg-blue-500/80 rounded text-xs text-white border border-blue-500/50 backdrop-blur-sm transition-colors font-medium"
              title="Scroll to latest candle (Double-click)"
            >
              ▶▶ Latest
            </button>
            <button
              onClick={fitAll}
              className="px-3 py-1.5 bg-gray-800/80 hover:bg-gray-700/80 rounded text-xs text-gray-300 border border-gray-700 backdrop-blur-sm transition-colors"
              title="Fit all candles in view"
            >
              ↔ Fit All
            </button>
          </div>
          
          {/* Realtime Status Overlay */}
          <div className="absolute bottom-3 left-3 z-10 bg-gray-900/80 backdrop-blur-sm rounded px-3 py-1.5 text-xs border border-gray-700">
            <div className="flex items-center gap-3">
              <span className={isConnected ? feedBadge.text : 'text-red-400'}>
                {isConnected ? `● ${feedBadge.label.toUpperCase()}` : '○ OFFLINE'}
              </span>
              {mounted && lastTickTime && (
                <span className="text-gray-500">
                  Updated: {new Date(lastTickTime).toLocaleTimeString()}
                </span>
              )}
              {dataSource && (
                <span className="text-gray-500">
                  Source: {dataSource}
                </span>
              )}
            </div>
          </div>

          {symbol.includes('USD') && feedStatus !== 'realtime' && (
            <div className="absolute top-3 left-3 right-32 z-10 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 backdrop-blur-sm">
              Harga belum true realtime. Feed saat ini: {feedBadge.label}
              {dataSource ? ` dari ${dataSource}` : ''}.
              {marketStatus ? ` Market: ${marketStatus}.` : ''}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <aside className="w-[500px] flex-shrink-0 border-l border-gray-800 bg-[#0D1117] overflow-y-auto">
          <div className="p-4 space-y-4">
            {/* Bot Control */}
            <div className="bg-gray-800/50 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-400 mb-3">🤖 Bot Control</h3>
              
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full ${botRunning ? 'bg-emerald-500 animate-pulse' : 'bg-gray-600'}`} />
                  <span className="text-sm">{botRunning ? 'Running' : 'Stopped'}</span>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded ${
                  botMode === 'live' ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'
                }`}>
                  {botMode.toUpperCase()}
                </span>
              </div>

              <button
                onClick={handleStartBot}
                className={`w-full py-2.5 rounded-lg font-semibold transition-all ${
                  botRunning
                    ? 'bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30'
                    : 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/30'
                }`}
              >
                {botRunning ? '⏹ Stop Bot' : '▶ Start Bot'}
              </button>

              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => setBotMode(m => m === 'live' ? 'dry-run' : 'live')}
                  className="flex-1 py-2 rounded-lg text-xs bg-gray-700 hover:bg-gray-600 text-gray-300"
                >
                  {botMode === 'live' ? '🔴 LIVE' : '🟡 DRY-RUN'}
                </button>
                <button
                  onClick={() => setAiEnabled(a => !a)}
                  className={`flex-1 py-2 rounded-lg text-xs transition-colors ${
                    aiEnabled 
                      ? 'bg-blue-600/30 text-blue-400 border border-blue-500/30' 
                      : 'bg-gray-700 text-gray-500'
                  }`}
                >
                  {aiEnabled ? '🧠 AI ON' : '🧠 AI OFF'}
                </button>
              </div>
            </div>

            {/* PROBABILITY ENGINE — Primary Signal System */}
            <ProbabilityDashboard
              output={probEngine.output}
              loading={probEngine.loading}
              error={probEngine.error}
              onRefresh={probEngine.refresh}
            />

            {/* Market Sentiment from Kol API */}
            <MarketSentimentPanel symbol={symbol} />

            {/* Performance Stats */}
            <div className="bg-gray-800/50 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-400 mb-3">📈 Performance</h3>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-gray-500">Today P&L</p>
                  <p className="text-lg font-bold text-emerald-400">+$0.00</p>
                </div>
                <div>
                  <p className="text-gray-500">Win Rate</p>
                  <p className="text-lg font-bold text-white">--%</p>
                </div>
                <div>
                  <p className="text-gray-500">Total Trades</p>
                  <p className="text-lg font-bold text-white">0</p>
                </div>
                <div>
                  <p className="text-gray-500">Drawdown</p>
                  <p className="text-lg font-bold text-gray-400">0%</p>
                </div>
              </div>
            </div>

            {/* Execution Log */}
            <div className="bg-gray-800/50 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-400 mb-3">📋 Activity Log</h3>
              <div className="space-y-1.5 text-xs font-mono max-h-40 overflow-y-auto">
                {mounted && logs.map((log, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="text-gray-600 flex-shrink-0">{log.time}</span>
                    <span className={`flex-shrink-0 ${
                      log.type === 'SIGNAL' ? 'text-yellow-400' :
                      log.type === 'ERROR' ? 'text-red-400' :
                      log.type === 'TRADE' ? 'text-emerald-400' :
                      'text-blue-400'
                    }`}>[{log.type}]</span>
                    <span className="text-gray-400 truncate">{log.message}</span>
                  </div>
                ))}
                {mounted && logs.length === 0 && (
                  <div className="text-gray-600 text-center py-2">No logs yet</div>
                )}
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* Footer Status */}
      <footer className="flex-shrink-0 px-4 py-2 border-t border-gray-800 bg-[#0D1117]">
        <div className="flex items-center justify-between text-xs text-gray-500">
          <div className="flex items-center gap-4">
            <span className="font-medium text-gray-400">AI Market Visualization Engine</span>
            <span className="text-gray-600">|</span>
            <span>{symbol} / {timeframe.toUpperCase()}</span>
          </div>
          <div className="flex items-center gap-4">
            {error && <span className="text-red-400">⚠ {error}</span>}
            <span className={isConnected ? feedBadge.text : 'text-red-500'}>
              {isConnected ? `● ${feedBadge.label}` : '○ Disconnected'}
            </span>
            {dataSource && <span>Source: {dataSource}</span>}
            {marketStatus && <span>Market: {marketStatus}</span>}
            <span className="text-gray-600">|</span>
            <span>Visible: {visibleCandles.length} candles</span>
            {mounted && lastTickTime && (
              <>
                <span className="text-gray-600">|</span>
                <span>Last Tick: {new Date(lastTickTime).toLocaleTimeString()}</span>
              </>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
