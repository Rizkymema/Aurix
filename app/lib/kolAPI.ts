/**
 * Kol API Integration - Market Sentiment & Analysis
 * 
 * FALLBACK: Uses realistic mock data when API is unavailable
 */

import 'server-only';

const KOL_API_KEY = process.env.KOL_API_KEY || '';
const KOL_API_BASE = 'https://api.kolhub.io/v1';

// API availability flag
let apiAvailable = false;
let lastApiCheck = 0;
const API_CHECK_INTERVAL = 300000;

// Types
export interface MarketSentiment {
  symbol: string;
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number;
  fear_greed_index?: number;
  volume_trend?: string;
  whale_activity?: string;
  social_sentiment?: string;
  timestamp: string;
  reason: string;
  source: 'api' | 'mock';
}

export interface OnChainMetrics {
  symbol: string;
  active_addresses?: number;
  transaction_volume?: number;
  whale_wallets?: number;
  exchange_inflow?: number;
  exchange_outflow?: number;
  timestamp: string;
  source: 'api' | 'mock';
}

export interface TrendAnalysis {
  symbol: string;
  short_term: 'UP' | 'DOWN' | 'SIDEWAYS';
  mid_term: 'UP' | 'DOWN' | 'SIDEWAYS';
  long_term: 'UP' | 'DOWN' | 'SIDEWAYS';
  momentum: number;
  volatility: number;
  timestamp: string;
  source: 'api' | 'mock';
}

// Mock Data Generators
function generateMockSentiment(symbol: string): MarketSentiment {
  const sentiments: ('BULLISH' | 'BEARISH' | 'NEUTRAL')[] = ['BULLISH', 'BEARISH', 'NEUTRAL'];
  const volumeTrends = ['INCREASING', 'DECREASING', 'STABLE'];
  const whaleActivities = ['BUYING', 'SELLING', 'NEUTRAL'];
  const socialSentiments = ['POSITIVE', 'NEGATIVE', 'NEUTRAL'];
  
  const symbolHash = symbol.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
  const hourOfDay = new Date().getHours();
  const dayOfWeek = new Date().getDay();
  
  const sentimentIndex = (symbolHash + hourOfDay + dayOfWeek) % 3;
  const sentiment = sentiments[sentimentIndex];
  
  const baseGreed = 45 + Math.sin(Date.now() / 3600000) * 20;
  const fearGreedIndex = Math.round(Math.max(15, Math.min(85, baseGreed + (Math.random() - 0.5) * 10)));
  const confidence = Math.round(55 + (Math.random() * 30));
  
  const reasons: Record<string, string[]> = {
    'BTCUSDT': ['Strong institutional buying', 'ETF inflows positive', 'Mining difficulty stable'],
    'ETHUSDT': ['DeFi TVL increasing', 'NFT volume rising', 'Gas fees stabilizing'],
    'XAUUSD': ['Safe haven demand', 'USD weakness', 'Geopolitical tensions'],
    'EURUSD': ['ECB policy outlook', 'US-EU rate differential', 'Economic data mixed'],
  };
  
  const symbolReasons = reasons[symbol] || ['Technical analysis favorable', 'Volume patterns healthy'];
  
  return {
    symbol,
    sentiment,
    confidence,
    fear_greed_index: fearGreedIndex,
    volume_trend: volumeTrends[(symbolHash + hourOfDay) % 3],
    whale_activity: whaleActivities[(symbolHash + dayOfWeek) % 3],
    social_sentiment: socialSentiments[sentimentIndex],
    timestamp: new Date().toISOString(),
    reason: symbolReasons[hourOfDay % symbolReasons.length],
    source: 'mock',
  };
}

