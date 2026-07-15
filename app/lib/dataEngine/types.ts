/**
 * UNIFIED DATA ENGINE - Type Definitions
 * 
 * Core types for the synchronized data pipeline:
 * Data Ingestion → M1 Base Candle → Timeframe Aggregator → Indicator Engine → Signal Engine
 */

// ============================================
// BASE CANDLE TYPES (M1 as foundation)
// ============================================

export interface BaseCandle {
  timestamp: number;      // Unix timestamp in SECONDS (UTC)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  // Metadata
  source: DataSource;
  symbol: string;
  isComplete: boolean;    // true if candle is closed
}

export interface AggregatedCandle extends BaseCandle {
  timeframe: Timeframe;
  sourceCandles: number;  // Number of M1 candles used
  aggregatedAt: number;   // When aggregation occurred
}

// ============================================
// TIMEFRAME DEFINITIONS
// ============================================

export type Timeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1';

export const TIMEFRAME_CONFIG: Record<Timeframe, {
  minutes: number;
  seconds: number;
  label: string;
  apiInterval: string;  // Binance format
}> = {
  'M1':  { minutes: 1,    seconds: 60,     label: '1 Minute',  apiInterval: '1m' },
  'M5':  { minutes: 5,    seconds: 300,    label: '5 Minutes', apiInterval: '5m' },
  'M15': { minutes: 15,   seconds: 900,    label: '15 Minutes', apiInterval: '15m' },
  'M30': { minutes: 30,   seconds: 1800,   label: '30 Minutes', apiInterval: '30m' },
  'H1':  { minutes: 60,   seconds: 3600,   label: '1 Hour',    apiInterval: '1h' },
  'H4':  { minutes: 240,  seconds: 14400,  label: '4 Hours',   apiInterval: '4h' },
  'D1':  { minutes: 1440, seconds: 86400,  label: '1 Day',     apiInterval: '1d' },
};

// How many M1 candles needed to create each timeframe
export const AGGREGATION_RATIO: Record<Timeframe, number> = {
  'M1': 1,
  'M5': 5,
  'M15': 15,
  'M30': 30,
  'H1': 60,
  'H4': 240,
  'D1': 1440,
};

// ============================================
// DATA SOURCE DEFINITIONS
// ============================================

export type DataSource = 
  | 'binance'           // Primary for crypto
  | 'goldprice.org'     // Primary for XAUUSD spot
  | 'goldprice'         // Alias for goldprice.org
  | 'yahoo-finance'     // Backup for commodities
  | 'cryptocompare'     // Backup for crypto
  | 'simulation'        // Fallback when APIs fail
  | 'aggregated'        // Generated from M1 candles
  | 'cache'             // From cache
  | 'M1-aggregated';    // Aggregated from M1 candles

export interface DataSourceConfig {
  name: string;
  source: DataSource;
  priority: number;     // Lower = higher priority
  rateLimit: number;    // Max requests per minute
  timeout: number;      // Request timeout in ms
  supportsSymbols: string[];
}

// Named data sources for easy access
export const DATA_SOURCES: Record<string, DataSourceConfig> = {
  binance: {
    name: 'binance',
    source: 'binance',
    priority: 1,
    rateLimit: 1200,
    timeout: 5000,
    supportsSymbols: ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'],
  },
  goldPrice: {
    name: 'goldprice',
    source: 'goldprice.org',
    priority: 1,
    rateLimit: 60,
    timeout: 5000,
    supportsSymbols: ['XAUUSD'],
  },
  yahooFinance: {
    name: 'yahoo-finance',
    source: 'yahoo-finance',
    priority: 2,
    rateLimit: 100,
    timeout: 10000,
    supportsSymbols: ['XAUUSD', 'XAGUSD', 'EURUSD', 'GBPUSD'],
  },
  cryptoCompare: {
    name: 'cryptocompare',
    source: 'cryptocompare',
    priority: 2,
    rateLimit: 100,
    timeout: 8000,
    supportsSymbols: ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'],
  },
};

// ============================================
// DATA VALIDATION TYPES
// ============================================

export interface DataIntegrityReport {
  symbol: string;
  timeframe: Timeframe;
  totalCandles: number;
  missingCandles: number;
  duplicateCandles: number;
  priceGaps: PriceGap[];
  abnormalSpikes: AbnormalSpike[];
  isValid: boolean;
  issues: string[];
  checkedAt: number;
}

export interface PriceGap {
  fromTime: number;
  toTime: number;
  gapSize: number;       // In timeframe units
  expectedCandles: number;
}

export interface AbnormalSpike {
  time: number;
  price: number;
  priceChange: number;   // Percentage change
  volumeMultiple: number;
  isSuspicious: boolean;
}

// ============================================
// CACHE TYPES
// ============================================

export interface CandleCache {
  symbol: string;
  timeframe: Timeframe;
  candles: BaseCandle[];
  lastUpdate: number;
  source: DataSource;
  integrityValid: boolean;
}

export interface M1CandleStore {
  [symbol: string]: {
    candles: BaseCandle[];
    lastTimestamp: number;
    lastUpdate: number;
  };
}

// ============================================
// DECIMAL PRECISION BY SYMBOL
// ============================================

export const PRICE_PRECISION: Record<string, number> = {
  // Crypto - 2 decimals
  'BTCUSDT': 2,
  'ETHUSDT': 2,
  'BNBUSDT': 2,
  'SOLUSDT': 2,
  // Crypto - 4 decimals (low price)
  'XRPUSDT': 4,
  'ADAUSDT': 4,
  'DOGEUSDT': 5,
  // Forex/Commodities
  'XAUUSD': 2,   // Gold: $XXXX.XX
  'XAGUSD': 3,   // Silver: $XX.XXX
  'EURUSD': 5,   // Forex: 1.XXXXX
  'GBPUSD': 5,
  'USDJPY': 3,   // JPY pairs: XXX.XXX
};

export const CONTRACT_SIZE: Record<string, number> = {
  'BTCUSDT': 1,
  'ETHUSDT': 1,
  'XAUUSD': 100,    // 1 lot = 100 oz
  'XAGUSD': 5000,   // 1 lot = 5000 oz
  'EURUSD': 100000, // Standard forex lot
  'GBPUSD': 100000,
  'USDJPY': 100000,
};

// ============================================
// MULTI-TIMEFRAME ANALYSIS TYPES
// ============================================

export type TrendDirection = 'bullish' | 'bearish' | 'neutral' | 'sideways';

export interface TimeframeTrend {
  timeframe: Timeframe;
  direction: TrendDirection;
  strength: number;       // 0-100
  emaPosition: 'above' | 'below' | 'neutral';
  lastClose: number;
  lastHigh: number;
  lastLow: number;
}

export interface TradingBias {
  direction: TrendDirection;
  strength: number;           // 0-100
  confidence: number;         // 0-100
  reasoning: string;
}

export interface MultiTimeframeAnalysis {
  symbol: string;
  trends: Record<string, TimeframeTrend>;
  bias: TradingBias;
  alignmentScore: number;     // 0-100
  keyLevels: {
    price: number;
    type: 'support' | 'resistance';
    timeframe: Timeframe;
  }[];
  analysisTime: number;
}

// ============================================
// TRADING SIGNALS (Deprecated - use TradingBias instead)
// ============================================

// Legacy TradingBias type moved above into MultiTimeframeAnalysis section
