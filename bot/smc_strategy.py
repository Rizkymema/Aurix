"""
SMC Strategy Engine - Smart Money Concept & Institutional Order Flow
=====================================================================
Strategi trading berbasis Smart Money Concept yang digunakan oleh institusi besar.

Core Concepts:
- Trend Alignment (EMA 200 H4)
- Point of Interest (POI) - Supply/Demand Zones
- CHOCH (Change of Character) - Trend reversal confirmation
- MSB (Market Structure Break) - Continuation confirmation
- Liquidity Sweeps & Fair Value Gaps

Author: Trading Bot System
Version: 1.0.0
"""

from dataclasses import dataclass, field
from typing import Dict, Any, Optional, List, Tuple
from enum import Enum
from datetime import datetime
import logging
import json

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class TrendDirection(Enum):
    """Arah trend berdasarkan EMA 200"""
    BULLISH = "bullish"
    BEARISH = "bearish"
    NEUTRAL = "neutral"


class ZoneType(Enum):
    """Tipe zona supply/demand"""
    SUPPLY = "supply"
    DEMAND = "demand"


class ZoneStatus(Enum):
    """Status zona"""
    FRESH = "fresh"  # Belum pernah ditest
    TESTED = "tested"  # Sudah ditest 1x
    BROKEN = "broken"  # Sudah tembus


class MarketStructure(Enum):
    """Struktur pasar"""
    HIGHER_HIGH = "HH"
    HIGHER_LOW = "HL"
    LOWER_HIGH = "LH"
    LOWER_LOW = "LL"
    EQUAL_HIGH = "EQH"
    EQUAL_LOW = "EQL"


class ConfirmationType(Enum):
    """Tipe konfirmasi entry"""
    CHOCH = "choch"  # Change of Character (reversal)
    MSB = "msb"  # Market Structure Break (continuation)
    BOS = "bos"  # Break of Structure
    LIQUIDITY_SWEEP = "liquidity_sweep"
    FVG = "fvg"  # Fair Value Gap
    ORDER_BLOCK = "order_block"


@dataclass
class OHLC:
    """Candlestick data"""
    time: int
    open: float
    high: float
    low: float
    close: float
    volume: float = 0.0
    
    @property
    def is_bullish(self) -> bool:
        return self.close > self.open
    
    @property
    def is_bearish(self) -> bool:
        return self.close < self.open
    
    @property
    def body_size(self) -> float:
        return abs(self.close - self.open)
    
    @property
    def range_size(self) -> float:
        return self.high - self.low
    
    @property
    def upper_wick(self) -> float:
        return self.high - max(self.open, self.close)
    
    @property
    def lower_wick(self) -> float:
        return min(self.open, self.close) - self.low


@dataclass
class SupplyDemandZone:
    """Zona Supply atau Demand"""
    zone_type: ZoneType
    status: ZoneStatus
    price_high: float
    price_low: float
    strength: int  # 1-100
    created_at: int  # timestamp
    tested_count: int = 0
    
    @property
    def midpoint(self) -> float:
        return (self.price_high + self.price_low) / 2
    
    @property
    def zone_size(self) -> float:
        return self.price_high - self.price_low
    
    def is_price_in_zone(self, price: float, buffer_percent: float = 0.1) -> bool:
        """Check apakah harga berada di dalam zona"""
        buffer = self.zone_size * buffer_percent
        return (self.price_low - buffer) <= price <= (self.price_high + buffer)
    
    def is_fresh(self) -> bool:
        return self.status == ZoneStatus.FRESH


@dataclass
class SwingPoint:
    """Swing High atau Swing Low"""
    price: float
    time: int
    is_high: bool  # True = Swing High, False = Swing Low
    
    
@dataclass
class SMCSetup:
    """Trading setup hasil analisis SMC"""
    entry: float
    stop_loss: float
    take_profit_1: float
    take_profit_2: float
    position_type: str  # 'BUY' atau 'SELL'
    risk_pips: float
    reward_pips_tp1: float
    reward_pips_tp2: float
    rrr_tp1: float
    rrr_tp2: float
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'entry': round(self.entry, 5),
            'sl': round(self.stop_loss, 5),
            'tp1': round(self.take_profit_1, 5),
            'tp2': round(self.take_profit_2, 5),
            'position_type': self.position_type,
            'risk_pips': round(self.risk_pips, 1),
            'reward_pips_tp1': round(self.reward_pips_tp1, 1),
            'reward_pips_tp2': round(self.reward_pips_tp2, 1),
            'rrr_tp1': round(self.rrr_tp1, 2),
            'rrr_tp2': round(self.rrr_tp2, 2)
        }


