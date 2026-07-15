/**
 * Unified API Client
 * ==================
 * Single source of truth for all API calls.
 * Implements DRY principle with centralized error handling.
 */

import type {
  BotConfig,
  BotStatus,
  Position,
  TradeRecord,
  TradingSignal,
  CandlestickData,
  SupplyDemandZone,
  MarketStructure,
  SentimentData,
  ApiResponse,
} from '../types';

// =====================
// Configuration
// =====================

const API_BASE = '/api';
// Bot API base URL for direct backend calls (used when bypassing Next.js API routes)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const BOT_API_BASE = process.env.NEXT_PUBLIC_BOT_API_URL || 'http://localhost:8000';

// =====================
// Core Fetch Wrapper
// =====================

interface FetchOptions extends RequestInit {
  timeout?: number;
}

async function apiRequest<T>(
  url: string,
  options: FetchOptions = {}
): Promise<ApiResponse<T>> {
  const { timeout = 10000, ...fetchOptions } = options;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...fetchOptions.headers,
      },
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        success: false,
        error: errorData.error || errorData.message || `HTTP ${response.status}`,
      };
    }
    
    const data = await response.json();
    return {
      success: true,
      data,
    };
    
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error instanceof Error && error.name === 'AbortError') {
      return { success: false, error: 'Request timeout' };
    }
    
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// =====================
// Market Data API
// =====================

export const MarketDataAPI = {
  /**
   * Fetch candlestick data
   */
  async getCandles(
    symbol: string,
    interval: string,
    limit: number = 500
  ): Promise<ApiResponse<CandlestickData[]>> {
    const params = new URLSearchParams({
      symbol,
      interval,
      limit: limit.toString(),
    });
    
    return apiRequest<CandlestickData[]>(
      `${API_BASE}/binance/klines?${params}`
    );
  },
  
  /**
   * Fetch current ticker/price
   */
  async getTicker(symbol: string): Promise<ApiResponse<{
    symbol: string;
    price: number;
    change24h: number;
    volume24h: number;
  }>> {
    return apiRequest(`${API_BASE}/binance/ticker?symbol=${symbol}`);
  },
  
  /**
   * Check if market is open
   */
  async getMarketStatus(symbol: string): Promise<ApiResponse<{
    isOpen: boolean;
    nextOpen?: string;
    nextClose?: string;
  }>> {
    return apiRequest(`${API_BASE}/market-status?symbol=${symbol}`);
  },
};

// =====================
// Bot Control API
// =====================

export const BotAPI = {
  /**
   * Start trading bot
   */
  async start(config: BotConfig): Promise<ApiResponse<{ message: string }>> {
    return apiRequest(`${API_BASE}/bot/start`, {
      method: 'POST',
      body: JSON.stringify({
        symbol: config.symbol,
        timeframe: config.timeframe,
        dry_run: config.dryRun,
        equity: config.equity,
        risk_percent: config.riskPercent,
        leverage: config.leverage,
      }),
    });
  },
  
  /**
   * Stop trading bot
   */
  async stop(): Promise<ApiResponse<{ message: string }>> {
    return apiRequest(`${API_BASE}/bot/stop`, { method: 'POST' });
  },
  
  /**
   * Get bot status
   */
  async getStatus(): Promise<ApiResponse<BotStatus>> {
    const result = await apiRequest<{
      state: string;
      symbol?: string;
      timeframe?: string;
      dry_run?: boolean;
      equity?: number;
      running_since?: string;
      error?: string;
    }>(`${API_BASE}/bot/status`);
    
    if (!result.success || !result.data) {
      return result as ApiResponse<BotStatus>;
    }
    
    // Transform snake_case to camelCase
    return {
      success: true,
      data: {
        state: result.data.state as BotStatus['state'],
        symbol: result.data.symbol,
        timeframe: result.data.timeframe,
        dryRun: result.data.dry_run,
        equity: result.data.equity,
        runningSince: result.data.running_since,
        error: result.data.error,
      },
    };
  },
  
  /**
   * Update bot configuration
   */
  async updateConfig(config: Partial<BotConfig>): Promise<ApiResponse<BotStatus>> {
    return apiRequest(`${API_BASE}/bot/config`, {
      method: 'PUT',
      body: JSON.stringify({
        symbol: config.symbol,
        timeframe: config.timeframe,
        dry_run: config.dryRun,
        equity: config.equity,
        risk_percent: config.riskPercent,
        leverage: config.leverage,
      }),
    });
  },
  
  /**
   * Get open positions
   */
  async getPositions(): Promise<ApiResponse<Position[]>> {
    return apiRequest(`${API_BASE}/bot/positions`);
  },
  
  /**
   * Get trade history
   */
  async getHistory(limit: number = 50): Promise<ApiResponse<TradeRecord[]>> {
    return apiRequest(`${API_BASE}/bot/history?limit=${limit}`);
  },
  
  /**
   * Execute a trade
   */
  async execute(signal: {
    symbol: string;
    type: 'BUY' | 'SELL';
    entry: number;
    stopLoss: number;
    takeProfit: number;
    lotSize: number;
  }): Promise<ApiResponse<{ orderId: string; status: string }>> {
    return apiRequest(`${API_BASE}/bot/execute`, {
      method: 'POST',
      body: JSON.stringify({
        symbol: signal.symbol,
        signal_type: signal.type,
        entry_price: signal.entry,
        stop_loss: signal.stopLoss,
        take_profit: signal.takeProfit,
        lot_size: signal.lotSize,
      }),
    });
  },
};

