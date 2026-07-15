"""
NewsFilter - High Impact News Detector
=======================================
Filter berita ekonomi high impact untuk menghindari trading saat volatilitas tinggi.

Features:
- Deteksi NFP, CPI, FOMC dalam 30 menit ke depan
- Integrasi dengan Forex Factory / Trading Economics API
- Caching untuk mengurangi API calls
- Timezone handling otomatis
"""

from dataclasses import dataclass
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
import logging
from enum import Enum
import json

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class NewsImpact(Enum):
    """Tingkat dampak berita"""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


@dataclass
class NewsEvent:
    """Data class untuk event berita ekonomi"""
    title: str
    country: str
    impact: NewsImpact
    datetime: datetime
    currency: str
    forecast: Optional[str] = None
    previous: Optional[str] = None
    
    def is_high_impact(self) -> bool:
        """Check apakah berita high impact"""
        return self.impact == NewsImpact.HIGH
    
    def minutes_until(self) -> float:
        """Hitung berapa menit sampai berita keluar"""
        delta = self.datetime - datetime.now()
        return delta.total_seconds() / 60
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'title': self.title,
            'country': self.country,
            'impact': self.impact.value,
            'datetime': self.datetime.isoformat(),
            'currency': self.currency,
            'forecast': self.forecast,
            'previous': self.previous,
            'minutes_until': round(self.minutes_until(), 1)
        }