@dataclass
class SMCAnalysisResult:
    """Hasil analisis SMC"""
    decision: str  # 'ENTRY' atau 'NO_TRADE'
    confidence_score: int  # 0-100
    logic: str
    setup: Optional[SMCSetup] = None
    trend_h4: Optional[TrendDirection] = None
    poi_zone: Optional[SupplyDemandZone] = None
    confirmation_type: Optional[ConfirmationType] = None
    market_structure: Optional[str] = None
    warnings: List[str] = field(default_factory=list)
    
    def to_dict(self) -> Dict[str, Any]:
        result = {
            'decision': self.decision,
            'confidence_score': self.confidence_score,
            'logic': self.logic,
            'setup': self.setup.to_dict() if self.setup else None,
            'analysis': {
                'trend_h4': self.trend_h4.value if self.trend_h4 else None,
                'poi_zone': {
                    'type': self.poi_zone.zone_type.value,
                    'status': self.poi_zone.status.value,
                    'price_high': self.poi_zone.price_high,
                    'price_low': self.poi_zone.price_low,
                    'strength': self.poi_zone.strength
                } if self.poi_zone else None,
                'confirmation': self.confirmation_type.value if self.confirmation_type else None,
                'market_structure': self.market_structure
            },
            'warnings': self.warnings
        }
        return result
    
    def to_json(self) -> str:
        return json.dumps(self.to_dict(), indent=2)


