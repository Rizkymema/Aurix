/**
 * DATA VERIFICATION API
 * 
 * Compares our chart data against multiple external sources
 * to ensure accuracy. Use this to validate XAUUSD and BTCUSDT prices.
 * 
 * GET /api/data/verify?symbol=XAUUSD
 * GET /api/data/verify?symbol=BTCUSDT
 */

import { NextRequest, NextResponse } from 'next/server';

interface PriceSource {
  name: string;
  price: number | null;
  timestamp: number;
  error?: string;
}

interface VerificationResult {
  symbol: string;
  timestamp: number;
  sources: PriceSource[];
  consensus: {
    price: number | null;
    minPrice: number;
    maxPrice: number;
    spread: number;
    spreadPercent: number;
  };
  recommendation: string;
  isAligned: boolean;
}

// Fetch from GoldPrice.org
async function fetchGoldPrice(): Promise<PriceSource> {
  try {
    const response = await fetch('https://data-asg.goldprice.org/dbXRates/USD', {
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
    const data = await response.json();
    const price = data.items?.[0]?.xauPrice;
    
    if (price && typeof price === 'number') {
      return { name: 'GoldPrice.org', price, timestamp: Date.now() };
    }
    return { name: 'GoldPrice.org', price: null, timestamp: Date.now(), error: 'Invalid response' };
  } catch (err) {
    return { name: 'GoldPrice.org', price: null, timestamp: Date.now(), error: (err as Error).message };
  }
}

// Fetch from Yahoo Finance
async function fetchYahooGold(): Promise<PriceSource> {
  try {
    const response = await fetch(
      'https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1m&range=1d',
      {
        signal: AbortSignal.timeout(5000),
        cache: 'no-store',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      }
    );
    const data = await response.json();
    const price = data.chart?.result?.[0]?.meta?.regularMarketPrice;
    
    if (price && typeof price === 'number') {
      return { name: 'Yahoo Finance (GC=F)', price, timestamp: Date.now() };
    }
    return { name: 'Yahoo Finance (GC=F)', price: null, timestamp: Date.now(), error: 'Invalid response' };
  } catch (err) {
    return { name: 'Yahoo Finance (GC=F)', price: null, timestamp: Date.now(), error: (err as Error).message };
  }
}

// Fetch from Metals.live
async function fetchMetalsLive(): Promise<PriceSource> {
  try {
    const response = await fetch('https://api.metals.live/v1/spot/gold', {
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
    const data = await response.json();
    const price = Array.isArray(data) && data[0]?.price;
    
    if (price && typeof price === 'number') {
      return { name: 'Metals.live', price, timestamp: Date.now() };
    }
    return { name: 'Metals.live', price: null, timestamp: Date.now(), error: 'Invalid response' };
  } catch (err) {
    return { name: 'Metals.live', price: null, timestamp: Date.now(), error: (err as Error).message };
  }
}

// Fetch BTC from Binance
async function fetchBinanceBTC(): Promise<PriceSource> {
  try {
    const response = await fetch(
      'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT',
      {
        signal: AbortSignal.timeout(5000),
        cache: 'no-store',
      }
    );
    const data = await response.json();
    const price = data.price ? parseFloat(data.price) : null;
    
    if (price && typeof price === 'number') {
      return { name: 'Binance', price, timestamp: Date.now() };
    }
    return { name: 'Binance', price: null, timestamp: Date.now(), error: 'Invalid response' };
  } catch (err) {
    return { name: 'Binance', price: null, timestamp: Date.now(), error: (err as Error).message };
  }
}

// Fetch BTC from CoinGecko
async function fetchCoinGeckoBTC(): Promise<PriceSource> {
  try {
    const response = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
      {
        signal: AbortSignal.timeout(5000),
        cache: 'no-store',
      }
    );
    const data = await response.json();
    const price = data.bitcoin?.usd;
    
    if (price && typeof price === 'number') {
      return { name: 'CoinGecko', price, timestamp: Date.now() };
    }
    return { name: 'CoinGecko', price: null, timestamp: Date.now(), error: 'Invalid response' };
  } catch (err) {
    return { name: 'CoinGecko', price: null, timestamp: Date.now(), error: (err as Error).message };
  }
}

// Fetch BTC from CryptoCompare
async function fetchCryptoCompareBTC(): Promise<PriceSource> {
  try {
    const response = await fetch(
      'https://min-api.cryptocompare.com/data/price?fsym=BTC&tsyms=USD',
      {
        signal: AbortSignal.timeout(5000),
        cache: 'no-store',
      }
    );
    const data = await response.json();
    const price = data.USD;
    
    if (price && typeof price === 'number') {
      return { name: 'CryptoCompare', price, timestamp: Date.now() };
    }
    return { name: 'CryptoCompare', price: null, timestamp: Date.now(), error: 'Invalid response' };
  } catch (err) {
    return { name: 'CryptoCompare', price: null, timestamp: Date.now(), error: (err as Error).message };
  }
}

// Fetch our internal data
async function fetchInternalPrice(symbol: string, baseUrl: string): Promise<PriceSource> {
  try {
    const response = await fetch(
      `${baseUrl}/api/data?action=price&symbol=${symbol}`,
      {
        signal: AbortSignal.timeout(5000),
        cache: 'no-store',
      }
    );
    const data = await response.json();
    const price = data.price;
    
    if (price && typeof price === 'number') {
      return { name: 'Internal (Our System)', price, timestamp: Date.now() };
    }
    return { name: 'Internal (Our System)', price: null, timestamp: Date.now(), error: 'Invalid response' };
  } catch (err) {
    return { name: 'Internal (Our System)', price: null, timestamp: Date.now(), error: (err as Error).message };
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const symbol = (searchParams.get('symbol') || 'XAUUSD').toUpperCase();
  
  // Get base URL for internal API calls
  const baseUrl = request.nextUrl.origin;
  
  let sources: PriceSource[] = [];
  
  // Fetch from multiple sources based on symbol
  if (symbol === 'XAUUSD') {
    sources = await Promise.all([
      fetchGoldPrice(),
      fetchYahooGold(),
      fetchMetalsLive(),
      fetchInternalPrice(symbol, baseUrl),
    ]);
  } else if (symbol === 'BTCUSDT' || symbol === 'BTC') {
    sources = await Promise.all([
      fetchBinanceBTC(),
      fetchCoinGeckoBTC(),
      fetchCryptoCompareBTC(),
      fetchInternalPrice('BTCUSDT', baseUrl),
    ]);
  } else {
    return NextResponse.json(
      { error: 'Unsupported symbol. Use XAUUSD or BTCUSDT.' },
      { status: 400 }
    );
  }
  
  // Calculate consensus
  const validPrices = sources.filter(s => s.price !== null).map(s => s.price as number);
  
  let consensus: VerificationResult['consensus'];
  
  if (validPrices.length >= 2) {
    const minPrice = Math.min(...validPrices);
    const maxPrice = Math.max(...validPrices);
    const avgPrice = validPrices.reduce((a, b) => a + b, 0) / validPrices.length;
    const spread = maxPrice - minPrice;
    const spreadPercent = (spread / avgPrice) * 100;
    
    consensus = {
      price: parseFloat(avgPrice.toFixed(2)),
      minPrice,
      maxPrice,
      spread: parseFloat(spread.toFixed(2)),
      spreadPercent: parseFloat(spreadPercent.toFixed(3)),
    };
  } else {
    consensus = {
      price: validPrices[0] || null,
      minPrice: validPrices[0] || 0,
      maxPrice: validPrices[0] || 0,
      spread: 0,
      spreadPercent: 0,
    };
  }
  
  // Determine if our internal price is aligned
  const internalSource = sources.find(s => s.name === 'Internal (Our System)');
  const isAligned = internalSource?.price 
    ? Math.abs((internalSource.price - (consensus.price || 0)) / (consensus.price || 1)) < 0.005 // Within 0.5%
    : false;
  
  // Generate recommendation
  let recommendation: string;
  if (!internalSource?.price) {
    recommendation = '❌ Internal data source not responding. Check API configuration.';
  } else if (consensus.spreadPercent > 1) {
    recommendation = '⚠️ High price spread across sources. Market may be volatile.';
  } else if (!isAligned) {
    recommendation = `⚠️ Internal price ($${internalSource.price}) deviates from consensus ($${consensus.price}). Consider refreshing data.`;
  } else {
    recommendation = `✅ All systems aligned. Internal price matches consensus within 0.5%.`;
  }
  
  const result: VerificationResult = {
    symbol,
    timestamp: Date.now(),
    sources,
    consensus,
    recommendation,
    isAligned,
  };
  
  return NextResponse.json(result, {
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}