function generateMockTrend(symbol: string): TrendAnalysis {
  const trends: ('UP' | 'DOWN' | 'SIDEWAYS')[] = ['UP', 'DOWN', 'SIDEWAYS'];
  const hourOfDay = new Date().getHours();
  const symbolHash = symbol.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
  
  const shortIndex = (symbolHash + hourOfDay) % 3;
  const midIndex = (symbolHash + Math.floor(hourOfDay / 4)) % 3;
  const longIndex = (symbolHash + new Date().getDay()) % 3;
  
  let momentum = 0;
  if (trends[shortIndex] === 'UP') momentum += 30;
  if (trends[shortIndex] === 'DOWN') momentum -= 30;
  if (trends[midIndex] === 'UP') momentum += 20;
  if (trends[midIndex] === 'DOWN') momentum -= 20;
  momentum += (Math.random() - 0.5) * 20;
  momentum = Math.round(Math.max(-80, Math.min(80, momentum)));
  
  const baseVolatility: Record<string, number> = {
    'BTCUSDT': 55, 'ETHUSDT': 60, 'XAUUSD': 35, 'EURUSD': 25,
  };
  const volatility = Math.round((baseVolatility[symbol] || 45) + (Math.random() - 0.5) * 20);
  
  return {
    symbol,
    short_term: trends[shortIndex],
    mid_term: trends[midIndex],
    long_term: trends[longIndex],
    momentum,
    volatility: Math.max(10, Math.min(90, volatility)),
    timestamp: new Date().toISOString(),
    source: 'mock',
  };
}

function generateMockOnChainMetrics(symbol: string): OnChainMetrics {
  const isCrypto = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT'].includes(symbol);
  
  if (!isCrypto) {
    return { symbol, timestamp: new Date().toISOString(), source: 'mock' };
  }
  
  const baseMetrics: Record<string, { addresses: number; volume: number; whales: number }> = {
    'BTCUSDT': { addresses: 950000, volume: 15000000000, whales: 2100 },
    'ETHUSDT': { addresses: 750000, volume: 8000000000, whales: 1500 },
    'BNBUSDT': { addresses: 250000, volume: 2000000000, whales: 800 },
    'SOLUSDT': { addresses: 180000, volume: 1500000000, whales: 500 },
  };
  
  const base = baseMetrics[symbol] || { addresses: 100000, volume: 500000000, whales: 200 };
  const variance = 0.1;
  
  const activeAddresses = Math.round(base.addresses * (1 + (Math.random() - 0.5) * variance));
  const transactionVolume = Math.round(base.volume * (1 + (Math.random() - 0.5) * variance));
  const whaleWallets = Math.round(base.whales * (1 + (Math.random() - 0.5) * variance * 0.5));
  
  const netFlow = (Math.random() - 0.5) * transactionVolume * 0.05;
  const exchangeInflow = Math.round(transactionVolume * 0.1 + (netFlow > 0 ? netFlow : 0));
  const exchangeOutflow = Math.round(transactionVolume * 0.1 + (netFlow < 0 ? -netFlow : 0));
  
  return {
    symbol,
    active_addresses: activeAddresses,
    transaction_volume: transactionVolume,
    whale_wallets: whaleWallets,
    exchange_inflow: exchangeInflow,
    exchange_outflow: exchangeOutflow,
    timestamp: new Date().toISOString(),
    source: 'mock',
  };
}

// API Functions with Mock Fallback
export async function getMarketSentiment(symbol: string): Promise<MarketSentiment> {
  const now = Date.now();

  if (!KOL_API_KEY) {
    apiAvailable = false;
    lastApiCheck = now;
    return generateMockSentiment(symbol);
  }
  
  if (!apiAvailable && (now - lastApiCheck) < API_CHECK_INTERVAL) {
    return generateMockSentiment(symbol);
  }
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    
    const response = await fetch(`${KOL_API_BASE}/sentiment/${symbol.toUpperCase()}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${KOL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);

    if (!response.ok) {
      apiAvailable = false;
      lastApiCheck = now;
      return generateMockSentiment(symbol);
    }

    const data = await response.json();
    apiAvailable = true;
    lastApiCheck = now;
    
    return {
      symbol,
      sentiment: data.sentiment || 'NEUTRAL',
      confidence: data.confidence || 50,
      fear_greed_index: data.fear_greed_index,
      volume_trend: data.volume_trend,
      whale_activity: data.whale_activity,
      social_sentiment: data.social_sentiment,
      timestamp: new Date().toISOString(),
      reason: data.reason || 'API Analysis',
      source: 'api',
    };
  } catch {
    apiAvailable = false;
    lastApiCheck = now;
    return generateMockSentiment(symbol);
  }
}

export async function getOnChainMetrics(symbol: string): Promise<OnChainMetrics> {
  const now = Date.now();

  if (!KOL_API_KEY) {
    apiAvailable = false;
    lastApiCheck = now;
    return generateMockOnChainMetrics(symbol);
  }
  
  if (!apiAvailable && (now - lastApiCheck) < API_CHECK_INTERVAL) {
    return generateMockOnChainMetrics(symbol);
  }
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    
    const response = await fetch(`${KOL_API_BASE}/metrics/onchain/${symbol.toUpperCase()}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${KOL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);

    if (!response.ok) {
      return generateMockOnChainMetrics(symbol);
    }

    const data = await response.json();
    apiAvailable = true;

    return {
      symbol,
      active_addresses: data.active_addresses,
      transaction_volume: data.transaction_volume,
      whale_wallets: data.whale_wallets,
      exchange_inflow: data.exchange_inflow,
      exchange_outflow: data.exchange_outflow,
      timestamp: new Date().toISOString(),
      source: 'api',
    };
  } catch {
    apiAvailable = false;
    lastApiCheck = now;
    return generateMockOnChainMetrics(symbol);
  }
}

