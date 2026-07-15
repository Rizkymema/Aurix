'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Disabling no-explicit-any for lightweight-charts complex types

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { CandlestickData, Timeframe, CHART_COLORS } from './types';
import { useWebSocket } from './hooks/useWebSocket';
import { useChartResize } from './hooks/useChartResize';
import { useZoomPan } from './hooks/useZoomPan';
import { ChartToolbar } from './ChartToolbar';
import {
  useMarketStructure,
  MarketStructurePanel,
  toLightweightChartMarkers,
} from '../marketStructure';
import {
  useSupplyDemand,
  SupplyDemandPanel,
  ZONE_COLORS,
  PriceZone,
} from '../supplyDemand';
import {
  useCandlePatterns,
  CandlePatternPanel,
} from '../candlePattern';

// Signal types for trading levels
interface TradingSignal {
  type: 'BUY' | 'SELL';
  entry_zone: { high: number; low: number };
  sl: number;
  tp1: number;
  tp2?: number;
}

interface FullChartProps {
  symbol?: string;
  initialTimeframe?: Timeframe;
  height?: number;
  showMarketStructure?: boolean;
  showSupplyDemand?: boolean;
  showCandlePatterns?: boolean;
  showTradingLevels?: boolean;
  signal?: TradingSignal | null;
  structureConfig?: {
    swingLookback?: number;
    useZigZag?: boolean;
    zigZagDeviation?: number;
  };
  onHistoricalDataAction?: (data: CandlestickData[]) => void;
  onRealtimeUpdateAction?: (candle: CandlestickData) => void;
  onTimeframeChangeAction?: (timeframe: Timeframe) => void;
}

// Zone drawing interface
interface ZoneDrawTarget {
  context: CanvasRenderingContext2D;
  bitmapSize: { width: number; height: number };
}

interface ChartWithZones {
  timeScale: () => {
    timeToCoordinate: (time: number) => number | null;
    getVisibleLogicalRange: () => { from: number; to: number } | null;
  };
  applyOptions: (options: Record<string, unknown>) => void;
}

interface SeriesWithZones {
  priceToCoordinate: (price: number) => number | null;
}

// Rectangle primitive plugin for zones (for documentation - not currently used)
/* eslint-disable @typescript-eslint/no-unused-vars */
class _ZoneRectanglePlugin {
  private _chart: ChartWithZones;
  private _series: SeriesWithZones;
  private _zones: PriceZone[] = [];

  constructor(chart: ChartWithZones, series: SeriesWithZones) {
    this._chart = chart;
    this._series = series;
  }

  updateZones(zones: PriceZone[]) {
    this._zones = zones;
    this._chart.applyOptions({});
  }

  draw(target: ZoneDrawTarget) {
    const ctx = target.context;
    if (!ctx) return;

    for (const zone of this._zones) {
      const colors = ZONE_COLORS[zone.type][zone.status];
      
      // Get coordinates
      const y1 = this._series.priceToCoordinate(zone.top);
      const y2 = this._series.priceToCoordinate(zone.bottom);
      
      if (y1 === null || y2 === null) continue;

      const timeScale = this._chart.timeScale();
      const x1 = timeScale.timeToCoordinate(zone.startTime);
      const visibleRange = timeScale.getVisibleLogicalRange();
      
      if (x1 === null || !visibleRange) continue;

      // Get chart width for rectangle end
      const chartWidth = target.bitmapSize.width;
      const x2 = zone.status === 'mitigated' && zone.mitigatedAt
        ? timeScale.timeToCoordinate(zone.mitigatedAt) || chartWidth
        : chartWidth;

      // Draw rectangle
      ctx.fillStyle = colors.fill;
      ctx.fillRect(x1, Math.min(y1, y2), x2 - x1, Math.abs(y2 - y1));

      // Draw border
      ctx.strokeStyle = colors.border;
      ctx.lineWidth = 1;
      ctx.setLineDash(zone.status === 'mitigated' ? [4, 4] : []);
      ctx.strokeRect(x1, Math.min(y1, y2), x2 - x1, Math.abs(y2 - y1));
      ctx.setLineDash([]);

      // Draw label
      ctx.font = '10px Inter, sans-serif';
      ctx.fillStyle = colors.text;
      const label = `${zone.type === 'demand' ? 'D' : 'S'} ${zone.status === 'fresh' ? '🔥' : ''}`;
      ctx.fillText(label, x1 + 4, zone.type === 'demand' ? Math.max(y1, y2) - 4 : Math.min(y1, y2) + 12);
    }
  }
}

