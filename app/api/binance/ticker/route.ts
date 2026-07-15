import { NextRequest, NextResponse } from 'next/server';

// Check if symbol is forex/commodity
function isForexSymbol(symbol: string): boolean {
  return ['XAUUSD', 'XAGUSD', 'EURUSD', 'GBPUSD', 'USDJPY'].includes(symbol);
}

// CryptoCompare ticker
async function fetchFromCryptoCompare(symbol: string) {
  // Skip forex symbols - CryptoCompare only handles crypto
  if (isForexSymbol(symbol)) {
    throw new Error('Forex symbol - use forex API');
  }
  
  const symbolMap: Record<string, { fsym: string; tsym: string }> = {
    'BTCUSDT': { fsym: 'BTC', tsym: 'USDT' },
    'ETHUSDT': { fsym: 'ETH', tsym: 'USDT' },
    'BNBUSDT': { fsym: 'BNB', tsym: 'USDT' },
    'SOLUSDT': { fsym: 'SOL', tsym: 'USDT' },
    'XRPUSDT': { fsym: 'XRP', tsym: 'USDT' },
    'ADAUSDT': { fsym: 'ADA', tsym: 'USDT' },
    'DOGEUSDT': { fsym: 'DOGE', tsym: 'USDT' },
  };
  
  const { fsym, tsym } = symbolMap[symbol] || { fsym: 'BTC', tsym: 'USDT' };
  
  const response = await fetch(
    `https://min-api.cryptocompare.com/data/pricemultifull?fsyms=${fsym}&tsyms=${tsym}`,
    { cache: 'no-store' }
  );
  
  if (!response.ok) throw new Error(`CryptoCompare: ${response.status}`);
  
  const data = await response.json();
  const ticker = data.RAW?.[fsym]?.[tsym];
  
  if (!ticker) throw new Error('No CryptoCompare data');
  
  return {
    symbol: symbol,
    lastPrice: ticker.PRICE.toString(),
    priceChange: ticker.CHANGE24HOUR.toString(),
    priceChangePercent: ticker.CHANGEPCT24HOUR.toString(),
    highPrice: ticker.HIGH24HOUR.toString(),
    lowPrice: ticker.LOW24HOUR.toString(),
    volume: ticker.VOLUME24HOUR.toString(),
    quoteVolume: ticker.VOLUME24HOURTO.toString(),
  };
}