class NewsFilter:
    """
    News Filter untuk deteksi berita high impact
    
    HIGH IMPACT NEWS yang di-filter:
    - NFP (Non-Farm Payrolls)
    - CPI (Consumer Price Index)
    - FOMC (Federal Reserve Statement)
    - Interest Rate Decisions
    - GDP Reports
    - Unemployment Rate
    """
    
    HIGH_IMPACT_KEYWORDS = [
        'NFP', 'Non-Farm', 'Payrolls',
        'CPI', 'Consumer Price',
        'FOMC', 'Federal Reserve',
        'Interest Rate', 'Rate Decision',
        'GDP', 'Gross Domestic',
        'Unemployment Rate',
        'Central Bank', 'ECB', 'BOE', 'BOJ',
        'Retail Sales',
        'Manufacturing PMI',
        'Services PMI'
    ]
    
    def __init__(
        self,
        api_key: Optional[str] = None,
        buffer_minutes: int = 30,
        use_cache: bool = True,
        cache_duration: int = 3600  # 1 hour
    ):
        """
        Initialize News Filter
        
        Args:
            api_key: API key untuk Trading Economics / Forex Factory
            buffer_minutes: Buffer waktu sebelum berita (default: 30 menit)
            use_cache: Gunakan caching untuk mengurangi API calls
            cache_duration: Durasi cache dalam detik
        """
        self.api_key = api_key
        self.buffer_minutes = buffer_minutes
        self.use_cache = use_cache
        self.cache_duration = cache_duration
        
        self._cache: List[NewsEvent] = []
        self._cache_timestamp: Optional[datetime] = None
        
        logger.info(f"NewsFilter initialized (buffer: {buffer_minutes} min)")
    
    def _is_cache_valid(self) -> bool:
        """Check apakah cache masih valid"""
        if not self.use_cache or not self._cache_timestamp:
            return False
        
        elapsed = (datetime.now() - self._cache_timestamp).total_seconds()
        return elapsed < self.cache_duration
    
    async def fetch_news_events(self) -> List[NewsEvent]:
        """
        Fetch berita ekonomi dari API
        
        Returns:
            List of NewsEvent
        """
        # Check cache first
        if self._is_cache_valid():
            logger.debug("Using cached news data")
            return self._cache
        
        # Simulate API call (replace dengan API asli)
        # Contoh: Trading Economics API atau Forex Factory
        events = await self._fetch_from_api()
        
        # Update cache
        if self.use_cache:
            self._cache = events
            self._cache_timestamp = datetime.now()
            logger.info(f"News cache updated: {len(events)} events")
        
        return events
    
    async def _fetch_from_api(self) -> List[NewsEvent]:
        """
        Fetch dari API eksternal
        
        TODO: Implement real API integration
        - Trading Economics: https://tradingeconomics.com/api/
        - Forex Factory: https://www.forexfactory.com/calendar
        - Investing.com Economic Calendar
        """
        # SIMULASI: Return sample high impact events
        # Dalam production, ganti dengan API call asli
        
        now = datetime.now()
        sample_events = [
            NewsEvent(
                title="US Non-Farm Payrolls (NFP)",
                country="US",
                impact=NewsImpact.HIGH,
                datetime=now + timedelta(minutes=25),
                currency="USD",
                forecast="200K",
                previous="180K"
            ),
            NewsEvent(
                title="US CPI m/m",
                country="US",
                impact=NewsImpact.HIGH,
                datetime=now + timedelta(hours=2),
                currency="USD",
                forecast="0.3%",
                previous="0.2%"
            ),
            NewsEvent(
                title="FOMC Statement",
                country="US",
                impact=NewsImpact.HIGH,
                datetime=now + timedelta(hours=4),
                currency="USD"
            ),
            NewsEvent(
                title="Retail Sales",
                country="US",
                impact=NewsImpact.MEDIUM,
                datetime=now + timedelta(minutes=45),
                currency="USD",
                forecast="0.5%",
                previous="0.4%"
            )
        ]
        
        logger.info(f"✅ Fetched {len(sample_events)} news events (SIMULATED)")
        return sample_events
    
    async def has_high_impact_news(
        self,
        currency: Optional[str] = None
    ) -> bool:
        """
        Check apakah ada high impact news dalam buffer time
        
        Args:
            currency: Filter berdasarkan currency (e.g., 'USD', 'EUR')
            
        Returns:
            True jika ada high impact news dalam buffer time
        """
        events = await self.get_upcoming_high_impact(currency)
        return len(events) > 0
    
    async def get_upcoming_high_impact(
        self,
        currency: Optional[str] = None
    ) -> List[NewsEvent]:
        """
        Get list high impact news dalam buffer time
        
        Args:
            currency: Filter berdasarkan currency
            
        Returns:
            List of upcoming high impact NewsEvent
        """
        all_events = await self.fetch_news_events()
        
        upcoming = []
        for event in all_events:
            if not event.is_high_impact():
                continue
            
            minutes_until = event.minutes_until()
            
            # Check if within buffer (e.g., 0-30 minutes)
            if 0 <= minutes_until <= self.buffer_minutes:
                if currency and event.currency != currency.upper():
                    continue
                upcoming.append(event)
        
        return upcoming
    
    async def should_block_trade(
        self,
        symbol: str,
        buffer_override: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Tentukan apakah trade harus diblokir karena news
        
        Args:
            symbol: Trading pair (e.g., 'EURUSD', 'XAUUSD')
            buffer_override: Override buffer_minutes untuk trade ini
            
        Returns:
            Dict dengan status dan detail
        """
        # Extract currency dari symbol
        currencies = self._extract_currencies(symbol)
        
        # Check for high impact news
        buffer = buffer_override or self.buffer_minutes
        all_events = await self.fetch_news_events()
        
        blocking_events = []
        for event in all_events:
            if not event.is_high_impact():
                continue
            
            minutes_until = event.minutes_until()
            if 0 <= minutes_until <= buffer:
                if event.currency in currencies:
                    blocking_events.append(event)
        
        should_block = len(blocking_events) > 0
        
        return {
            'should_block': should_block,
            'reason': f"{len(blocking_events)} high impact news in {buffer} minutes" if should_block else None,
            'events': [e.to_dict() for e in blocking_events],
            'affected_currencies': list(set(e.currency for e in blocking_events))
        }
    
    def _extract_currencies(self, symbol: str) -> List[str]:
        """
        Extract currencies dari trading pair
        
        Args:
            symbol: e.g., 'EURUSD', 'XAUUSD', 'BTCUSDT'
            
        Returns:
            List of currency codes
        """
        symbol = symbol.upper().replace('/', '')
        
        # Special cases
        if symbol.startswith('XAU'):
            return ['USD']  # Gold mostly affected by USD
        if 'BTC' in symbol or 'ETH' in symbol:
            return ['USD']  # Crypto mostly affected by USD
        
        # Standard forex pairs (6 characters)
        if len(symbol) >= 6:
            return [symbol[:3], symbol[3:6]]
        
        return ['USD']  # Default
    
    async def get_news_summary(self) -> Dict[str, Any]:
        """Get ringkasan berita hari ini"""
        events = await self.fetch_news_events()
        
        high_impact = [e for e in events if e.is_high_impact()]
        upcoming = await self.get_upcoming_high_impact()
        
        return {
            'total_events': len(events),
            'high_impact_count': len(high_impact),
            'upcoming_high_impact': len(upcoming),
            'next_high_impact': upcoming[0].to_dict() if upcoming else None,
            'buffer_minutes': self.buffer_minutes,
            'cache_valid': self._is_cache_valid()
        }


# =======================
# USAGE EXAMPLE
# =======================
if __name__ == "__main__":
    import asyncio
    
    async def main():
        # Initialize news filter
        news_filter = NewsFilter(
            buffer_minutes=30,
            use_cache=True
        )
        
        print("\n📰 News Filter Initialized")
        
        # Get news summary
        summary = await news_filter.get_news_summary()
        print(f"\n📊 News Summary:")
        for key, value in summary.items():
            print(f"  {key}: {value}")
        
        # Check untuk EURUSD trade
        print(f"\n🔍 Checking EURUSD trade safety:")
        result = await news_filter.should_block_trade('EURUSD')
        print(f"  Should block: {result['should_block']}")
        if result['should_block']:
            print(f"  Reason: {result['reason']}")
            print(f"  Affected currencies: {result['affected_currencies']}")
            print(f"  Events:")
            for event in result['events']:
                print(f"    - {event['title']} in {event['minutes_until']} min")
        
        # Check untuk XAUUSD trade
        print(f"\n🔍 Checking XAUUSD trade safety:")
        result = await news_filter.should_block_trade('XAUUSD')
        print(f"  Should block: {result['should_block']}")
        if result['should_block']:
            print(f"  Reason: {result['reason']}")
    
    asyncio.run(main())
