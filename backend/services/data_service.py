"""
Data Service
============
Centralized data fetching and processing.
Handles market data from various sources.
"""

import asyncio
import aiohttp
from typing import Dict, Any, List, Optional
from datetime import datetime

from backend.core import logger, get_settings


class DataService:
    """
    Data Fetching Service
    
    Features:
    - Multi-source data fetching (Binance, Twelve Data, Alpha Vantage)
    - Automatic fallback between sources
    - Data caching and normalization
    """
    
    BINANCE_API = "https://api.binance.com/api/v3"
    TWELVE_DATA_API = "https://api.twelvedata.com"
    ALPHA_VANTAGE_API = "https://www.alphavantage.co/query"
    
    def __init__(self):
        """Initialize Data Service."""
        self.settings = get_settings()
        self._cache: Dict[str, Dict[str, Any]] = {}
        self._cache_ttl = 5  # seconds
        
        logger.info("DataService initialized")
    
    async def fetch_candles(
        self,
        symbol: str,
        interval: str,
        limit: int = 100
    ) -> List[Dict[str, float]]:
        """
        Fetch OHLCV candles from best available source.
        
        Args:
            symbol: Trading symbol (e.g., 'BTCUSDT', 'XAUUSD')
            interval: Timeframe ('1m', '5m', '15m', '1h', '4h', '1d')
            limit: Number of candles to fetch
            
        Returns:
            List of OHLCV candles
        """
        symbol_upper = symbol.upper()
        
        # Check cache
        cache_key = f"{symbol_upper}:{interval}"
        cached = self._get_cached(cache_key)
        if cached:
            return cached
        
        candles = None
        
        # Try Binance first for crypto
        if self._is_crypto(symbol_upper):
            candles = await self._fetch_binance(symbol_upper, interval, limit)
        
        # Try Twelve Data for forex/metals
        if not candles and self.settings.twelve_data_api_key != 'demo':
            candles = await self._fetch_twelve_data(symbol_upper, interval, limit)
        
        # Try Alpha Vantage as fallback
        if not candles and self.settings.alpha_vantage_api_key != 'demo':
            candles = await self._fetch_alpha_vantage(symbol_upper, interval, limit)
        
        if candles:
            self._set_cache(cache_key, candles)
            return candles
        
        logger.warning(f"Failed to fetch candles for {symbol_upper}")
        return []
    
    async def fetch_ticker(self, symbol: str) -> Optional[Dict[str, float]]:
        """Fetch current ticker/price for a symbol."""
        
        symbol_upper = symbol.upper()
        
        if self._is_crypto(symbol_upper):
            return await self._fetch_binance_ticker(symbol_upper)
        else:
            # For forex, get latest candle
            candles = await self.fetch_candles(symbol_upper, '1m', 1)
            if candles:
                return {
                    'symbol': symbol_upper,
                    'price': candles[-1]['close'],
                    'high': candles[-1]['high'],
                    'low': candles[-1]['low'],
                    'timestamp': candles[-1].get('time', datetime.utcnow().timestamp())
                }
        
        return None
    
    async def _fetch_binance(
        self,
        symbol: str,
        interval: str,
        limit: int
    ) -> Optional[List[Dict[str, float]]]:
        """Fetch from Binance API."""
        
        try:
            url = f"{self.BINANCE_API}/klines"
            params = {
                'symbol': symbol,
                'interval': interval,
                'limit': limit
            }
            
            async with aiohttp.ClientSession() as session:
                async with session.get(url, params=params, timeout=10) as resp:
                    if resp.status != 200:
                        return None
                    
                    data = await resp.json()
                    
                    candles = []
                    for kline in data:
                        candles.append({
                            'time': kline[0] / 1000,  # ms to seconds
                            'open': float(kline[1]),
                            'high': float(kline[2]),
                            'low': float(kline[3]),
                            'close': float(kline[4]),
                            'volume': float(kline[5])
                        })
                    
                    logger.info(f"Binance: {len(candles)} candles for {symbol}")
                    return candles
                    
        except Exception as e:
            logger.error(f"Binance fetch error: {e}")
            return None
    
    async def _fetch_binance_ticker(self, symbol: str) -> Optional[Dict[str, float]]:
        """Fetch current ticker from Binance."""
        
        try:
            url = f"{self.BINANCE_API}/ticker/24hr"
            params = {'symbol': symbol}
            
            async with aiohttp.ClientSession() as session:
                async with session.get(url, params=params, timeout=5) as resp:
                    if resp.status != 200:
                        return None
                    
                    data = await resp.json()
                    
                    return {
                        'symbol': symbol,
                        'price': float(data['lastPrice']),
                        'high': float(data['highPrice']),
                        'low': float(data['lowPrice']),
                        'volume': float(data['volume']),
                        'change_percent': float(data['priceChangePercent'])
                    }
                    
        except Exception as e:
            logger.error(f"Binance ticker error: {e}")
            return None
    
    async def _fetch_twelve_data(
        self,
        symbol: str,
        interval: str,
        limit: int
    ) -> Optional[List[Dict[str, float]]]:
        """Fetch from Twelve Data API."""
        
        try:
            # Convert interval format
            interval_map = {
                '1m': '1min', '5m': '5min', '15m': '15min',
                '30m': '30min', '1h': '1h', '4h': '4h', '1d': '1day'
            }
            td_interval = interval_map.get(interval, interval)
            
            # Convert symbol format
            td_symbol = symbol.replace('USD', '/USD') if 'USD' in symbol else symbol
            
            url = f"{self.TWELVE_DATA_API}/time_series"
            params = {
                'symbol': td_symbol,
                'interval': td_interval,
                'outputsize': limit,
                'apikey': self.settings.twelve_data_api_key
            }
            
            async with aiohttp.ClientSession() as session:
                async with session.get(url, params=params, timeout=10) as resp:
                    if resp.status != 200:
                        return None
                    
                    data = await resp.json()
                    
                    if 'values' not in data:
                        return None
                    
                    candles = []
                    for value in reversed(data['values']):
                        candles.append({
                            'time': datetime.fromisoformat(value['datetime']).timestamp(),
                            'open': float(value['open']),
                            'high': float(value['high']),
                            'low': float(value['low']),
                            'close': float(value['close']),
                            'volume': float(value.get('volume', 0))
                        })
                    
                    logger.info(f"TwelveData: {len(candles)} candles for {symbol}")
                    return candles
                    
        except Exception as e:
            logger.error(f"Twelve Data fetch error: {e}")
            return None
    
    async def _fetch_alpha_vantage(
        self,
        symbol: str,
        interval: str,
        limit: int
    ) -> Optional[List[Dict[str, float]]]:
        """Fetch from Alpha Vantage API."""
        
        try:
            # Convert interval
            interval_map = {
                '1m': '1min', '5m': '5min', '15m': '15min',
                '30m': '30min', '1h': '60min'
            }
            av_interval = interval_map.get(interval, '15min')
            
            params = {
                'function': 'FX_INTRADAY',
                'from_symbol': symbol[:3],
                'to_symbol': symbol[3:] if len(symbol) == 6 else 'USD',
                'interval': av_interval,
                'apikey': self.settings.alpha_vantage_api_key
            }
            
            async with aiohttp.ClientSession() as session:
                async with session.get(self.ALPHA_VANTAGE_API, params=params, timeout=15) as resp:
                    if resp.status != 200:
                        return None
                    
                    data = await resp.json()
                    
                    # Find time series key
                    ts_key = next((k for k in data.keys() if 'Time Series' in k), None)
                    if not ts_key:
                        return None
                    
                    candles = []
                    for dt_str, values in list(data[ts_key].items())[:limit]:
                        dt = datetime.strptime(dt_str, '%Y-%m-%d %H:%M:%S')
                        candles.append({
                            'time': dt.timestamp(),
                            'open': float(values['1. open']),
                            'high': float(values['2. high']),
                            'low': float(values['3. low']),
                            'close': float(values['4. close']),
                            'volume': 0
                        })
                    
                    candles.reverse()
                    logger.info(f"AlphaVantage: {len(candles)} candles for {symbol}")
                    return candles
                    
        except Exception as e:
            logger.error(f"Alpha Vantage fetch error: {e}")
            return None
    
    def _is_crypto(self, symbol: str) -> bool:
        """Check if symbol is cryptocurrency."""
        crypto_pairs = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'SOLUSDT']
        return symbol in crypto_pairs or symbol.endswith('USDT')
    
    def _get_cached(self, key: str) -> Optional[List[Dict[str, float]]]:
        """Get cached data if still valid."""
        if key not in self._cache:
            return None
        
        cached = self._cache[key]
        if datetime.utcnow().timestamp() - cached['timestamp'] < self._cache_ttl:
            return cached['data']
        
        return None
    
    def _set_cache(self, key: str, data: List[Dict[str, float]]):
        """Cache data with timestamp."""
        self._cache[key] = {
            'data': data,
            'timestamp': datetime.utcnow().timestamp()
        }