// CoinGecko ticker
async function fetchFromCoinGecko(symbol: string) {
  // Skip forex symbols - CoinGecko only handles crypto
  if (isForexSymbol(symbol)) {
    throw new Error('Forex symbol - use forex API');
  }
  
  const coinMap: Record<string, string> = {
    'BTCUSDT': 'bitcoin',
    'ETHUSDT': 'ethereum', 
    'BNBUSDT': 'binancecoin',
    'SOLUSDT': 'solana',
    'XRPUSDT': 'ripple',
    'ADAUSDT': 'cardano',
    'DOGEUSDT': 'dogecoin',
  };
  const coinId = coinMap[symbol] || 'bitcoin';
  
  const response = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_24hr_high=true&include_24hr_low=true`,
    { cache: 'no-store' }
  );
  
  if (!response.ok) throw new Error(`CoinGecko: ${response.status}`);
  
  const data = await response.json();
  const coin = data[coinId];
  
  if (!coin) throw new Error('No CoinGecko data');
  
  const price = coin.usd;
  const change24h = coin.usd_24h_change || 0;
  
  return {
    symbol: symbol,
    lastPrice: price.toString(),
    priceChange: ((price * change24h) / 100).toString(),
    priceChangePercent: change24h.toString(),
    highPrice: (coin.usd_24h_high || price * 1.02).toString(),
    lowPrice: (coin.usd_24h_low || price * 0.98).toString(),
    volume: coin.usd_24h_vol?.toString() || '0',
    quoteVolume: coin.usd_24h_vol?.toString() || '0',
  };
}

// Cache for storing gold price from real API
interface GoldTickerCache {
  price: number;
  high24h: number;
  low24h: number;
  openPrice: number;
  timestamp: number;
  source: string;
}

let goldTickerCache: GoldTickerCache = {
  price: 0,
  high24h: 0,
  low24h: 0,
  openPrice: 0,
  timestamp: 0,
  source: 'none'
};

const GOLD_TICKER_CACHE_DURATION = 10000; // 10 seconds cache

// Fetch REAL gold price from GoldPrice.org API
async function fetchRealGoldTickerPrice(): Promise<GoldTickerCache> {
  const now = Date.now();
  
  // Return cached if still valid
  if (goldTickerCache.price > 0 && now - goldTickerCache.timestamp < GOLD_TICKER_CACHE_DURATION) {
    return goldTickerCache;
  }
  
  // Try GoldPrice.org (most reliable, FREE)
  try {
    const response = await fetch('https://data-asg.goldprice.org/dbXRates/USD', {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000)
    });
    
    if (response.ok) {
      const data = await response.json();
      const item = data.items?.[0];
      if (item?.xauPrice) {
        goldTickerCache = {
          price: item.xauPrice,
          high24h: item.xauPrice * 1.005, // Approximate high
          low24h: item.xauPrice * 0.995,  // Approximate low
          openPrice: item.xauPrice * (1 - (item.pcXau || 0) / 100),
          timestamp: now,
          source: 'GoldPrice.org'
        };
        console.log(`✓ Gold ticker from GoldPrice.org: $${item.xauPrice.toFixed(2)}`);
        return goldTickerCache;
      }
    }
  } catch (err) {
    console.log('GoldPrice.org ticker failed:', (err as Error).message);
  }
  
  // Fallback to simulation if API fails (but use realistic Feb 2026 prices)
  if (goldTickerCache.price === 0) {
    const basePrice = 4669; // Current gold price Feb 2026
    goldTickerCache = {
      price: basePrice,
      high24h: basePrice * 1.005,
      low24h: basePrice * 0.995,
      openPrice: basePrice * 0.998,
      timestamp: now,
      source: 'fallback'
    };
  }
  
  return goldTickerCache;
}

// Generate gold ticker with REAL price from API
async function generateGoldTicker(): Promise<{
  symbol: string;
  lastPrice: string;
  priceChange: string;
  priceChangePercent: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
}> {
  const data = await fetchRealGoldTickerPrice();
  const price = data.price;
  const change = price - data.openPrice;
  const changePercent = data.openPrice > 0 ? (change / data.openPrice) * 100 : 0;
  
  return {
    symbol: 'XAUUSD',
    lastPrice: price.toFixed(2),
    priceChange: change.toFixed(2),
    priceChangePercent: changePercent.toFixed(2),
    highPrice: data.high24h.toFixed(2),
    lowPrice: data.low24h.toFixed(2),
    volume: (Math.random() * 50000 + 10000).toFixed(0),
    quoteVolume: (Math.random() * 100000000).toFixed(0),
  };
}

// Generate mock ticker with real-time price if possible
async function generateMockTicker(symbol: string) {
  // Try to get real price from CryptoCompare first
  const symbolMap: Record<string, string> = {
    'BTCUSDT': 'BTC',
    'ETHUSDT': 'ETH',
    'BNBUSDT': 'BNB',
    'SOLUSDT': 'SOL',
    'XRPUSDT': 'XRP',
    'ADAUSDT': 'ADA',
    'DOGEUSDT': 'DOGE',
  };
  
  const fsym = symbolMap[symbol];
  let price = 0;
  
  if (fsym) {
    try {
      const priceRes = await fetch(`https://min-api.cryptocompare.com/data/pricemultifull?fsyms=${fsym}&tsyms=USDT`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(3000)
      });
      if (priceRes.ok) {
        const priceData = await priceRes.json();
        const raw = priceData.RAW?.[fsym]?.USDT;
        if (raw) {
          console.log(`✓ Got real-time ticker for ${symbol}: $${raw.PRICE}`);
          return {
            symbol,
            lastPrice: raw.PRICE.toString(),
            priceChange: raw.CHANGE24HOUR.toString(),
            priceChangePercent: raw.CHANGEPCT24HOUR.toString(),
            highPrice: raw.HIGH24HOUR.toString(),
            lowPrice: raw.LOW24HOUR.toString(),
            volume: raw.VOLUME24HOUR.toString(),
            quoteVolume: raw.VOLUME24HOURTO.toString(),
          };
        }
      }
    } catch {
      // Use fallback
    }
  }
  
  // Fallback: realistic base prices (Feb 2026)
  const basePrices: Record<string, number> = {
    'XAUUSD': 4669,    // Gold Feb 2026
    'XAGUSD': 55.00,   // Silver Feb 2026
    'BTCUSDT': 79000,  // BTC Feb 2026
    'ETHUSDT': 3200,
    'BNBUSDT': 580,
    'SOLUSDT': 145,
    'XRPUSDT': 1.80,
    'ADAUSDT': 0.75,
    'DOGEUSDT': 0.28,
  };
  
  price = basePrices[symbol] || 100;
  const change = (Math.random() - 0.5) * 4; // -2% to +2%
  const changeValue = (price * change) / 100;
  
  return {
    symbol,
    lastPrice: price.toFixed(2),
    priceChange: changeValue.toFixed(2),
    priceChangePercent: change.toFixed(2),
    highPrice: (price * 1.015).toFixed(2),
    lowPrice: (price * 0.985).toFixed(2),
    volume: (Math.random() * 50000).toFixed(2),
    quoteVolume: (Math.random() * 5000000000).toFixed(2),
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol') || 'BTCUSDT';

  // Use realtime gold ticker for XAUUSD - fetch from real API
  if (isForexSymbol(symbol) && symbol.toUpperCase() === 'XAUUSD') {
    const goldTicker = await generateGoldTicker();
    console.log(`✓ Gold ticker (${goldTickerCache.source}): $${goldTicker.lastPrice}`);
    return NextResponse.json(goldTicker, {
      headers: {
        'X-Data-Source': goldTickerCache.source,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  }

  const sources = [
    { name: 'CryptoCompare', fn: () => fetchFromCryptoCompare(symbol) },
    { name: 'CoinGecko', fn: () => fetchFromCoinGecko(symbol) },
  ];

  for (const source of sources) {
    try {
      console.log(`Ticker: Trying ${source.name}...`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const data = await source.fn();
      clearTimeout(timeoutId);
      
      console.log(`✓ Ticker from ${source.name}`);
      return NextResponse.json(data, {
        headers: {
          'X-Data-Source': source.name,
          'Cache-Control': 'public, s-maxage=5, stale-while-revalidate=10',
        },
      });
    } catch (err) {
      console.log(`Ticker ${source.name} failed:`, (err as Error).message);
    }
  }

  // Last resort: try to get real price via mock ticker
  console.log('All ticker APIs failed, trying fallback for', symbol);
  const mockData = await generateMockTicker(symbol);
  return NextResponse.json(mockData, {
    headers: {
      'X-Data-Source': 'fallback',
      'Cache-Control': 'public, s-maxage=5',
    },
  });
}