// =====================
// Analysis API
// =====================

export const AnalysisAPI = {
  /**
   * Generate trading signal
   */
  async getSignal(
    symbol: string,
    candles: CandlestickData[],
    currentPrice?: number
  ): Promise<ApiResponse<TradingSignal | null>> {
    return apiRequest(`${API_BASE}/bot/signal`, {
      method: 'POST',
      body: JSON.stringify({
        symbol,
        candles: candles.map(c => ({
          time: c.time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume || 0,
        })),
        current_price: currentPrice,
      }),
    });
  },
  
  /**
   * Get market structure analysis
   */
  async getStructure(
    symbol: string,
    candles: CandlestickData[]
  ): Promise<ApiResponse<MarketStructure>> {
    return apiRequest(`${API_BASE}/analysis/structure`, {
      method: 'POST',
      body: JSON.stringify({ symbol, candles }),
    });
  },
  
  /**
   * Get supply/demand zones
   */
  async getZones(
    symbol: string,
    candles: CandlestickData[],
    currentPrice?: number
  ): Promise<ApiResponse<SupplyDemandZone[]>> {
    return apiRequest(`${API_BASE}/analysis/zones`, {
      method: 'POST',
      body: JSON.stringify({ symbol, candles, currentPrice }),
    });
  },
  
  /**
   * Get candle patterns
   */
  async getPatterns(
    symbol: string,
    candles: CandlestickData[],
    lookback: number = 50
  ): Promise<ApiResponse<{ patterns: Array<{ name: string; index: number; significance: number }> }>> {
    return apiRequest(`${API_BASE}/analysis/patterns`, {
      method: 'POST',
      body: JSON.stringify({ symbol, candles, lookback }),
    });
  },
  
  /**
   * Get market sentiment
   */
  async getSentiment(symbol: string): Promise<ApiResponse<SentimentData>> {
    return apiRequest(`${API_BASE}/analysis/market-sentiment?symbol=${symbol}`);
  },
};

// =====================
// AI Analysis API
// =====================

export const AIAPI = {
  /**
   * Get AI-powered analysis
   */
  async analyze(
    symbol: string,
    candles: CandlestickData[],
    signal?: TradingSignal
  ): Promise<ApiResponse<{
    recommendation: string;
    confidence: number;
    reasoning: string;
  }>> {
    return apiRequest(`${API_BASE}/ai/analyze`, {
      method: 'POST',
      body: JSON.stringify({ symbol, candles, signal }),
    });
  },
};

// =====================
// Unified API Export
// =====================

export const API = {
  market: MarketDataAPI,
  bot: BotAPI,
  analysis: AnalysisAPI,
  ai: AIAPI,
};

export default API;
