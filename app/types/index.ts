/**
 * Shared Types
 * ============
 * Centralized TypeScript interfaces and types.
 */

// =====================
// Chart Types
// =====================

export interface CandlestickData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';

export const TIMEFRAMES: readonly Timeframe[] = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'] as const;

// =====================
// Signal Types
// =====================

export type SignalType = 'BUY' | 'SELL';

export interface TradingSignal {
  type: SignalType;
  symbol: string;
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2?: number;
  confidence: number;
  rrr: number;
  timestamp: number;
  reason: string;
}

export interface SmartSignal extends TradingSignal {
  zoneType?: 'supply' | 'demand';
  marketStructure?: string;
  qualityGrade?: 'A+' | 'A' | 'B' | 'C';
}

// =====================
// Bot Types
// =====================

export type BotState = 'IDLE' | 'RUNNING' | 'PAUSED' | 'STOPPED' | 'ERROR' | 'OFFLINE';

export interface BotStatus {
  state: BotState;
  symbol?: string;
  timeframe?: string;
  dryRun?: boolean;
  equity?: number;
  runningSince?: string;
  lastSignal?: TradingSignal;
  error?: string;
  totalTrades?: number;
  winningTrades?: number;
  totalPnl?: number;
}

export interface BotConfig {
  symbol: string;
  timeframe: Timeframe;
  dryRun: boolean;
  equity: number;
  riskPercent: number;
  leverage: number;
}

// =====================
// Position Types
// =====================

export interface Position {
  id: string;
  symbol: string;
  type: SignalType;
  entryPrice: number;
  currentPrice: number;
  stopLoss: number;
  takeProfit: number;
  lotSize: number;
  pnl: number;
  pnlPercent: number;
  openedAt: string;
}

export interface TradeRecord {
  id: string;
  symbol: string;
  side: SignalType;
  entryPrice: number;
  exitPrice?: number;
  quantity: number;
  stopLoss: number;
  takeProfit: number;
  status: 'open' | 'closed' | 'stopped_out' | 'take_profit';
  pnl: number;
  openedAt: string;
  closedAt?: string;
}

// =====================
// Analysis Types
// =====================

export interface SupplyDemandZone {
  id: string;
  type: 'supply' | 'demand';
  status: 'fresh' | 'tested' | 'broken';
  high: number;
  low: number;
  strength: number;
  formationTime: number;
  testCount: number;
}

export interface MarketStructure {
  trend: 'bullish' | 'bearish' | 'sideways';
  trendStrength: number;
  lastSwingHigh?: number;
  lastSwingLow?: number;
  structureBreak?: 'BOS' | 'CHOCH';
  currentPhase: 'impulse' | 'correction' | 'consolidation';
}

export interface SentimentData {
  sentiment: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  fearGreedIndex: number;
  sources: {
    name: string;
    value: number;
    direction: 'bullish' | 'bearish' | 'neutral';
  }[];
}

// =====================
// API Types
// =====================

export interface ApiResponse<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
  timestamp?: string;
}

export interface WebSocketMessage {
  type: 'kline' | 'ticker' | 'signal' | 'position' | 'error';
  data: unknown;
  timestamp: number;
}

// =====================
// UI Types
// =====================

export type PriceDirection = 'up' | 'down' | 'neutral';

export interface ChartColors {
  bullishBody: string;
  bullishWick: string;
  bearishBody: string;
  bearishWick: string;
  background: string;
  grid: string;
  text: string;
  crosshair: string;
}

export const CHART_COLORS: ChartColors = {
  bullishBody: '#26A65B',
  bullishWick: '#1E7A47',
  bearishBody: '#E85C5C',
  bearishWick: '#B84747',
  background: '#0D1117',
  grid: '#21262D',
  text: '#8B949E',
  crosshair: '#58A6FF',
};