export async function getTrendAnalysis(symbol: string): Promise<TrendAnalysis> {
  const now = Date.now();

  if (!KOL_API_KEY) {
    apiAvailable = false;
    lastApiCheck = now;
    return generateMockTrend(symbol);
  }
  
  if (!apiAvailable && (now - lastApiCheck) < API_CHECK_INTERVAL) {
    return generateMockTrend(symbol);
  }
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    
    const response = await fetch(`${KOL_API_BASE}/trend/${symbol.toUpperCase()}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${KOL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);

    if (!response.ok) {
      return generateMockTrend(symbol);
    }

    const data = await response.json();
    apiAvailable = true;

    return {
      symbol,
      short_term: data.short_term || 'SIDEWAYS',
      mid_term: data.mid_term || 'SIDEWAYS',
      long_term: data.long_term || 'SIDEWAYS',
      momentum: data.momentum || 0,
      volatility: data.volatility || 50,
      timestamp: new Date().toISOString(),
      source: 'api',
    };
  } catch {
    apiAvailable = false;
    lastApiCheck = now;
    return generateMockTrend(symbol);
  }
}

export async function getMarketAnalysis(symbol: string): Promise<{
  sentiment: MarketSentiment;
  trend: TrendAnalysis;
  metrics: OnChainMetrics;
}> {
  const [sentiment, trend, metrics] = await Promise.all([
    getMarketSentiment(symbol),
    getTrendAnalysis(symbol),
    getOnChainMetrics(symbol),
  ]);

  return { sentiment, trend, metrics };
}

export function adjustSignalConfidence(
  baseConfidence: number,
  signalDirection: 'BUY' | 'SELL',
  sentiment: MarketSentiment | null,
  trend: TrendAnalysis | null
): number {
  let adjustedConfidence = baseConfidence;

  if (!sentiment && !trend) {
    return adjustedConfidence;
  }

  if (sentiment) {
    if (signalDirection === 'BUY' && sentiment.sentiment === 'BULLISH') {
      adjustedConfidence += sentiment.confidence * 0.1;
    } else if (signalDirection === 'SELL' && sentiment.sentiment === 'BEARISH') {
      adjustedConfidence += sentiment.confidence * 0.1;
    } else if (sentiment.sentiment !== 'NEUTRAL') {
      adjustedConfidence -= 10;
    }
  }

  if (trend) {
    if (signalDirection === 'BUY' && trend.short_term === 'UP') {
      adjustedConfidence += 10;
    } else if (signalDirection === 'SELL' && trend.short_term === 'DOWN') {
      adjustedConfidence += 10;
    } else if (trend.short_term === 'SIDEWAYS') {
      adjustedConfidence -= 5;
    } else {
      adjustedConfidence -= 10;
    }
  }

  return Math.max(0, Math.min(100, adjustedConfidence));
}

export function isMarketConditionFavorable(
  sentiment: MarketSentiment | null,
  trend: TrendAnalysis | null
): boolean {
  if (sentiment?.fear_greed_index !== undefined) {
    if (sentiment.fear_greed_index < 20 || sentiment.fear_greed_index > 80) {
      return false;
    }
  }

  if (trend) {
    if (trend.short_term === 'SIDEWAYS' && trend.mid_term === 'SIDEWAYS') {
      return false;
    }
  }

  return true;
}

const kolAPI = {
  getMarketSentiment,
  getOnChainMetrics,
  getTrendAnalysis,
  getMarketAnalysis,
  adjustSignalConfidence,
  isMarketConditionFavorable,
};

export default kolAPI;