class SMCStrategyEngine:
    """
    Smart Money Concept Strategy Engine
    
    Menganalisis pasar menggunakan konsep:
    1. Trend Alignment (EMA 200 H4) - Tentukan bias arah
    2. POI (Point of Interest) - Identifikasi zona entry
    3. Confirmation (CHOCH/MSB) - Konfirmasi di M15
    4. Risk Management - SL/TP berdasarkan struktur
    
    Rules:
    - Harga di bawah EMA 200 H4 = ONLY SELL
    - Harga di atas EMA 200 H4 = ONLY BUY
    - Entry hanya di Fresh Supply/Demand Zone
    - Konfirmasi wajib: CHOCH atau MSB di M15
    """
    
    # Minimum requirements
    MIN_ZONE_STRENGTH = 60  # Minimum zone strength (0-100)
    MIN_RRR = 2.0  # Minimum Risk/Reward Ratio
    MIN_CONFIDENCE = 60  # Minimum confidence untuk entry
    
    # EMA settings
    EMA_PERIOD = 200
    
    def __init__(
        self,
        min_zone_strength: int = 60,
        min_rrr: float = 2.0,
        min_confidence: int = 60
    ):
        """
        Initialize SMC Strategy Engine
        
        Args:
            min_zone_strength: Minimum kekuatan zona (0-100)
            min_rrr: Minimum Risk/Reward Ratio
            min_confidence: Minimum confidence score untuk entry
        """
        self.min_zone_strength = min_zone_strength
        self.min_rrr = min_rrr
        self.min_confidence = min_confidence
        
        logger.info("SMC Strategy Engine initialized")
        logger.info(f"  Min Zone Strength: {min_zone_strength}")
        logger.info(f"  Min RRR: {min_rrr}")
        logger.info(f"  Min Confidence: {min_confidence}")
    
    # ==========================================
    # CORE ANALYSIS FUNCTIONS
    # ==========================================
    
    def calculate_ema(self, prices: List[float], period: int) -> List[float]:
        """
        Calculate Exponential Moving Average
        
        Args:
            prices: List of closing prices
            period: EMA period
            
        Returns:
            List of EMA values
        """
        if len(prices) < period:
            return [prices[0]] * len(prices)
        
        multiplier = 2 / (period + 1)
        ema = [sum(prices[:period]) / period]  # SMA for first value
        
        for price in prices[period:]:
            ema.append((price - ema[-1]) * multiplier + ema[-1])
        
        # Pad awal dengan SMA
        return [ema[0]] * (period - 1) + ema
    
    def get_trend_direction(self, candles: List[OHLC], ema_200: float) -> TrendDirection:
        """
        Tentukan arah trend berdasarkan posisi harga terhadap EMA 200
        
        Args:
            candles: List candlestick H4
            ema_200: Nilai EMA 200 saat ini
            
        Returns:
            TrendDirection (BULLISH/BEARISH/NEUTRAL)
        """
        if not candles:
            return TrendDirection.NEUTRAL
        
        current_close = candles[-1].close
        
        # Buffer 0.1% untuk menghindari whipsaw
        buffer = ema_200 * 0.001
        
        if current_close > ema_200 + buffer:
            return TrendDirection.BULLISH
        elif current_close < ema_200 - buffer:
            return TrendDirection.BEARISH
        else:
            return TrendDirection.NEUTRAL
    
    def find_swing_points(self, candles: List[OHLC], lookback: int = 5) -> List[SwingPoint]:
        """
        Identifikasi Swing High dan Swing Low
        
        Args:
            candles: List candlestick
            lookback: Jumlah candle untuk konfirmasi swing
            
        Returns:
            List of SwingPoint
        """
        swings = []
        
        if len(candles) < lookback * 2 + 1:
            return swings
        
        for i in range(lookback, len(candles) - lookback):
            current = candles[i]
            
            # Check Swing High
            is_swing_high = all(
                current.high >= candles[i - j].high and 
                current.high >= candles[i + j].high 
                for j in range(1, lookback + 1)
            )
            
            # Check Swing Low
            is_swing_low = all(
                current.low <= candles[i - j].low and 
                current.low <= candles[i + j].low 
                for j in range(1, lookback + 1)
            )
            
            if is_swing_high:
                swings.append(SwingPoint(
                    price=current.high,
                    time=current.time,
                    is_high=True
                ))
            
            if is_swing_low:
                swings.append(SwingPoint(
                    price=current.low,
                    time=current.time,
                    is_high=False
                ))
        
        return swings
    
    def detect_market_structure(self, swings: List[SwingPoint]) -> str:
        """
        Deteksi struktur pasar (HH-HL atau LH-LL)
        
        Args:
            swings: List of SwingPoint
            
        Returns:
            String deskripsi struktur (e.g., "HH-HL Bullish" atau "LH-LL Bearish")
        """
        if len(swings) < 4:
            return "INSUFFICIENT_DATA"
        
        # Get last 4 swing points
        recent_swings = swings[-4:]
        
        # Separate highs and lows
        highs = [s for s in recent_swings if s.is_high]
        lows = [s for s in recent_swings if not s.is_high]
        
        if len(highs) < 2 or len(lows) < 2:
            return "MIXED"
        
        # Compare last 2 highs and last 2 lows
        last_high = highs[-1].price
        prev_high = highs[-2].price
        last_low = lows[-1].price
        prev_low = lows[-2].price
        
        # Determine structure
        higher_high = last_high > prev_high
        higher_low = last_low > prev_low
        lower_high = last_high < prev_high
        lower_low = last_low < prev_low
        
        if higher_high and higher_low:
            return "HH-HL_BULLISH"
        elif lower_high and lower_low:
            return "LH-LL_BEARISH"
        elif higher_high and lower_low:
            return "EXPANSION"
        elif lower_high and higher_low:
            return "CONTRACTION"
        else:
            return "RANGING"
    
    def detect_choch(
        self, 
        candles: List[OHLC], 
        swings: List[SwingPoint],
        trend: TrendDirection
    ) -> Tuple[bool, Optional[float]]:
        """
        Deteksi Change of Character (CHOCH)
        
        CHOCH = Break of most recent swing point AGAINST the trend
        - In downtrend: Break of recent swing HIGH = CHOCH bullish
        - In uptrend: Break of recent swing LOW = CHOCH bearish
        
        Args:
            candles: List candlestick M15
            swings: List of SwingPoint
            trend: Current trend direction
            
        Returns:
            Tuple (is_choch, break_price)
        """
        if len(candles) < 3 or len(swings) < 2:
            return False, None
        
        current_price = candles[-1].close
        
        # Get relevant swing points
        swing_highs = [s for s in swings if s.is_high]
        swing_lows = [s for s in swings if not s.is_high]
        
        if trend == TrendDirection.BEARISH:
            # Di downtrend, CHOCH = break swing high
            if swing_highs:
                last_high = swing_highs[-1].price
                if current_price > last_high:
                    logger.info(f"🔄 CHOCH detected! Price {current_price} broke above swing high {last_high}")
                    return True, last_high
        
        elif trend == TrendDirection.BULLISH:
            # Di uptrend, CHOCH = break swing low
            if swing_lows:
                last_low = swing_lows[-1].price
                if current_price < last_low:
                    logger.info(f"🔄 CHOCH detected! Price {current_price} broke below swing low {last_low}")
                    return True, last_low
        
        return False, None
    
    def detect_msb(
        self,
        candles: List[OHLC],
        swings: List[SwingPoint],
        trend: TrendDirection
    ) -> Tuple[bool, Optional[float]]:
        """
        Deteksi Market Structure Break (MSB)
        
        MSB = Break of most recent swing point WITH the trend
        - In uptrend: Break of recent swing HIGH = MSB continuation
        - In downtrend: Break of recent swing LOW = MSB continuation
        
        Args:
            candles: List candlestick M15
            swings: List of SwingPoint
            trend: Current trend direction
            
        Returns:
            Tuple (is_msb, break_price)
        """
        if len(candles) < 3 or len(swings) < 2:
            return False, None
        
        current_price = candles[-1].close
        
        swing_highs = [s for s in swings if s.is_high]
        swing_lows = [s for s in swings if not s.is_high]
        
        if trend == TrendDirection.BULLISH:
            # Di uptrend, MSB = break swing high (continuation)
            if swing_highs:
                last_high = swing_highs[-1].price
                if current_price > last_high:
                    logger.info(f"📈 MSB detected! Price {current_price} broke above swing high {last_high}")
                    return True, last_high
        
        elif trend == TrendDirection.BEARISH:
            # Di downtrend, MSB = break swing low (continuation)
            if swing_lows:
                last_low = swing_lows[-1].price
                if current_price < last_low:
                    logger.info(f"📉 MSB detected! Price {current_price} broke below swing low {last_low}")
                    return True, last_low
        
        return False, None
    
    def find_poi_zone(
        self,
        current_price: float,
        zones: List[SupplyDemandZone],
        trend: TrendDirection
    ) -> Optional[SupplyDemandZone]:
        """
        Cari Point of Interest (POI) - Zona yang relevan untuk entry
        
        Args:
            current_price: Harga saat ini
            zones: List of SupplyDemandZone
            trend: Current trend direction
            
        Returns:
            Zona terbaik untuk entry atau None
        """
        relevant_zones = []
        
        for zone in zones:
            # Skip zona yang sudah broken
            if zone.status == ZoneStatus.BROKEN:
                continue
            
            # Skip zona dengan strength rendah
            if zone.strength < self.min_zone_strength:
                continue
            
            # Check alignment dengan trend
            if trend == TrendDirection.BULLISH:
                # Cari Demand Zone untuk BUY
                if zone.zone_type == ZoneType.DEMAND:
                    if zone.is_price_in_zone(current_price):
                        relevant_zones.append(zone)
            
            elif trend == TrendDirection.BEARISH:
                # Cari Supply Zone untuk SELL
                if zone.zone_type == ZoneType.SUPPLY:
                    if zone.is_price_in_zone(current_price):
                        relevant_zones.append(zone)
        
        if not relevant_zones:
            return None
        
        # Sort by strength (highest first), then by freshness
        relevant_zones.sort(key=lambda z: (
            z.status == ZoneStatus.FRESH,  # Fresh zones first
            z.strength  # Then by strength
        ), reverse=True)
        
        return relevant_zones[0]
    
    def calculate_setup(
        self,
        entry_price: float,
        zone: SupplyDemandZone,
        trend: TrendDirection,
        swings: List[SwingPoint],
        symbol: str = 'XAUUSD'
    ) -> Optional[SMCSetup]:
        """
        Hitung trading setup (Entry, SL, TP1, TP2)
        
        Args:
            entry_price: Harga entry
            zone: POI zone
            trend: Trend direction
            swings: List of swing points
            symbol: Trading symbol
            
        Returns:
            SMCSetup object
        """
        # Determine pip size based on symbol
        symbol_upper = symbol.upper()
        if 'JPY' in symbol_upper:
            pip_size = 0.01
        elif 'XAU' in symbol_upper:
            pip_size = 0.1
        elif 'BTC' in symbol_upper or 'ETH' in symbol_upper:
            pip_size = 1.0
        else:
            pip_size = 0.0001
        
        # Get recent swing points for SL/TP placement
        swing_highs = sorted([s for s in swings if s.is_high], key=lambda x: x.time)
        swing_lows = sorted([s for s in swings if not s.is_high], key=lambda x: x.time)
        
        if trend == TrendDirection.BULLISH:
            # BUY setup
            position_type = "BUY"
            
            # SL below zone low (with buffer)
            sl_buffer = zone.zone_size * 0.5
            stop_loss = zone.price_low - sl_buffer
            
            # TP1 at 1.5x risk (or nearest swing high)
            risk_distance = entry_price - stop_loss
            tp1_by_rrr = entry_price + (risk_distance * 1.5)
            
            # TP2 at 3x risk (or second swing high)
            tp2_by_rrr = entry_price + (risk_distance * 3.0)
            
            # Use swing highs if available
            if swing_highs:
                nearest_high = min([s.price for s in swing_highs if s.price > entry_price], default=tp1_by_rrr)
                tp1 = max(tp1_by_rrr, nearest_high)
            else:
                tp1 = tp1_by_rrr
            
            tp2 = tp2_by_rrr
            
        else:
            # SELL setup
            position_type = "SELL"
            
            # SL above zone high (with buffer)
            sl_buffer = zone.zone_size * 0.5
            stop_loss = zone.price_high + sl_buffer
            
            # TP1 at 1.5x risk
            risk_distance = stop_loss - entry_price
            tp1_by_rrr = entry_price - (risk_distance * 1.5)
            
            # TP2 at 3x risk
            tp2_by_rrr = entry_price - (risk_distance * 3.0)
            
            # Use swing lows if available
            if swing_lows:
                nearest_low = max([s.price for s in swing_lows if s.price < entry_price], default=tp1_by_rrr)
                tp1 = min(tp1_by_rrr, nearest_low)
            else:
                tp1 = tp1_by_rrr
            
            tp2 = tp2_by_rrr
        
        # Calculate pips and RRR
        risk_pips = abs(entry_price - stop_loss) / pip_size
        reward_pips_tp1 = abs(tp1 - entry_price) / pip_size
        reward_pips_tp2 = abs(tp2 - entry_price) / pip_size
        
        rrr_tp1 = reward_pips_tp1 / risk_pips if risk_pips > 0 else 0
        rrr_tp2 = reward_pips_tp2 / risk_pips if risk_pips > 0 else 0
        
        # Validate minimum RRR
        if rrr_tp1 < self.min_rrr:
            logger.warning(f"RRR {rrr_tp1:.2f} below minimum {self.min_rrr}")
            return None
        
        return SMCSetup(
            entry=entry_price,
            stop_loss=stop_loss,
            take_profit_1=tp1,
            take_profit_2=tp2,
            position_type=position_type,
            risk_pips=risk_pips,
            reward_pips_tp1=reward_pips_tp1,
            reward_pips_tp2=reward_pips_tp2,
            rrr_tp1=rrr_tp1,
            rrr_tp2=rrr_tp2
        )
    
    def calculate_confidence(
        self,
        zone: SupplyDemandZone,
        has_choch: bool,
        has_msb: bool,
        trend: TrendDirection,
        structure: str,
        volume_confirmation: bool = False
    ) -> int:
        """
        Hitung confidence score (0-100)
        
        Scoring:
        - Zone strength: 0-30 points
        - Zone freshness: 0-15 points
        - CHOCH/MSB confirmation: 0-25 points
        - Trend alignment: 0-15 points
        - Structure alignment: 0-10 points
        - Volume confirmation: 0-5 points
        
        Args:
            zone: POI zone
            has_choch: True if CHOCH detected
            has_msb: True if MSB detected
            trend: Trend direction
            structure: Market structure
            volume_confirmation: True if volume supports
            
        Returns:
            Confidence score (0-100)
        """
        score = 0
        
        # 1. Zone strength (0-30)
        zone_score = min(30, zone.strength * 0.3)
        score += zone_score
        
        # 2. Zone freshness (0-15)
        if zone.status == ZoneStatus.FRESH:
            score += 15
        elif zone.status == ZoneStatus.TESTED and zone.tested_count == 1:
            score += 10
        else:
            score += 5
        
        # 3. Confirmation (0-25)
        if has_choch:
            score += 25  # CHOCH = strong reversal signal
        elif has_msb:
            score += 20  # MSB = good continuation signal
        else:
            score += 0  # No confirmation = risky
        
        # 4. Trend alignment (0-15)
        if trend != TrendDirection.NEUTRAL:
            score += 15
        else:
            score += 5
        
        # 5. Structure alignment (0-10)
        if trend == TrendDirection.BULLISH and 'BULLISH' in structure:
            score += 10
        elif trend == TrendDirection.BEARISH and 'BEARISH' in structure:
            score += 10
        elif 'RANGING' in structure or 'CONTRACTION' in structure:
            score += 5
        
        # 6. Volume confirmation (0-5)
        if volume_confirmation:
            score += 5
        
        return min(100, int(score))
    
    # ==========================================
    # MAIN ANALYSIS FUNCTION
    # ==========================================
    
    def analyze(
        self,
        ohlc_h4: List[Dict[str, Any]],
        ohlc_m15: List[Dict[str, Any]],
        supply_demand_zones: List[Dict[str, Any]],
        market_structure: Dict[str, Any],
        current_volume: float = 0.0,
        symbol: str = 'XAUUSD'
    ) -> SMCAnalysisResult:
        """
        Analisis utama SMC Strategy
        
        Args:
            ohlc_h4: List candlestick H4 (minimal 200 candles untuk EMA)
            ohlc_m15: List candlestick M15 (untuk konfirmasi)
            supply_demand_zones: List zona supply/demand
            market_structure: Dict info struktur pasar
            current_volume: Volume saat ini
            symbol: Trading symbol
            
        Returns:
            SMCAnalysisResult dengan decision, confidence, logic, dan setup
        """
        warnings = []
        
        # ==========================================
        # 1. PARSE INPUT DATA
        # ==========================================
        
        # Parse H4 candles
        candles_h4 = []
        for c in ohlc_h4:
            candles_h4.append(OHLC(
                time=c.get('time', 0),
                open=c.get('open', 0),
                high=c.get('high', 0),
                low=c.get('low', 0),
                close=c.get('close', 0),
                volume=c.get('volume', 0)
            ))
        
        # Parse M15 candles
        candles_m15 = []
        for c in ohlc_m15:
            candles_m15.append(OHLC(
                time=c.get('time', 0),
                open=c.get('open', 0),
                high=c.get('high', 0),
                low=c.get('low', 0),
                close=c.get('close', 0),
                volume=c.get('volume', 0)
            ))
        
        # Parse zones
        zones = []
        for z in supply_demand_zones:
            zones.append(SupplyDemandZone(
                zone_type=ZoneType.SUPPLY if z.get('type', '').lower() == 'supply' else ZoneType.DEMAND,
                status=ZoneStatus[z.get('status', 'fresh').upper()],
                price_high=z.get('price_high', z.get('high', 0)),
                price_low=z.get('price_low', z.get('low', 0)),
                strength=z.get('strength', 50),
                created_at=z.get('created_at', 0),
                tested_count=z.get('tested_count', 0)
            ))
        
        # Validate data
        if len(candles_h4) < 200:
            warnings.append(f"Insufficient H4 data: {len(candles_h4)} candles (need 200)")
            return SMCAnalysisResult(
                decision='NO_TRADE',
                confidence_score=0,
                logic="Insufficient historical data for EMA 200 calculation.",
                warnings=warnings
            )
        
        if len(candles_m15) < 20:
            warnings.append(f"Insufficient M15 data: {len(candles_m15)} candles")
            return SMCAnalysisResult(
                decision='NO_TRADE',
                confidence_score=0,
                logic="Insufficient M15 data for confirmation analysis.",
                warnings=warnings
            )
        
        # ==========================================
        # 2. TREND ALIGNMENT (H4)
        # ==========================================
        
        # Calculate EMA 200
        closes_h4 = [c.close for c in candles_h4]
        ema_200_values = self.calculate_ema(closes_h4, self.EMA_PERIOD)
        ema_200 = ema_200_values[-1]
        
        # Get trend direction
        trend = self.get_trend_direction(candles_h4, ema_200)
        current_price = candles_h4[-1].close
        
        logger.info(f"📊 H4 Analysis: Price={current_price}, EMA200={ema_200:.5f}, Trend={trend.value}")
        
        if trend == TrendDirection.NEUTRAL:
            return SMCAnalysisResult(
                decision='NO_TRADE',
                confidence_score=20,
                logic="Price terlalu dekat dengan EMA 200, tidak ada bias arah yang jelas.",
                trend_h4=trend,
                warnings=warnings
            )
        
        # ==========================================
        # 3. POINT OF INTEREST (POI)
        # ==========================================
        
        poi_zone = self.find_poi_zone(current_price, zones, trend)
        
        if not poi_zone:
            # Cek apakah ada zona terdekat
            closest_zone = None
            min_distance = float('inf')
            
            for zone in zones:
                if zone.status == ZoneStatus.BROKEN:
                    continue
                
                # Hanya cari zona yang sesuai dengan trend
                if trend == TrendDirection.BULLISH and zone.zone_type != ZoneType.DEMAND:
                    continue
                if trend == TrendDirection.BEARISH and zone.zone_type != ZoneType.SUPPLY:
                    continue
                
                distance = abs(current_price - zone.midpoint)
                if distance < min_distance:
                    min_distance = distance
                    closest_zone = zone
            
            if closest_zone:
                zone_type = "Demand" if trend == TrendDirection.BULLISH else "Supply"
                return SMCAnalysisResult(
                    decision='NO_TRADE',
                    confidence_score=30,
                    logic=f"Harga belum mencapai {zone_type} Zone terdekat di {closest_zone.price_high:.5f}-{closest_zone.price_low:.5f}. Tunggu pullback.",
                    trend_h4=trend,
                    warnings=warnings
                )
            else:
                return SMCAnalysisResult(
                    decision='NO_TRADE',
                    confidence_score=25,
                    logic=f"Tidak ada {'Demand' if trend == TrendDirection.BULLISH else 'Supply'} Zone yang valid. Tunggu pembentukan zona baru.",
                    trend_h4=trend,
                    warnings=warnings
                )
        
        logger.info(f"🎯 POI Zone found: {poi_zone.zone_type.value} @ {poi_zone.price_low}-{poi_zone.price_high}")
        
        # ==========================================
        # 4. REFINEMENT (M15 Confirmation)
        # ==========================================
        
        # Find swing points in M15
        swings_m15 = self.find_swing_points(candles_m15, lookback=3)
        
        # Detect CHOCH and MSB
        has_choch, choch_price = self.detect_choch(candles_m15, swings_m15, trend)
        has_msb, msb_price = self.detect_msb(candles_m15, swings_m15, trend)
        
        # Detect market structure
        structure = self.detect_market_structure(swings_m15)
        
        logger.info(f"📈 M15 Structure: {structure}, CHOCH={has_choch}, MSB={has_msb}")
        
        # Check confirmation
        confirmation_type = None
        if has_choch:
            confirmation_type = ConfirmationType.CHOCH
        elif has_msb:
            confirmation_type = ConfirmationType.MSB
        
        if not confirmation_type:
            return SMCAnalysisResult(
                decision='NO_TRADE',
                confidence_score=45,
                logic=f"Harga di dalam {poi_zone.zone_type.value} zone, tapi belum ada konfirmasi CHOCH/MSB di M15. Tunggu break of structure.",
                trend_h4=trend,
                poi_zone=poi_zone,
                market_structure=structure,
                warnings=warnings
            )
        
        # ==========================================
        # 5. CALCULATE SETUP
        # ==========================================
        
        setup = self.calculate_setup(
            entry_price=current_price,
            zone=poi_zone,
            trend=trend,
            swings=swings_m15,
            symbol=symbol
        )
        
        if not setup:
            return SMCAnalysisResult(
                decision='NO_TRADE',
                confidence_score=50,
                logic=f"Setup tidak memenuhi minimum RRR {self.min_rrr}. Zona terlalu tipis atau SL terlalu jauh.",
                trend_h4=trend,
                poi_zone=poi_zone,
                confirmation_type=confirmation_type,
                market_structure=structure,
                warnings=warnings
            )
        
        # ==========================================
        # 6. CALCULATE CONFIDENCE
        # ==========================================
        
        # Volume confirmation (simplified)
        avg_volume = sum(c.volume for c in candles_m15[-10:]) / 10 if candles_m15 else 0
        volume_confirmation = current_volume > avg_volume * 1.2 if current_volume > 0 else False
        
        confidence = self.calculate_confidence(
            zone=poi_zone,
            has_choch=has_choch,
            has_msb=has_msb,
            trend=trend,
            structure=structure,
            volume_confirmation=volume_confirmation
        )
        
        # ==========================================
        # 7. FINAL DECISION
        # ==========================================
        
        if confidence >= self.min_confidence:
            # Generate logic explanation
            conf_type = "CHOCH (Change of Character)" if has_choch else "MSB (Market Structure Break)"
            zone_type = "Demand Zone" if poi_zone.zone_type == ZoneType.DEMAND else "Supply Zone"
            action = "BUY" if trend == TrendDirection.BULLISH else "SELL"
            
            logic = f"{action} signal valid: Harga di Fresh {zone_type} dengan konfirmasi {conf_type} di M15, selaras dengan trend H4 {trend.value.upper()}."
            
            return SMCAnalysisResult(
                decision='ENTRY',
                confidence_score=confidence,
                logic=logic,
                setup=setup,
                trend_h4=trend,
                poi_zone=poi_zone,
                confirmation_type=confirmation_type,
                market_structure=structure,
                warnings=warnings
            )
        else:
            return SMCAnalysisResult(
                decision='NO_TRADE',
                confidence_score=confidence,
                logic=f"Confidence score {confidence} di bawah minimum {self.min_confidence}. Setup kurang kuat untuk risiko rendah.",
                trend_h4=trend,
                poi_zone=poi_zone,
                confirmation_type=confirmation_type,
                market_structure=structure,
                setup=setup,  # Include setup for reference
                warnings=warnings
            )
    
    def analyze_json(self, input_json: str) -> str:
        """
        Wrapper untuk menerima input JSON string
        
        Args:
            input_json: JSON string dengan format:
                {
                    "ohlc_h4": [...],
                    "ohlc_m15": [...],
                    "supply_demand_zones": [...],
                    "market_structure": {...},
                    "current_volume": 123.45,
                    "symbol": "XAUUSD"
                }
                
        Returns:
            JSON string hasil analisis
        """
        try:
            data = json.loads(input_json)
            
            result = self.analyze(
                ohlc_h4=data.get('ohlc_h4', []),
                ohlc_m15=data.get('ohlc_m15', []),
                supply_demand_zones=data.get('supply_demand_zones', []),
                market_structure=data.get('market_structure', {}),
                current_volume=data.get('current_volume', 0),
                symbol=data.get('symbol', 'XAUUSD')
            )
            
            return result.to_json()
            
        except json.JSONDecodeError as e:
            return json.dumps({
                'decision': 'NO_TRADE',
                'confidence_score': 0,
                'logic': f'Invalid JSON input: {str(e)}',
                'setup': None
            })
        except Exception as e:
            return json.dumps({
                'decision': 'NO_TRADE',
                'confidence_score': 0,
                'logic': f'Analysis error: {str(e)}',
                'setup': None
            })


