// Types for Chart Component
export interface CandlestickData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface VolumeData {
  time: number;
  value: number;
  color: string;
}

export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';

export interface TimeframeOption {
  label: string;
  value: Timeframe;
  seconds: number;
}

export const TIMEFRAMES: TimeframeOption[] = [
  { label: 'M1', value: '1m', seconds: 60 },
  { label: 'M5', value: '5m', seconds: 300 },
  { label: 'M15', value: '15m', seconds: 900 },
  { label: 'M30', value: '30m', seconds: 1800 },
  { label: 'H1', value: '1h', seconds: 3600 },
  { label: 'H4', value: '4h', seconds: 14400 },
  { label: 'D1', value: '1d', seconds: 86400 },
];

export interface ChartColors {
  background: string;
  text: string;
  textMuted: string;
  grid: string;
  gridLight: string;
  bullish: string;
  bullishWick: string;
  bearish: string;
  bearishWick: string;
  crosshair: string;
  crosshairLabel: string;
  border: string;
  // Trading levels
  entry: string;
  stopLoss: string;
  takeProfit1: string;
  takeProfit2: string;
  // Structure colors
  bosLine: string;
  chochLine: string;
  swingHigh: string;
  swingLow: string;
}

// Professional clean color palette
// Tuned for excellent readability with minimal eye strain
// All colors have been carefully selected for contrast, accessibility, and visual hierarchy
export const CHART_COLORS: ChartColors = {
  background: '#0D1117',      // Dark background - GitHub dark mode inspired (#0D1117)
                              // Reduces eye strain vs pure black, maintains excellent contrast
  text: '#8B949E',            // Neutral gray for readability - optimal contrast with dark background
  textMuted: '#484F58',       // Muted text for secondary information (price axis, timestamps)
  
  // Grid Lines
  grid: '#21262D',            // Horizontal grid lines - subtle but visible for price reference
  gridLight: '#161B22',       // Vertical grid lines - hidden by default (visible on zoom-in)
  
  // Candlesticks - main visual elements
  bullish: '#26A65B',         // Emerald green - professional, not neon (RGB: 38, 166, 91)
                              // Represents growth/buying pressure visually
  bullishWick: '#1E8449',     // ~70% darker for wick definition - darker shade of emerald
  bearish: '#E85C5C',         // Soft red - warm, not harsh (RGB: 232, 92, 92)
                              // Less aggressive than bright red, easier on eyes
  bearishWick: '#C0392B',     // ~70% darker for wick definition - darker shade of red
  
  // Crosshair
  crosshair: '#58A6FF',       // Blue crosshair - excellent visibility without harshness
  crosshairLabel: '#1F6FEB',  // Crosshair label background - solid blue
  border: '#30363D',          // Subtle borders - almost invisible but defined
  
  // Trading levels - clearly distinguishable
  entry: '#3B82F6',           // Blue - entry signal (distinct from bullish color)
  stopLoss: '#EF4444',        // Red - stop loss level (stands out for risk awareness)
  takeProfit1: '#10B981',     // Green - primary take profit (aligns with bullish)
  takeProfit2: '#6EE7B7',     // Light green - secondary take profit (subtle variant)
  
  // Market structure - analytical overlays
  bosLine: '#60A5FA',         // Light blue for Break of Structure
  chochLine: '#FBBF24',       // Amber for Change of Character
  swingHigh: '#F87171',       // Light red for swing highs - fades with older markers
  swingLow: '#4ADE80',        // Light green for swing lows - fades with older markers
};

// ── Data Source Types ──

export type DataSourceType = 'crypto' | 'forex' | 'commodity';

export type ForexSymbol = 'XAUUSD' | 'XAGUSD' | 'EURUSD' | 'GBPUSD' | 'USDJPY';

export const FOREX_SYMBOLS: ForexSymbol[] = ['XAUUSD', 'XAGUSD', 'EURUSD', 'GBPUSD', 'USDJPY'];

/** Determine whether a symbol is forex/commodity (not available on Binance WS) */
export function isForexSymbol(symbol: string): boolean {
  return FOREX_SYMBOLS.includes(symbol.toUpperCase() as ForexSymbol);
}

/** Get the data source type for a symbol */
export function getDataSourceType(symbol: string): DataSourceType {
  const upper = symbol.toUpperCase();
  if (['XAUUSD', 'XAGUSD'].includes(upper)) return 'commodity';
  if (FOREX_SYMBOLS.includes(upper as ForexSymbol)) return 'forex';
  return 'crypto';
}

/** Get appropriate decimal precision for symbol */
export function getSymbolDecimals(symbol: string): number {
  const upper = symbol.toUpperCase();
  if (upper.includes('JPY')) return 3;
  if (['XAUUSD'].includes(upper)) return 2;
  if (['XAGUSD'].includes(upper)) return 3;
  if (['EURUSD', 'GBPUSD'].includes(upper)) return 5;
  if (upper.includes('DOGE') || upper.includes('SHIB')) return 6;
  return 2;
}

export interface TickerInfo {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  high24h: number;
  low24h: number;
  volume24h: number;
}
