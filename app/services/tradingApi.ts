/**
 * Trading API Service
 * ===================
 * Centralized API client for all trading operations
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
// Note: Using 'any' for API responses as data structure comes from Python backend

const API_BASE = '/api';
const APP_API_KEY = process.env.NEXT_PUBLIC_APP_API_KEY;

// Types
export interface ApiResponse<T> {
  data?: T;
  error?: string;
  source?: 'backend' | 'local';
}

export interface BotConfig {
  symbol: string;
  timeframe: string;
  dry_run: boolean;
  equity: number;
  risk_percent: number;
  leverage: number;
  api_key?: string;
  api_secret?: string;
}

export interface BotStatus {
  state: 'IDLE' | 'RUNNING' | 'PAUSED' | 'STOPPED' | 'ERROR' | 'OFFLINE';
  symbol?: string;
  timeframe?: string;
  dry_run?: boolean;
  equity?: number;
  running_since?: string;
  last_signal?: any;
  error?: string;
}

export interface Position {
  id: string;
  symbol: string;
  type: 'BUY' | 'SELL';
  entry_price: number;
  current_price: number;
  sl: number;
  tp: number;
  lot_size: number;
  pnl: number;
  pnl_percent: number;
  opened_at: string;
}

export interface TradeRecord {
  id: string;
  symbol: string;
  type: 'BUY' | 'SELL';
  entry_price: number;
  exit_price: number;
  sl: number;
  tp: number;
  lot_size: number;
  pnl: number;
  pnl_percent: number;
  opened_at: string;
  closed_at: string;
  result: 'WIN' | 'LOSS' | 'BREAKEVEN';
}

export interface BotLog {
  timestamp: string;
  level: 'INFO' | 'WARNING' | 'ERROR' | 'DEBUG' | 'SIGNAL';
  message: string;
  data?: any;
}

// Helper function
async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<ApiResponse<T>> {
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(APP_API_KEY ? { 'x-app-api-key': APP_API_KEY } : {}),
        ...options?.headers,
      },
    });

    const data = await response.json();
    
    if (!response.ok) {
      return { error: data.error || 'Request failed' };
    }

    return { data, source: data.source };
  } catch (error) {
    console.error(`API Error [${endpoint}]:`, error);
    return { error: (error as Error).message };
  }
}

// =======================
// Bot API
// =======================

export const BotApi = {
  async start(config: BotConfig): Promise<ApiResponse<{ message: string }>> {
    return fetchApi('/bot/start', {
      method: 'POST',
      body: JSON.stringify(config),
    });
  },

  async stop(): Promise<ApiResponse<{ message: string }>> {
    return fetchApi('/bot/stop', { method: 'POST' });
  },

  async getStatus(): Promise<ApiResponse<BotStatus>> {
    return fetchApi('/bot/status');
  },

  async getLogs(limit = 100): Promise<ApiResponse<{ logs: BotLog[] }>> {
    return fetchApi(`/bot/logs?limit=${limit}`);
  },

  async getPositions(): Promise<ApiResponse<{ positions: Position[] }>> {
    return fetchApi('/bot/positions');
  },

  async getHistory(limit = 50): Promise<ApiResponse<{ history: TradeRecord[] }>> {
    return fetchApi(`/bot/history?limit=${limit}`);
  },

  async updateConfig(config: Partial<BotConfig>): Promise<ApiResponse<any>> {
    return fetchApi('/bot/config', {
      method: 'PATCH',
      body: JSON.stringify(config),
    });
  },
};

// =======================
// Analysis API
// =======================

export const AnalysisApi = {
  async getSignal(symbol: string, candles: any[]): Promise<ApiResponse<{ signal: any }>> {
    return fetchApi('/analysis/signal', {
      method: 'POST',
      body: JSON.stringify({ symbol, candles }),
    });
  },

  async getStructure(symbol: string, candles: any[]): Promise<ApiResponse<{ structure: any }>> {
    return fetchApi('/analysis/structure', {
      method: 'POST',
      body: JSON.stringify({ symbol, candles }),
    });
  },

  async getZones(symbol: string, candles: any[], currentPrice?: number): Promise<ApiResponse<any>> {
    return fetchApi('/analysis/zones', {
      method: 'POST',
      body: JSON.stringify({ symbol, candles, currentPrice }),
    });
  },

  async getPatterns(symbol: string, candles: any[], lookback = 50): Promise<ApiResponse<any>> {
    return fetchApi('/analysis/patterns', {
      method: 'POST',
      body: JSON.stringify({ symbol, candles, lookback }),
    });
  },
};

// =======================
// Market Data API
// =======================

export const MarketApi = {
  async getKlines(symbol: string, interval: string, limit = 500): Promise<ApiResponse<any[]>> {
    try {
      const response = await fetch(
        `/api/binance/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
      );
      const data = await response.json();
      return { data };
    } catch (error) {
      return { error: (error as Error).message };
    }
  },

  async getTicker(symbol: string): Promise<ApiResponse<any>> {
    try {
      const response = await fetch(`/api/binance/ticker?symbol=${symbol}`);
      const data = await response.json();
      return { data };
    } catch (error) {
      return { error: (error as Error).message };
    }
  },
};

// Default export
const TradingApi = {
  Bot: BotApi,
  Analysis: AnalysisApi,
  Market: MarketApi,
};

export default TradingApi;