# =======================
# USAGE EXAMPLE
# =======================
if __name__ == "__main__":
    import random
    from datetime import datetime, timedelta
    
    # Initialize SMC Engine
    smc_engine = SMCStrategyEngine(
        min_zone_strength=60,
        min_rrr=2.0,
        min_confidence=60
    )
    
    # Generate sample H4 data (200 candles)
    print("\n🎯 SMC Strategy Engine - Demo")
    print("=" * 50)
    
    base_time = int(datetime.now().timestamp())
    base_price = 2050.0
    
    # Simulate uptrend (price above EMA 200)
    ohlc_h4 = []
    price = 1950.0  # Start below, trend up
    for i in range(200):
        candle_time = base_time - (200 - i) * 4 * 3600  # H4 = 4 hours
        open_price = price
        close_price = price + random.uniform(-5, 8)  # Slight upward bias
        high_price = max(open_price, close_price) + random.uniform(0, 5)
        low_price = min(open_price, close_price) - random.uniform(0, 5)
        
        ohlc_h4.append({
            'time': candle_time,
            'open': open_price,
            'high': high_price,
            'low': low_price,
            'close': close_price,
            'volume': random.uniform(1000, 5000)
        })
        
        price = close_price
    
    # Generate sample M15 data (50 candles)
    ohlc_m15 = []
    price = ohlc_h4[-1]['close']
    for i in range(50):
        candle_time = base_time - (50 - i) * 15 * 60  # M15 = 15 minutes
        open_price = price
        close_price = price + random.uniform(-2, 3)
        high_price = max(open_price, close_price) + random.uniform(0, 2)
        low_price = min(open_price, close_price) - random.uniform(0, 2)
        
        ohlc_m15.append({
            'time': candle_time,
            'open': open_price,
            'high': high_price,
            'low': low_price,
            'close': close_price,
            'volume': random.uniform(100, 500)
        })
        
        price = close_price
    
    current_price = ohlc_m15[-1]['close']
    
    # Sample supply/demand zones
    supply_demand_zones = [
        {
            'type': 'demand',
            'status': 'fresh',
            'price_high': current_price + 5,
            'price_low': current_price - 5,
            'strength': 80,
            'created_at': base_time - 3600,
            'tested_count': 0
        },
        {
            'type': 'supply',
            'status': 'tested',
            'price_high': current_price + 50,
            'price_low': current_price + 40,
            'strength': 65,
            'created_at': base_time - 7200,
            'tested_count': 1
        }
    ]
    
    # Sample market structure
    market_structure = {
        'trend': 'bullish',
        'last_swing_high': current_price + 10,
        'last_swing_low': current_price - 15
    }
    
    # Run analysis
    print(f"\n📊 Current Price: {current_price:.2f}")
    print(f"📈 H4 Candles: {len(ohlc_h4)}")
    print(f"📉 M15 Candles: {len(ohlc_m15)}")
    print(f"🎯 Zones: {len(supply_demand_zones)}")
    
    result = smc_engine.analyze(
        ohlc_h4=ohlc_h4,
        ohlc_m15=ohlc_m15,
        supply_demand_zones=supply_demand_zones,
        market_structure=market_structure,
        current_volume=250.0,
        symbol='XAUUSD'
    )
    
    print(f"\n{'=' * 50}")
    print("📋 ANALYSIS RESULT:")
    print(f"{'=' * 50}")
    print(result.to_json())
    
    # Also test JSON input
    print(f"\n{'=' * 50}")
    print("📋 JSON INPUT TEST:")
    print(f"{'=' * 50}")
    
    input_data = {
        'ohlc_h4': ohlc_h4,
        'ohlc_m15': ohlc_m15,
        'supply_demand_zones': supply_demand_zones,
        'market_structure': market_structure,
        'current_volume': 250.0,
        'symbol': 'XAUUSD'
    }
    
    json_result = smc_engine.analyze_json(json.dumps(input_data))
    parsed = json.loads(json_result)
    
    print(f"\n🎯 Decision: {parsed['decision']}")
    print(f"📊 Confidence: {parsed['confidence_score']}%")
    print(f"💡 Logic: {parsed['logic']}")
    
    if parsed['setup']:
        print(f"\n📈 Setup:")
        for key, value in parsed['setup'].items():
            print(f"   {key}: {value}")