export function FullFeaturedChart({
  symbol = 'BTCUSDT',
  initialTimeframe = '1h',
  height = 600,
  showMarketStructure = true,
  showSupplyDemand = true,
  showCandlePatterns = true,
  showTradingLevels = true,
  signal = null,
  structureConfig,
  onHistoricalDataAction,
  onRealtimeUpdateAction,
  onTimeframeChangeAction,
}: FullChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const candlestickSeriesRef = useRef<any>(null);
  const volumeSeriesRef = useRef<any>(null);
  const structureLineSeriesRef = useRef<any[]>([]);
  const zoneSeriesRef = useRef<any[]>([]);
  const tradingLevelSeriesRef = useRef<any[]>([]);
  const markersPluginRef = useRef<any>(null);
  
  // Track current symbol to prevent stale data from being displayed
  const symbolRef = useRef<string>(symbol);

  const [timeframe, setTimeframe] = useState<Timeframe>(initialTimeframe);
  const [currentPrice, setCurrentPrice] = useState<number | undefined>();
  const [priceChange, setPriceChange] = useState<number | undefined>();
  const [historicalData, setHistoricalData] = useState<CandlestickData[]>([]);
  const [isChartReady, setIsChartReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const historicalDataRef = useRef<CandlestickData[]>([]);
  const lastCandleTimeRef = useRef<number | null>(null);
  
  // Panel visibility - using activePanel for single panel at a time
  const [activePanel, setActivePanel] = useState<'structure' | 'zones' | 'patterns' | null>('zones');

  // Handle timeframe change with external callback
  const handleTimeframeChange = useCallback((newTimeframe: Timeframe) => {
    setTimeframe(newTimeframe);
    setHistoricalData([]);
    setCurrentPrice(undefined);
    setPriceChange(undefined);
    onTimeframeChangeAction?.(newTimeframe);
  }, [onTimeframeChangeAction]);

  // Reset data when symbol changes
  useEffect(() => {
    // Update symbolRef immediately when symbol changes
    symbolRef.current = symbol;
    
    console.log(`[Chart] 🔄 Symbol changed to: ${symbol} - Clearing all data`);
    
    // Clear historical data to force fresh load
    setHistoricalData([]);
    setCurrentPrice(undefined);
    setPriceChange(undefined);
    setError(null);
    historicalDataRef.current = [];
    lastCandleTimeRef.current = null;
    
    // Clear chart series data AND reset scale
    if (candlestickSeriesRef.current) {
      try {
        candlestickSeriesRef.current.setData([]);
      } catch (e) { /* ignore */ }
    }
    if (volumeSeriesRef.current) {
      try {
        volumeSeriesRef.current.setData([]);
      } catch (e) { /* ignore */ }
    }
    
    // Force chart to reset price scale
    if (chartRef.current) {
      try {
        chartRef.current.priceScale('right').applyOptions({
          autoScale: true,
        });
        chartRef.current.timeScale().fitContent();
        console.log(`[Chart] 🔄 Chart scales reset for ${symbol}`);
      } catch (e) { /* ignore */ }
    }
  }, [symbol]);

  // Market Structure Analysis
  const { structure, visualization: structureViz, isLoading: structureLoading, refresh: refreshStructure } = useMarketStructure(
    historicalData,
    {
      config: { swingLookback: structureConfig?.swingLookback || 5 },
      useZigZag: structureConfig?.useZigZag ?? false,
      zigZagDeviation: structureConfig?.zigZagDeviation || 0.5,
      autoRefresh: true,
      refreshInterval: 10000,
    }
  );

  // Supply & Demand Analysis
  const {
    zones,
    freshZones,
    activeZones,
    visualization: zoneViz,
    demandBelow,
    supplyAbove,
    stats: zoneStats,
    isLoading: zonesLoading,
    refresh: refreshZones,
  } = useSupplyDemand(historicalData, currentPrice || null, {
    autoRefresh: true,
    refreshInterval: 15000,
    showMitigated: false,
  });

  // Candle Pattern Detection
  const {
    patterns,
    latestPattern,
    markers: patternMarkers,
    isScanning: patternScanning,
    scan: scanPatterns,
  } = useCandlePatterns(historicalData, {
    lookback: 50,
    autoScan: true,
    minReliability: 'MEDIUM',
  });

  // Check if price is valid for the symbol (to detect wrong data)
  const isPriceValidForSymbol = useCallback((price: number, sym: string): boolean => {
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
  }, []);

  // Handle incoming real-time data
  const handleRealtimeData = useCallback((data: CandlestickData) => {
    // Validate price matches current symbol
    const currentSymbol = symbolRef.current;
    if (!isPriceValidForSymbol(data.close, currentSymbol)) {
      console.warn(`[Chart] ⚠️ Realtime price ${data.close.toFixed(2)} doesn't match ${currentSymbol}, discarding`);
      return;
    }
    
    if (candlestickSeriesRef.current && volumeSeriesRef.current && isChartReady) {
      try {
        candlestickSeriesRef.current.update({
          time: data.time,
          open: data.open,
          high: data.high,
          low: data.low,
          close: data.close,
        });

        volumeSeriesRef.current.update({
          time: data.time,
          value: data.volume || 0,
          color: data.close >= data.open
            ? `${CHART_COLORS.bullish}40`
            : `${CHART_COLORS.bearish}40`,
        });

        setCurrentPrice(data.close);

        // Keep a mutable ref updated every tick, but only update state on candle close.
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
        
        onRealtimeUpdateAction?.(data);
      } catch (err) {
        console.error('Error updating chart:', err);
      }
    }
  }, [isChartReady, onRealtimeUpdateAction, isPriceValidForSymbol]);

  // Handle historical data
  const handleHistoricalData = useCallback((data: CandlestickData[]) => {
    // Validate that data matches current symbol using symbolRef
    const currentSymbol = symbolRef.current;
    console.log(`[Chart] Received ${data.length} historical candles, current symbol: ${currentSymbol}`);
    
    if (data.length > 0) {
      const avgPrice = data[data.length - 1].close;
      console.log(`[Chart] Price range: ${data[0]?.close.toFixed(2)} to ${avgPrice.toFixed(2)}`);
      
      // Validate price range matches expected symbol
      if (!isPriceValidForSymbol(avgPrice, currentSymbol)) {
        console.warn(`[Chart] ⚠️ Price ${avgPrice.toFixed(2)} doesn't match expected range for ${currentSymbol}, discarding data`);
        return;
      }
    }
    
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
      
      onHistoricalDataAction?.(data);
    }
  }, [onHistoricalDataAction, isPriceValidForSymbol]);

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
        const lwc = await import('lightweight-charts');
        const { createChart, CandlestickSeries, HistogramSeries, LineSeries } = lwc;

        if (!createChart) {
          throw new Error('createChart not found');
        }

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
            fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
            fontSize: 11,
          },
          grid: {
            vertLines: { 
              color: CHART_COLORS.gridLight, 
              style: 1,
              visible: false,  // No vertical lines for cleaner look
            },
            horzLines: { 
              color: CHART_COLORS.grid,
              style: 1,
              visible: true,
            },
          },
          crosshair: {
            mode: 1, // Normal crosshair
            vertLine: { 
              color: CHART_COLORS.crosshair, 
              width: 1, 
              style: 3, // Dotted
              labelBackgroundColor: CHART_COLORS.crosshairLabel,
              labelVisible: true,
            },
            horzLine: { 
              color: CHART_COLORS.crosshair, 
              width: 1, 
              style: 3, // Dotted
              labelBackgroundColor: CHART_COLORS.crosshairLabel,
              labelVisible: true,
            },
          },
          rightPriceScale: {
            borderColor: CHART_COLORS.border,
            borderVisible: false,  // Cleaner without border
            scaleMargins: { top: 0.1, bottom: 0.18 },
            autoScale: true,
            alignLabels: true,
            entireTextOnly: false,
          },
          localization: {
            // CRITICAL: Prevent lightweight-charts from converting timestamps
            // to browser-local timezone. All our timestamps are UTC.
            locale: 'en-US',
            dateFormat: 'yyyy-MM-dd',
          },
          timeScale: {
            borderColor: CHART_COLORS.border,
            borderVisible: false,  // Cleaner without border
            timeVisible: true,
            secondsVisible: false,
            rightOffset: 8,           // Space on right for live candle
            barSpacing: 8,            // Optimal default spacing
            minBarSpacing: 2,         // Minimum when zoomed out
            fixLeftEdge: false,
            fixRightEdge: false,
            lockVisibleTimeRangeOnResize: true,
            rightBarStaysOnScroll: true,
            shiftVisibleRangeOnNewBar: true,
            tickMarkFormatter: (time: number) => {
              // MUST use UTC methods — timestamps are Unix seconds UTC
              const date = new Date(time * 1000);
              const hours = date.getUTCHours().toString().padStart(2, '0');
              const minutes = date.getUTCMinutes().toString().padStart(2, '0');
              return `${hours}:${minutes}`;
            },
          },
          handleScroll: {
            mouseWheel: true,
            pressedMouseMove: true,
            horzTouchDrag: true,
            vertTouchDrag: false,
          },
          handleScale: {
            axisPressedMouseMove: {
              time: true,
              price: true,
            },
            axisDoubleClickReset: {
              time: true,
              price: true,
            },
            mouseWheel: true,
            pinch: true,
          },
          kineticScroll: {
            mouse: true,
            touch: true,
          },
          trackingMode: {
            exitMode: 1, // Exit on mouse leave
          },
        });

        if (!chart) {
          throw new Error('Failed to create chart');
        }

        const candlestickSeries = chart.addSeries(CandlestickSeries, {
          upColor: CHART_COLORS.bullish,           // Emerald green for bullish candles
          downColor: CHART_COLORS.bearish,         // Soft red for bearish candles
          borderUpColor: CHART_COLORS.bullish,     // Border matches body (no contrast)
          borderDownColor: CHART_COLORS.bearish,   // Border matches body (cleaner look)
          wickUpColor: CHART_COLORS.bullishWick,   // Slightly darker wick for definition
          wickDownColor: CHART_COLORS.bearishWick, // Slightly darker wick for definition
          borderVisible: false,                    // No border = cleaner, professional look
          priceLineVisible: true,                  // Shows last close price line
          priceLineWidth: 1,                       // Very thin for subtle reference
          priceLineColor: '#58A6FF40',             // Subtle blue line (transparent)
          priceLineStyle: 2,                       // Dotted style (not actual candle)
          lastValueVisible: true,                  // Shows last close on price axis
        });

        const volumeSeries = chart.addSeries(HistogramSeries, {
          priceFormat: { type: 'volume' },
          priceScaleId: 'volume',
          color: '#3B82F620',           // Very subtle volume (20% opacity blue)
          lastValueVisible: false,      // Don't show volume value on axis
          priceLineVisible: false,      // No price line for volume
        });

        chart.priceScale('volume').applyOptions({
          scaleMargins: { top: 0.88, bottom: 0 },
          borderVisible: false,
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
        if (chartRef.current) {
          chartRef.current.remove();
        }
      } catch (err) {
        console.error('Error cleaning up chart:', err);
      }
    };
  }, []);

  // Update chart data - render as soon as chart is ready OR data changes
  useEffect(() => {
    if (!candlestickSeriesRef.current || !volumeSeriesRef.current || !isChartReady) {
      console.log('[Chart] Chart not ready yet for data rendering');
      return;
    }

    if (historicalData.length === 0) {
      console.log('[Chart] No historical data to display yet');
      return;
    }

    try {
      const minPrice = Math.min(...historicalData.map(d => d.low));
      const maxPrice = Math.max(...historicalData.map(d => d.high));
      const currentSymbol = symbolRef.current;
      
      console.log(`[Chart] Rendering ${historicalData.length} candles for ${currentSymbol}, Price range: $${minPrice.toFixed(2)} - $${maxPrice.toFixed(2)}`);
      
      // Validate data matches current symbol before rendering
      const avgPrice = (minPrice + maxPrice) / 2;
      if (currentSymbol.toUpperCase() === 'XAUUSD' && (avgPrice < 2000 || avgPrice > 8000)) {
        console.warn(`[Chart] ⚠️ Price range $${minPrice.toFixed(0)}-$${maxPrice.toFixed(0)} doesn't match XAUUSD, skipping render`);
        return;
      }
      if (currentSymbol.toUpperCase() === 'BTCUSDT' && avgPrice < 10000) {
        console.warn(`[Chart] ⚠️ Price range doesn't match BTCUSDT, skipping render`);
        return;
      }
      
      // Set candlestick data
      const candleData = historicalData.map(d => ({
        time: d.time as any,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
      }));
      
      candlestickSeriesRef.current.setData(candleData);

      // Set volume data
      const volumeData = historicalData.map(d => ({
        time: d.time as any,
        value: d.volume || 0,
        color: d.close >= d.open ? `${CHART_COLORS.bullish}35` : `${CHART_COLORS.bearish}35`,
      }));
      
      volumeSeriesRef.current.setData(volumeData);

      // Auto-scale and fit content
      if (chartRef.current) {
        setTimeout(() => {
          if (chartRef.current) {
            try {
              chartRef.current.priceScale('right').applyOptions({
                autoScale: true,
              });
              
              chartRef.current.timeScale().fitContent();
              console.log('[Chart] Chart fitted and scaled');
            } catch (e) {
              console.error('[Chart] Error during scale/fit:', e);
            }
          }
        }, 100);
      }
    } catch (err) {
      console.error('[Chart] Error setting chart data:', err);
    }
  }, [historicalData, isChartReady]);

  // Update structure markers and pattern markers - CLEAN PROFESSIONAL VERSION
  useEffect(() => {
    if (!candlestickSeriesRef.current || !isChartReady) return;

    const updateMarkers = async () => {
      try {
        // Only show most recent markers for clean professional look
        const maxSwingMarkers = 8;     // Last 8 swing points (high + low pairs)
        const maxBosMarkers = 3;       // Last 3 Break of Structure only
        const maxChochMarkers = 2;     // Last 2 Change of Character only
        const maxPatternMarkers = 4;   // Last 4 recent candle patterns
        
        const structureMarkersList = structureViz && showMarketStructure ? [
          ...toLightweightChartMarkers(structureViz.swingMarkers).slice(-maxSwingMarkers),
          ...toLightweightChartMarkers(structureViz.bosMarkers).slice(-maxBosMarkers),
          ...toLightweightChartMarkers(structureViz.chochMarkers).slice(-maxChochMarkers),
        ] : [];

        const patternMarkersList = showCandlePatterns ? patternMarkers.slice(-maxPatternMarkers).map(m => ({
          time: m.time as any,
          position: m.position,
          color: m.color,
          shape: m.shape as any,
          text: m.text,
          size: 1,  // Small marker size for professional look - won't clutter chart
        })) : [];

        const allMarkers = [
          ...structureMarkersList,
          ...patternMarkersList,
        ].sort((a, b) => (a.time as number) - (b.time as number));

        // Use v5 createSeriesMarkers API - supports lightweight-charts v5
        const lwc = await import('lightweight-charts');
        if (!markersPluginRef.current && lwc.createSeriesMarkers) {
          markersPluginRef.current = lwc.createSeriesMarkers(candlestickSeriesRef.current, allMarkers);
        } else if (markersPluginRef.current) {
          markersPluginRef.current.setMarkers(allMarkers);
        }
      } catch (err) {
        console.error('Error setting markers:', err);
      }
    };

    updateMarkers();
  }, [structureViz, showMarketStructure, showCandlePatterns, patternMarkers, isChartReady]);

  // Update structure lines - PROFESSIONAL CLEAN VERSION
  useEffect(() => {
    if (!chartRef.current || !structureViz || !showMarketStructure || !isChartReady) return;

    const updateLines = async () => {
      try {
        const lwc = await import('lightweight-charts');
        const { LineSeries } = lwc;

        structureLineSeriesRef.current.forEach(series => {
          try {
            if (chartRef.current && series) {
              chartRef.current.removeSeries(series);
            }
          } catch (err) {
            console.warn('[Chart] Failed to remove structure line series:', err);
          }
        });
        structureLineSeriesRef.current = [];

        // Only show last 2 lines for each type - minimal visual clutter for professional look
        const recentHighLines = structureViz.swingHighLines.slice(-2);
        for (const lineData of recentHighLines) {
          if (lineData.length >= 2) {
            const lineSeries = chartRef.current.addSeries(LineSeries, {
              color: `${CHART_COLORS.swingHigh}70`,  // Semi-transparent red (~70% opacity)
              lineWidth: 1,                         // Thin for cleanliness
              lineStyle: 2,                         // Dashed line (not continuous)
              priceLineVisible: false,              // No price line on right axis
              lastValueVisible: false,              // Don't show value labels
              crosshairMarkerVisible: false,        // No crosshair interaction
              title: 'Swing High',
            });
            lineSeries.setData(lineData as any);
            structureLineSeriesRef.current.push(lineSeries);
          }
        }

        // Draw recent swing low lines
        const recentLowLines = structureViz.swingLowLines.slice(-2);
        for (const lineData of recentLowLines) {
          if (lineData.length >= 2) {
            const lineSeries = chartRef.current.addSeries(LineSeries, {
              color: `${CHART_COLORS.swingLow}70`,   // Semi-transparent green (~70% opacity)
              lineWidth: 1,                         // Thin for cleanliness
              lineStyle: 2,                         // Dashed line (not continuous)
              priceLineVisible: false,              // No price line on right axis
              lastValueVisible: false,              // Don't show value labels
              crosshairMarkerVisible: false,        // No crosshair interaction
              title: 'Swing Low',
            });
            lineSeries.setData(lineData as any);
            structureLineSeriesRef.current.push(lineSeries);
          }
        }
      } catch (err) {
        console.error('Error updating structure lines:', err);
      }
    };

    updateLines();
  }, [structureViz, showMarketStructure, isChartReady]);

  // Update Supply & Demand zone lines - CLEAN with only fresh zones near price
  useEffect(() => {
    if (!chartRef.current || !zoneViz || !showSupplyDemand || !isChartReady) return;

    const updateZones = async () => {
      try {
        const lwc = await import('lightweight-charts');
        const { LineSeries } = lwc;

        // Remove existing zone series
        zoneSeriesRef.current.forEach(series => {
          try { chartRef.current.removeSeries(series); } catch (e) {}
        });
        zoneSeriesRef.current = [];

        // Only show fresh zones near current price (max 3 total - prioritize closest)
        // This keeps the chart clean and focused on the most relevant zones
        const maxZones = 3;
        const freshZonesOnly = zoneViz.rectangles
          .filter(r => r.status !== 'mitigated')  // Exclude already-hit zones
          .slice(-maxZones);                      // Show only most recent

        // Draw zones using line series (top and bottom boundary lines)
        for (const rect of freshZonesOnly) {
          const lastTime = historicalData.length > 0 
            ? historicalData[historicalData.length - 1].time + 50 * 3600
            : rect.endTime;

          // Determine if supply or demand based on rect color
          const isSupply = rect.borderColor.includes('ef') || rect.borderColor.includes('rose');
          const borderColor = isSupply ? '#EF4444' : '#10B981';  // Red for supply, green for demand
          const lineStyle = 0;  // Solid lines for zone boundaries

          // Top boundary line (supply/demand top edge)
          const topLine = chartRef.current.addSeries(LineSeries, {
            color: borderColor,
            lineWidth: 1,                         // Thin line for cleanliness
            lineStyle: lineStyle,                 // Solid boundary
            priceLineVisible: false,              // No price line
            lastValueVisible: false,              // No value labels
            crosshairMarkerVisible: false,        // No crosshair interaction
            title: isSupply ? 'Supply Zone' : 'Demand Zone',
          });
          topLine.setData([
            { time: rect.startTime, value: rect.top },
            { time: lastTime, value: rect.top },
          ] as any);
          zoneSeriesRef.current.push(topLine);

          // Bottom boundary line (supply/demand bottom edge)
          const bottomLine = chartRef.current.addSeries(LineSeries, {
            color: borderColor,
            lineWidth: 1,                         // Thin line for cleanliness
            lineStyle: lineStyle,                 // Solid boundary
            priceLineVisible: false,              // No price line
            lastValueVisible: false,              // No value labels
            crosshairMarkerVisible: false,        // No crosshair interaction
            title: isSupply ? 'Supply Zone' : 'Demand Zone',
          });
          bottomLine.setData([
            { time: rect.startTime, value: rect.bottom },
            { time: lastTime, value: rect.bottom },
          ] as any);
          zoneSeriesRef.current.push(bottomLine);
        }
      } catch (err) {
        console.error('Error updating zones:', err);
      }
    };

    updateZones();
  }, [zoneViz, showSupplyDemand, isChartReady, historicalData]);

  // Update Trading Level lines (Entry, SL, TP)
  useEffect(() => {
    if (!chartRef.current || !isChartReady || !showTradingLevels) return;

    const updateTradingLevels = async () => {
      try {
        const lwc = await import('lightweight-charts');
        const { LineSeries } = lwc;

        // Remove existing trading level series
        tradingLevelSeriesRef.current.forEach(series => {
          try { chartRef.current.removeSeries(series); } catch (e) { /* ignore */ }
        });
        tradingLevelSeriesRef.current = [];

        // If no signal, don't draw levels
        if (!signal) return;

        const lastTime = historicalData.length > 0 
          ? historicalData[historicalData.length - 1].time + 100 * 3600
          : Date.now() / 1000;
        const startTime = historicalData.length > 30
          ? historicalData[historicalData.length - 30].time
          : historicalData[0]?.time || Date.now() / 1000 - 100 * 3600;

        // Entry zone - single mid-line (blue solid, thin)
        const entryMid = (signal.entry_zone.high + signal.entry_zone.low) / 2;
        const entryLine = chartRef.current.addSeries(LineSeries, {
          color: '#3B82F6',              // Blue - distinct from candle colors
          lineWidth: 1,                  // Thin for clarity
          lineStyle: 0,                  // Solid line
          priceLineVisible: false,       // No price line on right axis
          lastValueVisible: true,        // Show value on price scale
          crosshairMarkerVisible: false, // No interaction markers
          title: 'Entry Level',
        });
        entryLine.setData([
          { time: startTime, value: entryMid },
          { time: lastTime, value: entryMid },
        ] as any);
        tradingLevelSeriesRef.current.push(entryLine);

        // Stop Loss line (red dashed, thin) - red alerts to risk
        const slLine = chartRef.current.addSeries(LineSeries, {
          color: '#EF4444',              // Red - signals risk/stop loss
          lineWidth: 1,                  // Thin for clarity
          lineStyle: 2,                  // Dashed line (conditional level)
          priceLineVisible: false,       // No price line on right axis
          lastValueVisible: true,        // Show value on price scale
          crosshairMarkerVisible: false, // No interaction markers
          title: 'Stop Loss',
        });
        slLine.setData([
          { time: startTime, value: signal.sl },
          { time: lastTime, value: signal.sl },
        ] as any);
        tradingLevelSeriesRef.current.push(slLine);

        // Take Profit 1 line (green solid, thin) - primary target
        const tp1Line = chartRef.current.addSeries(LineSeries, {
          color: '#10B981',              // Green - matches bullish color
          lineWidth: 1,                  // Thin for clarity
          lineStyle: 0,                  // Solid line (primary target)
          priceLineVisible: false,       // No price line on right axis
          lastValueVisible: true,        // Show value on price scale
          crosshairMarkerVisible: false, // No interaction markers
          title: 'Take Profit 1',
        });
        tp1Line.setData([
          { time: startTime, value: signal.tp1 },
          { time: lastTime, value: signal.tp1 },
        ] as any);
        tradingLevelSeriesRef.current.push(tp1Line);

        // Take Profit 2 line (green dashed) - secondary target, less emphasis
        if (signal.tp2) {
          const tp2Line = chartRef.current.addSeries(LineSeries, {
            color: '#10B98180',            // Semi-transparent green (secondary)
            lineWidth: 1,                  // Thin for clarity
            lineStyle: 2,                  // Dashed line (secondary target)
            priceLineVisible: false,       // No price line on right axis
            lastValueVisible: true,        // Show value on price scale
            crosshairMarkerVisible: false, // No interaction markers
            title: 'Take Profit 2',
          });
          tp2Line.setData([
            { time: startTime, value: signal.tp2 },
            { time: lastTime, value: signal.tp2 },
          ] as any);
          tradingLevelSeriesRef.current.push(tp2Line);
        }

      } catch (err) {
        console.error('Error updating trading levels:', err);
      }
    };

    updateTradingLevels();
  }, [signal, showTradingLevels, isChartReady, historicalData]);

  // Chart resize hook
  useChartResize({
    chartRef: chartRef,
    containerRef: chartContainerRef,
  });

  // Zoom/Pan interaction hook - scroll wheel, drag pan, double-click reset
  useZoomPan({
    chartRef: chartRef,
    containerRef: chartContainerRef,
    enabled: true,
    minZoom: 3,        // Show at least 3 candles
    maxZoom: 200,      // Show at most 200 candles
    zoomSensitivity: 0.2,  // Moderate zoom speed
    enableAutoHideOnZoom: true,  // Hide details when zoomed out
  });

  return (
    <div className="flex gap-4">
      {/* Main Chart */}
      <div
        ref={containerRef}
        className="flex-1 flex flex-col bg-gray-900 rounded-xl overflow-hidden border border-gray-800 shadow-2xl"
        style={{ minHeight: height }}
      >
        {/* Toolbar */}
        <div className="flex items-center justify-between border-b border-gray-800">
          <ChartToolbar
            symbol={symbol}
            timeframe={timeframe}
            onTimeframeChange={handleTimeframeChange}
            isConnected={isConnected}
            onReconnect={reconnect}
            currentPrice={currentPrice}
            priceChange={priceChange}
          />
          
          {/* Feature Toggles */}
          <div className="flex items-center gap-2 px-4">
            <button
              onClick={() => setActivePanel(activePanel === 'structure' ? null : 'structure')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activePanel === 'structure'
                  ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                  : 'bg-gray-700/50 text-gray-400 border border-gray-600/30 hover:text-gray-300'
              }`}
            >
              Structure
            </button>
            <button
              onClick={() => setActivePanel(activePanel === 'zones' ? null : 'zones')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activePanel === 'zones'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'bg-gray-700/50 text-gray-400 border border-gray-600/30 hover:text-gray-300'
              }`}
            >
              S/D Zones
            </button>
            <button
              onClick={() => setActivePanel(activePanel === 'patterns' ? null : 'patterns')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activePanel === 'patterns'
                  ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                  : 'bg-gray-700/50 text-gray-400 border border-gray-600/30 hover:text-gray-300'
              }`}
            >
              🕯️ Patterns
            </button>
          </div>
        </div>

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

          {/* Reconnecting Banner */}
          {!error && connectionState === 'reconnecting' && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-yellow-500/15 border border-yellow-500/30 rounded-lg px-4 py-1.5 backdrop-blur-sm">
              <div className="w-3 h-3 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-yellow-400 text-xs font-medium">Reconnecting… (attempt {retryCount})</span>
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

          <div
            ref={chartContainerRef}
            className="w-full h-full"
            style={{ minHeight: height - 60 }}
          />

          {/* Legend - Minimal Professional Style */}
          <div className="absolute top-2 left-2 flex flex-wrap gap-3 bg-gray-900/70 backdrop-blur-sm rounded px-2 py-1.5 text-[10px]">
            {showMarketStructure && (
              <>
                <div className="flex items-center gap-1">
                  <div className="w-2 h-0.5 bg-emerald-500/60" />
                  <span className="text-gray-500">Bullish</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2 h-0.5 bg-red-500/60" />
                  <span className="text-gray-500">Bearish</span>
                </div>
              </>
            )}
            {showSupplyDemand && (
              <>
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-sm border border-emerald-500/50" />
                  <span className="text-gray-500">D</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-sm border border-red-500/50" />
                  <span className="text-gray-500">S</span>
                </div>
              </>
            )}
            {showCandlePatterns && patterns.length > 0 && (
              <div className="flex items-center gap-1">
                <span className="text-purple-400/70">⬡ {patterns.length}</span>
              </div>
            )}
          </div>

          {/* Zone Stats - Minimal */}
          {showSupplyDemand && zoneStats && zoneStats.freshZones > 0 && (
            <div className="absolute top-2 right-2 bg-gray-900/70 backdrop-blur-sm rounded px-2 py-1 text-[10px]">
              <span className="text-amber-400/80">🔥{zoneStats.freshZones}</span>
            </div>
          )}

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

          <div className="absolute bottom-4 right-4 text-gray-800 text-[10px] font-medium pointer-events-none select-none">
            AI Trading Analysis
          </div>
        </div>

        {/* Status Bar - Clean Professional */}
        <div className="flex items-center justify-between px-4 py-1.5 bg-gray-900/90 border-t border-gray-800/50 text-[11px]">
          {/* OHLC Data */}
          <div className="flex items-center gap-3 text-gray-500">
            {historicalData.length > 0 && (
              <>
                <span>O <span className="text-gray-300 font-mono">{historicalData[historicalData.length - 1]?.open.toFixed(2)}</span></span>
                <span>H <span className="text-emerald-400/80 font-mono">{historicalData[historicalData.length - 1]?.high.toFixed(2)}</span></span>
                <span>L <span className="text-red-400/80 font-mono">{historicalData[historicalData.length - 1]?.low.toFixed(2)}</span></span>
                <span>C <span className="text-gray-200 font-mono">{currentPrice?.toFixed(2) || '-'}</span></span>
              </>
            )}
          </div>

          {/* Trading Info - Clean Minimal */}
          <div className="flex items-center gap-2">
            {/* Trading Signal Levels */}
            {signal && (
              <div className="flex items-center gap-2 text-[10px]">
                <span className="text-blue-400/80 font-mono">E:{((signal.entry_zone.high + signal.entry_zone.low) / 2).toFixed(2)}</span>
                <span className="text-red-400/80 font-mono">S:{signal.sl.toFixed(2)}</span>
                <span className="text-emerald-400/80 font-mono">T:{signal.tp1.toFixed(2)}</span>
              </div>
            )}

            {/* Trend */}
            {structure && (
              <span className={`text-xs ${
                structure.currentTrend === 'bullish' ? 'text-emerald-400/80' :
                structure.currentTrend === 'bearish' ? 'text-red-400/80' : 'text-gray-500'
              }`}>
                {structure.currentTrend === 'bullish' ? '▲' : 
                 structure.currentTrend === 'bearish' ? '▼' : '–'}
              </span>
            )}

            <span className="text-gray-700">·</span>
            <span className="text-gray-600 text-[10px]">
              {symbol.includes('XAU') ? 'XAUUSD' : symbol}
            </span>
          </div>
        </div>
      </div>

      {/* Side Panel */}
      {activePanel && (
        <div className="w-80 flex-shrink-0 space-y-4">
          {activePanel === 'structure' && showMarketStructure && (
            <MarketStructurePanel
              structure={structure}
              isLoading={structureLoading}
              error={null}
              onRefresh={refreshStructure}
            />
          )}
          {activePanel === 'zones' && showSupplyDemand && (
            <SupplyDemandPanel
              zones={activeZones}
              currentPrice={currentPrice || null}
              isLoading={zonesLoading}
              error={null}
              onRefresh={refreshZones}
            />
          )}
          {activePanel === 'patterns' && showCandlePatterns && (
            <CandlePatternPanel
              patterns={patterns}
              latestPattern={latestPattern}
              isScanning={patternScanning}
              onScan={scanPatterns}
            />
          )}
        </div>
      )}
    </div>
  );
}
