'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Note: Using 'any' for lightweight-charts refs due to complex generic type incompatibilities in v5

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { IChartApi } from 'lightweight-charts';
import { CandlestickData, Timeframe, CHART_COLORS } from './types';
import { useWebSocket } from './hooks/useWebSocket';
import { useChartResize } from './hooks/useChartResize';
import { useZoomPan } from './hooks/useZoomPan';
import { ChartToolbar } from './ChartToolbar';

interface ChartComponentProps {
  symbol?: string;
  initialTimeframe?: Timeframe;
  height?: number;
  onHistoricalData?: (data: CandlestickData[]) => void;
  onRealtimeUpdate?: (candle: CandlestickData) => void;
}

export function ChartComponent({
  symbol = 'BTCUSDT',
  initialTimeframe = '1h',
  height = 600,
  onHistoricalData,
  onRealtimeUpdate,
}: ChartComponentProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<any>(null);
  const volumeSeriesRef = useRef<any>(null);

  const [timeframe, setTimeframe] = useState<Timeframe>(initialTimeframe);
  const [currentPrice, setCurrentPrice] = useState<number | undefined>();
  const [priceChange, setPriceChange] = useState<number | undefined>();
  const [historicalData, setHistoricalData] = useState<CandlestickData[]>([]);
  const [isChartReady, setIsChartReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const historicalDataRef = useRef<CandlestickData[]>([]);
  const lastCandleTimeRef = useRef<number | null>(null);

  // Handle incoming real-time data
  const handleRealtimeData = useCallback((data: CandlestickData) => {
    if (candlestickSeriesRef.current && volumeSeriesRef.current && isChartReady) {
      try {
        candlestickSeriesRef.current.update({
          time: data.time as any,
          open: data.open,
          high: data.high,
          low: data.low,
          close: data.close,
        });

        volumeSeriesRef.current.update({
          time: data.time as any,
          value: data.volume || 0,
          color: data.close >= data.open
            ? `${CHART_COLORS.bullish}80`
            : `${CHART_COLORS.bearish}80`,
        });

        setCurrentPrice(data.close);

        // Avoid full state updates on every tick; only update when candle closes.
        const lastTime = lastCandleTimeRef.current;
        const refData = historicalDataRef.current;
        if (lastTime === null) {
          historicalDataRef.current = [data];
          lastCandleTimeRef.current = data.time;
          setHistoricalData([data]);
        } else if (data.time > lastTime) {
          historicalDataRef.current = [...refData, data].slice(-1000);
          lastCandleTimeRef.current = data.time;
          setHistoricalData(historicalDataRef.current);
        } else if (data.time === lastTime && refData.length > 0) {
          refData[refData.length - 1] = data;
        }
        
        // Forward to parent component
        onRealtimeUpdate?.(data);
      } catch (err) {
        console.error('Error updating chart:', err);
      }
    }
  }, [isChartReady, onRealtimeUpdate]);

  // Handle historical data
  const handleHistoricalData = useCallback((data: CandlestickData[]) => {
    historicalDataRef.current = data.slice(-1000);
    lastCandleTimeRef.current = historicalDataRef.current.length > 0
      ? historicalDataRef.current[historicalDataRef.current.length - 1].time
      : null;
    setHistoricalData(historicalDataRef.current);

    if (data.length > 0) {
      const firstPrice = data[0].close;
      const lastPrice = data[data.length - 1].close;
      const change = ((lastPrice - firstPrice) / firstPrice) * 100;
      setPriceChange(change);
      setCurrentPrice(lastPrice);
      
      // Forward to parent component
      onHistoricalData?.(data);
    }
  }, [onHistoricalData]);

  // WebSocket hook
  const { isConnected, connectionState, reconnect, retryCount } = useWebSocket({
    symbol,
    timeframe,
    onMessageAction: handleRealtimeData,
    onHistoricalDataAction: handleHistoricalData,
  });

  // Initialize chart
  useEffect(() => {
    let isMounted = true;

    const initializeChart = async () => {
      if (!chartContainerRef.current || !isMounted) return;

      try {
        // Dynamic import lightweight-charts v5
        const lwc = await import('lightweight-charts');
        
        // v5 API: createChart, CandlestickSeries, HistogramSeries
        const { createChart, CandlestickSeries, HistogramSeries } = lwc;

        if (!createChart) {
          throw new Error('createChart not found in lightweight-charts');
        }

        // Clear previous chart
        if (chartRef.current) {
          try {
            chartRef.current.remove();
          } catch (err) {
            console.error('Error removing previous chart:', err);
          }
        }

        const chart = createChart(chartContainerRef.current, {
          layout: {
            background: { color: CHART_COLORS.background },
            textColor: CHART_COLORS.text,
            fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          },
          grid: {
            vertLines: { color: CHART_COLORS.grid },
            horzLines: { color: CHART_COLORS.grid },
          },
          crosshair: {
            vertLine: {
              color: CHART_COLORS.crosshair,
              width: 1,
              style: 2,
              labelBackgroundColor: CHART_COLORS.crosshair,
            },
            horzLine: {
              color: CHART_COLORS.crosshair,
              width: 1,
              style: 2,
              labelBackgroundColor: CHART_COLORS.crosshair,
            },
          },
          rightPriceScale: {
            borderColor: CHART_COLORS.border,
            scaleMargins: {
              top: 0.1,
              bottom: 0.2,
            },
          },
          localization: {
            // CRITICAL: Prevent local timezone conversion — all timestamps are UTC
            locale: 'en-US',
            dateFormat: 'yyyy-MM-dd',
          },
          timeScale: {
            borderColor: CHART_COLORS.border,
            timeVisible: true,
            secondsVisible: false,
            rightOffset: 5,
            barSpacing: 8,
            minBarSpacing: 4,
          },
        });

        if (!chart) {
          throw new Error('Failed to create chart instance');
        }

        // Add candlestick series (v5 API)
        const candlestickSeries = chart.addSeries(CandlestickSeries, {
          upColor: CHART_COLORS.bullish,
          downColor: CHART_COLORS.bearish,
          borderUpColor: CHART_COLORS.bullish,
          borderDownColor: CHART_COLORS.bearish,
          wickUpColor: CHART_COLORS.bullish,
          wickDownColor: CHART_COLORS.bearish,
        });

        // Add volume series (v5 API)
        const volumeSeries = chart.addSeries(HistogramSeries, {
          priceFormat: {
            type: 'volume',
          },
          priceScaleId: 'volume',
        });

        // Configure volume scale
        chart.priceScale('volume').applyOptions({
          scaleMargins: {
            top: 0.85,
            bottom: 0,
          },
        });

        if (isMounted) {
          chartRef.current = chart;
          candlestickSeriesRef.current = candlestickSeries;
          volumeSeriesRef.current = volumeSeries;
          setIsChartReady(true);
          setError(null);
        }
      } catch (err) {
        console.error('Chart initialization error:', err);
        if (isMounted) {
          setError(`Failed to initialize chart: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }
    };

    initializeChart();

    return () => {
      isMounted = false;
      try {
        if (chartRef.current && typeof chartRef.current.remove === 'function') {
          chartRef.current.remove();
        }
      } catch (err) {
        console.error('Error cleaning up chart:', err);
      }
    };
  }, []);

  // Update chart data when historical data changes
  useEffect(() => {
    if (candlestickSeriesRef.current && volumeSeriesRef.current && historicalData.length > 0 && isChartReady) {
      try {
        const candleData = historicalData.map((d) => ({
          time: d.time,
          open: d.open,
          high: d.high,
          low: d.low,
          close: d.close,
        }));
        candlestickSeriesRef.current.setData(candleData);

        const volumeData = historicalData.map((d) => ({
          time: d.time,
          value: d.volume || 0,
          color: d.close >= d.open
            ? `${CHART_COLORS.bullish}80`
            : `${CHART_COLORS.bearish}80`,
        }));
        volumeSeriesRef.current.setData(volumeData);

        chartRef.current?.timeScale().fitContent();
      } catch (err) {
        console.error('Error setting chart data:', err);
      }
    }
  }, [historicalData, isChartReady]);

  // Chart resize hook
  useChartResize({
    chartRef: chartRef,
    containerRef: chartContainerRef,
  });

  // Zoom/Pan interaction hook
  useZoomPan({
    chartRef: chartRef,
    containerRef: chartContainerRef,
    enabled: true,
    minZoom: 3,
    maxZoom: 200,
    zoomSensitivity: 0.2,
    enableAutoHideOnZoom: true,
  });

  // Handle timeframe change
  const handleTimeframeChange = useCallback((newTimeframe: Timeframe) => {
    setTimeframe(newTimeframe);
    setHistoricalData([]);
    setCurrentPrice(undefined);
    setPriceChange(undefined);
  }, []);

  return (
    <div
      ref={containerRef}
      className="flex flex-col w-full bg-gray-900 rounded-xl overflow-hidden border border-gray-800 shadow-2xl"
      style={{ minHeight: height }}
    >
      {/* Toolbar */}
      <ChartToolbar
        symbol={symbol}
        timeframe={timeframe}
        onTimeframeChange={handleTimeframeChange}
        isConnected={isConnected}
        onReconnect={reconnect}
        currentPrice={currentPrice}
        priceChange={priceChange}
      />

      {/* Chart Container */}
      <div className="relative flex-1">
        {/* Error Overlay */}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900/90 z-20">
            <div className="flex flex-col items-center gap-3 text-center px-4">
              <div className="text-red-400 text-4xl">⚠️</div>
              <span className="text-red-400 text-sm">{error}</span>
              <button
                onClick={reconnect}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600 transition"
              >
                Reconnect
              </button>
            </div>
          </div>
        )}

        {/* Reconnecting Overlay */}
        {!error && connectionState === 'reconnecting' && (
          <div className="absolute top-2 right-2 z-20 flex items-center gap-2 bg-yellow-500/20 border border-yellow-500/40 rounded-lg px-3 py-1.5">
            <div className="w-3 h-3 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-yellow-400 text-xs">Reconnecting… (attempt {retryCount})</span>
          </div>
        )}

        {/* Loading Overlay */}
        {!error && historicalData.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900/90 z-10">
            <div className="flex flex-col items-center gap-3">
              <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-gray-400 text-sm">Loading chart data...</span>
            </div>
          </div>
        )}

        {/* Chart */}
        <div
          ref={chartContainerRef}
          className="w-full h-full"
          style={{ minHeight: height - 60 }}
        />

        {/* Zoom Controls Hint */}
        <div className="absolute bottom-4 left-4 bg-gray-900/70 backdrop-blur-sm rounded px-2 py-1 text-[10px] text-gray-500 pointer-events-none">
          <div className="flex items-center gap-2">
            <span>📊 Scroll: Zoom</span>
            <span>•</span>
            <span>🖱️ Drag: Pan</span>
            <span>•</span>
            <span>⏎ 2x Click: Reset</span>
          </div>
        </div>

        {/* Watermark */}
        <div className="absolute bottom-4 right-4 text-gray-700 text-xs font-medium pointer-events-none select-none">
          AI Trading Analysis
        </div>
      </div>

      {/* Bottom Status Bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-900/80 border-t border-gray-800 text-xs text-gray-500">
        <div className="flex items-center gap-4">
          <span>O: {currentPrice?.toFixed(2) || '-'}</span>
          <span>H: {currentPrice?.toFixed(2) || '-'}</span>
          <span>L: {currentPrice?.toFixed(2) || '-'}</span>
          <span>C: {currentPrice?.toFixed(2) || '-'}</span>
        </div>
        <div className="flex items-center gap-2">
          <span>Powered by</span>
          <span className="text-blue-400 font-medium">Binance</span>
        </div>
      </div>
    </div>
  );
}