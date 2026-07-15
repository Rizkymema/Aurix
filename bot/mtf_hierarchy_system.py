"""
MTF HIERARCHY SYSTEM - Multi-Timeframe Analysis dengan Hierarchy Lock
======================================================================
Sistem analisis multi-timeframe dengan aturan hierarki ketat.

🔒 ATURAN HIERARKI TIME FRAME (MUTLAK):
  H4 = Trend Boss (arah final)
  H1 = Validasi struktur  
  M15 = Konfirmasi & timing
  M5/M1 = Entry ONLY

❗ Jika ada konflik antar time frame:
  - IKUTI H4
  - ABAIKAN semua sinyal berlawanan dari TF lebih kecil
  - Tidak boleh ada sinyal BUY dan SELL bersamaan

Author: AI Trading System Core
Version: 2.0.0
"""

from dataclasses import dataclass, field
from typing import Dict, Any, Optional, List, Tuple
from enum import Enum
from datetime import datetime
import logging
import json

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class Timeframe(Enum):
    """Timeframe dengan hierarchy level"""
    H4 = ("4h", 1, "TREND_BOSS")       # Level 1 = Highest authority
    H1 = ("1h", 2, "STRUCTURE")        # Level 2 = Structure validation
    M15 = ("15m", 3, "CONFIRMATION")   # Level 3 = Confirmation & timing
    M5 = ("5m", 4, "ENTRY")            # Level 4 = Entry only
    M1 = ("1m", 5, "ENTRY")            # Level 5 = Entry only
    
    def __init__(self, label: str, level: int, role: str):
        self.label = label
        self.level = level
        self.role = role
    
    def is_higher_than(self, other: 'Timeframe') -> bool:
        """Check if this timeframe is higher (more authority) than other"""
        return self.level < other.level
    
    def is_entry_timeframe(self) -> bool:
        """Check if this is entry-only timeframe"""
        return self.role == "ENTRY"


class MarketStructure(Enum):
    """Struktur pasar berdasarkan swing points"""
    HH_HL = "HH-HL"      # Higher High - Higher Low = BULLISH
    LH_LL = "LH-LL"      # Lower High - Lower Low = BEARISH
    HH_LL = "HH-LL"      # Expansion (Mixed)
    LH_HL = "LH-HL"      # Contraction (Ranging)
    UNCLEAR = "UNCLEAR"  # Tidak jelas = NO TRADE


class TrendBias(Enum):
    """Bias arah trading"""
    BULLISH = "BUY"
    BEARISH = "SELL"
    NO_TRADE = "NO_TRADE"


class PricePosition(Enum):
    """Posisi harga relatif terhadap range"""
    PREMIUM = "PREMIUM"      # Di atas 50% range (area sell)
    DISCOUNT = "DISCOUNT"    # Di bawah 50% range (area buy)
    MIDDLE = "MIDDLE"        # Di tengah 40-60% = NO TRADE
    EXTREME_HIGH = "EXTREME_HIGH"  # Di atas 80%
    EXTREME_LOW = "EXTREME_LOW"    # Di bawah 20%


@dataclass
class SwingPoint:
    """Swing High atau Swing Low"""
    price: float
    time: int
    is_high: bool
    timeframe: str
    confirmed: bool = False
    
    @property
    def type_str(self) -> str:
        return "Swing High" if self.is_high else "Swing Low"


@dataclass 
class StructureAnalysis:
    """Hasil analisis struktur per timeframe"""
    timeframe: Timeframe
    structure: MarketStructure
    trend_bias: TrendBias
    swing_points: List[SwingPoint]
    last_hh: Optional[float] = None
    last_hl: Optional[float] = None
    last_lh: Optional[float] = None
    last_ll: Optional[float] = None
    ema_200: Optional[float] = None
    price_vs_ema: Optional[str] = None
    confidence: int = 0
    notes: List[str] = field(default_factory=list)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'timeframe': self.timeframe.label,
            'structure': self.structure.value,
            'trend_bias': self.trend_bias.value,
            'swing_points': len(self.swing_points),
            'last_hh': self.last_hh,
            'last_hl': self.last_hl,
            'last_lh': self.last_lh,
            'last_ll': self.last_ll,
            'ema_200': round(self.ema_200, 5) if self.ema_200 else None,
            'price_vs_ema': self.price_vs_ema,
            'confidence': self.confidence,
            'notes': self.notes
        }


@dataclass
class ZoneInfo:
    """Supply/Demand Zone information"""
    zone_type: str  # 'supply' or 'demand'
    price_high: float
    price_low: float
    strength: int
    timeframe: str
    status: str  # 'fresh', 'tested', 'broken'
    
    @property
    def midpoint(self) -> float:
        return (self.price_high + self.price_low) / 2
    
    def is_price_in_zone(self, price: float, buffer_pct: float = 0.002) -> bool:
        """Check if price is in zone with buffer"""
        buffer = (self.price_high - self.price_low) * buffer_pct
        return (self.price_low - buffer) <= price <= (self.price_high + buffer)


@dataclass
class MTFAnalysisResult:
    """Hasil lengkap analisis multi-timeframe"""
    # Hierarchy Analysis
    h4_analysis: Optional[StructureAnalysis] = None
    h1_analysis: Optional[StructureAnalysis] = None
    m15_analysis: Optional[StructureAnalysis] = None
    m5_analysis: Optional[StructureAnalysis] = None
    
    # Final Decision
    final_bias: TrendBias = TrendBias.NO_TRADE
    hierarchy_aligned: bool = False
    price_position: PricePosition = PricePosition.MIDDLE
    
    # Zone Analysis
    relevant_zone: Optional[ZoneInfo] = None
    in_zone: bool = False
    
    # Pullback Analysis
    is_pullback: bool = False
    pullback_quality: str = "none"
    
    # Rejection Reasons
    rejection_reasons: List[str] = field(default_factory=list)
    
    # Confidence & Validation
    overall_confidence: int = 0
    can_trade: bool = False
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'final_bias': self.final_bias.value,
            'hierarchy_aligned': self.hierarchy_aligned,
            'price_position': self.price_position.value,
            'in_zone': self.in_zone,
            'relevant_zone': {
                'type': self.relevant_zone.zone_type,
                'high': self.relevant_zone.price_high,
                'low': self.relevant_zone.price_low,
                'strength': self.relevant_zone.strength
            } if self.relevant_zone else None,
            'is_pullback': self.is_pullback,
            'pullback_quality': self.pullback_quality,
            'overall_confidence': self.overall_confidence,
            'can_trade': self.can_trade,
            'rejection_reasons': self.rejection_reasons,
            'analysis': {
                'h4': self.h4_analysis.to_dict() if self.h4_analysis else None,
                'h1': self.h1_analysis.to_dict() if self.h1_analysis else None,
                'm15': self.m15_analysis.to_dict() if self.m15_analysis else None,
                'm5': self.m5_analysis.to_dict() if self.m5_analysis else None
            }
        }


class OHLC:
    """Candlestick data structure"""
    def __init__(self, time: int, open: float, high: float, low: float, close: float, volume: float = 0.0):
        self.time = time
        self.open = open
        self.high = high
        self.low = low
        self.close = close
        self.volume = volume
    
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


class MTFHierarchyAnalyzer:
    """
    Multi-Timeframe Hierarchy Analyzer
    
    🔒 ATURAN HIERARKI MUTLAK:
    
    1. H4 = TREND BOSS - Arah final, tidak bisa di-override
    2. H1 = Validasi struktur (harus searah H4)
    3. M15 = Konfirmasi timing
    4. M5/M1 = Entry ONLY
    
    ❗ Jika ada konflik: SELALU IKUTI H4
    """
    
    # Configuration
    SWING_LOOKBACK = 5
    EMA_PERIOD = 200
    MIN_CONFIDENCE = 60
    MIN_RRR = 2.0
    
    # Price position thresholds
    PREMIUM_THRESHOLD = 0.6      # Above 60% = Premium
    DISCOUNT_THRESHOLD = 0.4    # Below 40% = Discount
    MIDDLE_BUFFER = 0.1         # 40-60% = Middle (NO TRADE)
    
    def __init__(self):
        logger.info("=" * 60)
        logger.info("MTF HIERARCHY ANALYZER INITIALIZED")
        logger.info("=" * 60)
        logger.info("🔒 Hierarchy Lock: H4 > H1 > M15 > M5/M1")
        logger.info(f"📊 Min Confidence: {self.MIN_CONFIDENCE}%")
        logger.info(f"📈 Min RRR: {self.MIN_RRR}")
    
    # ==========================================
    # CORE ANALYSIS METHODS
    # ==========================================
    
    def calculate_ema(self, prices: List[float], period: int) -> float:
        """Calculate EMA for given period"""
        if len(prices) < period:
            return sum(prices) / len(prices) if prices else 0
        
        multiplier = 2 / (period + 1)
        ema = sum(prices[:period]) / period
        
        for price in prices[period:]:
            ema = (price - ema) * multiplier + ema
        
        return ema
    
    def find_swing_points(
        self, 
        candles: List[OHLC], 
        lookback: int = None,
        timeframe: str = "H4"
    ) -> List[SwingPoint]:
        """
        Identifikasi Swing High dan Swing Low dengan konfirmasi
        
        Swing High: Candle dengan HIGH tertinggi di antara lookback candle sebelum dan sesudah
        Swing Low: Candle dengan LOW terendah di antara lookback candle sebelum dan sesudah
        """
        lookback = lookback or self.SWING_LOOKBACK
        swings = []
        
        if len(candles) < lookback * 2 + 1:
            logger.warning(f"[{timeframe}] Insufficient candles for swing detection")
            return swings
        
        for i in range(lookback, len(candles) - lookback):
            current = candles[i]
            
            # Check Swing High
            is_swing_high = True
            for j in range(1, lookback + 1):
                if current.high < candles[i - j].high or current.high < candles[i + j].high:
                    is_swing_high = False
                    break
            
            # Check Swing Low
            is_swing_low = True
            for j in range(1, lookback + 1):
                if current.low > candles[i - j].low or current.low > candles[i + j].low:
                    is_swing_low = False
                    break
            
            if is_swing_high:
                swings.append(SwingPoint(
                    price=current.high,
                    time=current.time,
                    is_high=True,
                    timeframe=timeframe,
                    confirmed=True
                ))
            
            if is_swing_low:
                swings.append(SwingPoint(
                    price=current.low,
                    time=current.time,
                    is_high=False,
                    timeframe=timeframe,
                    confirmed=True
                ))
        
        return swings
    
    def detect_market_structure(
        self, 
        swings: List[SwingPoint],
        timeframe: str = "H4"
    ) -> Tuple[MarketStructure, Dict[str, Optional[float]]]:
        """
        Deteksi struktur pasar dari swing points
        
        HH-HL = BULLISH (BUY only)
        LH-LL = BEARISH (SELL only)
        Mixed/Unclear = NO TRADE
        """
        if len(swings) < 4:
            logger.info(f"[{timeframe}] Insufficient swings for structure detection")
            return MarketStructure.UNCLEAR, {}
        
        # Separate highs and lows
        highs = [s for s in swings if s.is_high]
        lows = [s for s in swings if not s.is_high]
        
        # Sort by time
        highs.sort(key=lambda x: x.time)
        lows.sort(key=lambda x: x.time)
        
        if len(highs) < 2 or len(lows) < 2:
            return MarketStructure.UNCLEAR, {}
        
        # Get last 2 highs and lows
        last_high = highs[-1].price
        prev_high = highs[-2].price
        last_low = lows[-1].price
        prev_low = lows[-2].price
        
        points = {
            'last_hh': None,
            'last_hl': None,
            'last_lh': None,
            'last_ll': None
        }
        
        # Determine structure
        higher_high = last_high > prev_high
        higher_low = last_low > prev_low
        lower_high = last_high < prev_high
        lower_low = last_low < prev_low
        
        if higher_high and higher_low:
            points['last_hh'] = last_high
            points['last_hl'] = last_low
            logger.info(f"[{timeframe}] ✅ Structure: HH-HL (BULLISH)")
            logger.info(f"[{timeframe}] HH: {last_high:.5f} > {prev_high:.5f}")
            logger.info(f"[{timeframe}] HL: {last_low:.5f} > {prev_low:.5f}")
            return MarketStructure.HH_HL, points
        
        elif lower_high and lower_low:
            points['last_lh'] = last_high
            points['last_ll'] = last_low
            logger.info(f"[{timeframe}] ✅ Structure: LH-LL (BEARISH)")
            logger.info(f"[{timeframe}] LH: {last_high:.5f} < {prev_high:.5f}")
            logger.info(f"[{timeframe}] LL: {last_low:.5f} < {prev_low:.5f}")
            return MarketStructure.LH_LL, points
        
        elif higher_high and lower_low:
            logger.info(f"[{timeframe}] ⚠️ Structure: HH-LL (EXPANSION)")
            return MarketStructure.HH_LL, points
        
        elif lower_high and higher_low:
            logger.info(f"[{timeframe}] ⚠️ Structure: LH-HL (CONTRACTION/RANGING)")
            return MarketStructure.LH_HL, points
        
        logger.info(f"[{timeframe}] ❌ Structure: UNCLEAR")
        return MarketStructure.UNCLEAR, points
    
    def get_trend_bias_from_structure(self, structure: MarketStructure) -> TrendBias:
        """Convert market structure to trend bias"""
        if structure == MarketStructure.HH_HL:
            return TrendBias.BULLISH
        elif structure == MarketStructure.LH_LL:
            return TrendBias.BEARISH
        else:
            return TrendBias.NO_TRADE
    
    def analyze_single_timeframe(
        self,
        candles: List[OHLC],
        timeframe: Timeframe
    ) -> StructureAnalysis:
        """
        Analisis struktur untuk satu timeframe
        """
        tf_label = timeframe.label
        logger.info(f"\n{'='*40}")
        logger.info(f"📊 ANALYZING {tf_label.upper()} ({timeframe.role})")
        logger.info(f"{'='*40}")
        
        # Find swing points
        swings = self.find_swing_points(candles, timeframe=tf_label)
        logger.info(f"[{tf_label}] Found {len(swings)} swing points")
        
        # Detect structure
        structure, points = self.detect_market_structure(swings, tf_label)
        trend_bias = self.get_trend_bias_from_structure(structure)
        
        # Calculate EMA 200
        closes = [c.close for c in candles]
        ema_200 = self.calculate_ema(closes, self.EMA_PERIOD) if len(closes) >= self.EMA_PERIOD else None
        
        current_price = candles[-1].close if candles else 0
        price_vs_ema = None
        
        if ema_200:
            if current_price > ema_200:
                price_vs_ema = "ABOVE"
            elif current_price < ema_200:
                price_vs_ema = "BELOW"
            else:
                price_vs_ema = "AT"
            
            logger.info(f"[{tf_label}] Price: {current_price:.5f} | EMA 200: {ema_200:.5f} | Position: {price_vs_ema}")
        
        # Calculate confidence based on structure clarity
        confidence = 0
        notes = []
        
        if structure == MarketStructure.HH_HL:
            confidence = 80
            notes.append("Clear bullish structure (HH-HL)")
            if price_vs_ema == "ABOVE":
                confidence += 10
                notes.append("Price above EMA 200 confirms bullish bias")
            elif price_vs_ema == "BELOW":
                confidence -= 20
                notes.append("⚠️ Price below EMA 200 conflicts with bullish structure")
        
        elif structure == MarketStructure.LH_LL:
            confidence = 80
            notes.append("Clear bearish structure (LH-LL)")
            if price_vs_ema == "BELOW":
                confidence += 10
                notes.append("Price below EMA 200 confirms bearish bias")
            elif price_vs_ema == "ABOVE":
                confidence -= 20
                notes.append("⚠️ Price above EMA 200 conflicts with bearish structure")
        
        elif structure in [MarketStructure.HH_LL, MarketStructure.LH_HL]:
            confidence = 30
            notes.append("Mixed/ranging structure - NO TRADE recommended")
        
        else:
            confidence = 0
            notes.append("Unclear structure - cannot determine bias")
        
        return StructureAnalysis(
            timeframe=timeframe,
            structure=structure,
            trend_bias=trend_bias,
            swing_points=swings,
            last_hh=points.get('last_hh'),
            last_hl=points.get('last_hl'),
            last_lh=points.get('last_lh'),
            last_ll=points.get('last_ll'),
            ema_200=ema_200,
            price_vs_ema=price_vs_ema,
            confidence=confidence,
            notes=notes
        )
    
    def calculate_price_position(
        self,
        current_price: float,
        swing_high: float,
        swing_low: float
    ) -> PricePosition:
        """
        Hitung posisi harga dalam range
        
        Premium (>60%): Area SELL
        Discount (<40%): Area BUY
        Middle (40-60%): NO TRADE
        """
        if swing_high == swing_low:
            return PricePosition.MIDDLE
        
        range_size = swing_high - swing_low
        position = (current_price - swing_low) / range_size
        
        logger.info(f"Price position in range: {position*100:.1f}%")
        
        if position > 0.8:
            return PricePosition.EXTREME_HIGH
        elif position > self.PREMIUM_THRESHOLD:
            return PricePosition.PREMIUM
        elif position < 0.2:
            return PricePosition.EXTREME_LOW
        elif position < self.DISCOUNT_THRESHOLD:
            return PricePosition.DISCOUNT
        else:
            return PricePosition.MIDDLE
    
    def check_hierarchy_alignment(
        self,
        h4_bias: TrendBias,
        h1_bias: TrendBias,
        m15_bias: Optional[TrendBias] = None
    ) -> Tuple[bool, List[str]]:
        """
        Check if all timeframes are aligned with H4 (TREND BOSS)
        
        🔒 RULE: H4 is the final authority
        - H1 MUST align with H4
        - M15 SHOULD align (optional but preferred)
        - Lower TFs are ignored for bias determination
        """
        reasons = []
        
        # H4 must have clear direction
        if h4_bias == TrendBias.NO_TRADE:
            reasons.append("❌ H4 has no clear trend - NO TRADE")
            return False, reasons
        
        # H1 MUST align with H4
        if h1_bias != h4_bias and h1_bias != TrendBias.NO_TRADE:
            reasons.append(f"❌ H1 ({h1_bias.value}) conflicts with H4 ({h4_bias.value}) - HIERARCHY VIOLATION")
            return False, reasons
        
        if h1_bias == TrendBias.NO_TRADE:
            reasons.append("⚠️ H1 structure unclear - waiting for alignment")
            # Allow if H4 is clear
        
        # M15 check (optional but adds confidence)
        if m15_bias and m15_bias != h4_bias and m15_bias != TrendBias.NO_TRADE:
            reasons.append(f"⚠️ M15 ({m15_bias.value}) not aligned with H4 - timing may not be ideal")
            # Don't reject, just note it
        
        reasons.append(f"✅ Hierarchy aligned: H4={h4_bias.value}")
        return True, reasons
    
    def analyze_mtf(
        self,
        h4_candles: List[OHLC],
        h1_candles: List[OHLC],
        m15_candles: List[OHLC],
        m5_candles: Optional[List[OHLC]] = None,
        zones: Optional[List[ZoneInfo]] = None
    ) -> MTFAnalysisResult:
        """
        🎯 MAIN ANALYSIS METHOD
        
        Melakukan analisis multi-timeframe lengkap dengan hierarchy lock.
        
        Args:
            h4_candles: H4 candlestick data
            h1_candles: H1 candlestick data
            m15_candles: M15 candlestick data
            m5_candles: M5 candlestick data (optional)
            zones: Supply/Demand zones (optional)
        
        Returns:
            MTFAnalysisResult dengan keputusan final
        """
        logger.info("\n" + "=" * 60)
        logger.info("🔒 MTF HIERARCHY ANALYSIS - STARTING")
        logger.info("=" * 60)
        
        result = MTFAnalysisResult()
        
        # Step 1: Analyze H4 (TREND BOSS)
        logger.info("\n📌 STEP 1: ANALYZE H4 (TREND BOSS)")
        result.h4_analysis = self.analyze_single_timeframe(h4_candles, Timeframe.H4)
        
        if result.h4_analysis.trend_bias == TrendBias.NO_TRADE:
            result.rejection_reasons.append("H4 structure unclear (not HH-HL or LH-LL)")
            result.rejection_reasons.append("🚫 NO TRADE: Cannot determine market direction from H4")
            logger.warning("❌ H4 has no clear trend - ANALYSIS STOPPED")
            return result
        
        # Step 2: Analyze H1 (Structure Validation)
        logger.info("\n📌 STEP 2: ANALYZE H1 (STRUCTURE VALIDATION)")
        result.h1_analysis = self.analyze_single_timeframe(h1_candles, Timeframe.H1)
        
        # Step 3: Check Hierarchy Alignment
        logger.info("\n📌 STEP 3: CHECK HIERARCHY ALIGNMENT")
        aligned, alignment_reasons = self.check_hierarchy_alignment(
            result.h4_analysis.trend_bias,
            result.h1_analysis.trend_bias
        )
        result.hierarchy_aligned = aligned
        
        if not aligned:
            result.rejection_reasons.extend(alignment_reasons)
            logger.warning("❌ Hierarchy NOT aligned - NO TRADE")
            return result
        
        # Step 4: Analyze M15 (Confirmation)
        logger.info("\n📌 STEP 4: ANALYZE M15 (CONFIRMATION)")
        result.m15_analysis = self.analyze_single_timeframe(m15_candles, Timeframe.M15)
        
        # Step 5: Analyze M5 if provided (Entry timing)
        if m5_candles:
            logger.info("\n📌 STEP 5: ANALYZE M5 (ENTRY TIMING)")
            result.m5_analysis = self.analyze_single_timeframe(m5_candles, Timeframe.M5)
        
        # Step 6: Set final bias from H4 (ALWAYS)
        result.final_bias = result.h4_analysis.trend_bias
        logger.info(f"\n🎯 FINAL BIAS (from H4): {result.final_bias.value}")
        
        # Step 7: Calculate price position
        current_price = h4_candles[-1].close if h4_candles else 0
        
        # Get recent swing high/low from H4
        swing_highs = [s.price for s in result.h4_analysis.swing_points if s.is_high]
        swing_lows = [s.price for s in result.h4_analysis.swing_points if not s.is_high]
        
        if swing_highs and swing_lows:
            recent_high = max(swing_highs[-3:]) if len(swing_highs) >= 3 else max(swing_highs)
            recent_low = min(swing_lows[-3:]) if len(swing_lows) >= 3 else min(swing_lows)
            
            result.price_position = self.calculate_price_position(
                current_price, recent_high, recent_low
            )
            
            # Validate price position vs bias
            if result.final_bias == TrendBias.BULLISH and result.price_position == PricePosition.PREMIUM:
                result.rejection_reasons.append("⚠️ Bullish bias but price in PREMIUM zone - wait for pullback")
            elif result.final_bias == TrendBias.BEARISH and result.price_position == PricePosition.DISCOUNT:
                result.rejection_reasons.append("⚠️ Bearish bias but price in DISCOUNT zone - wait for pullback")
            elif result.price_position == PricePosition.MIDDLE:
                result.rejection_reasons.append("❌ Price in MIDDLE of range - NO TRADE")
        
        # Step 8: Check zones
        if zones:
            logger.info("\n📌 STEP 6: CHECK SUPPLY/DEMAND ZONES")
            for zone in zones:
                if zone.is_price_in_zone(current_price):
                    # Validate zone type matches bias
                    if result.final_bias == TrendBias.BULLISH and zone.zone_type == "demand":
                        result.relevant_zone = zone
                        result.in_zone = True
                        logger.info(f"✅ Price in DEMAND zone (matches bullish bias)")
                    elif result.final_bias == TrendBias.BEARISH and zone.zone_type == "supply":
                        result.relevant_zone = zone
                        result.in_zone = True
                        logger.info(f"✅ Price in SUPPLY zone (matches bearish bias)")
                    else:
                        logger.info(f"⚠️ Price in {zone.zone_type.upper()} zone but doesn't match bias")
        
        # Step 9: Determine if we can trade
        can_trade = True
        confidence = result.h4_analysis.confidence
        
        # Apply hierarchy confidence multiplier
        if result.h1_analysis.trend_bias == result.h4_analysis.trend_bias:
            confidence = min(100, confidence + 10)
        
        if result.m15_analysis and result.m15_analysis.trend_bias == result.h4_analysis.trend_bias:
            confidence = min(100, confidence + 5)
        
        # Check price position
        if result.price_position == PricePosition.MIDDLE:
            can_trade = False
            confidence -= 30
        
        # Check if in valid zone
        if result.in_zone:
            confidence = min(100, confidence + 15)
        
        result.overall_confidence = max(0, confidence)
        result.can_trade = can_trade and confidence >= self.MIN_CONFIDENCE and len(result.rejection_reasons) == 0
        
        # Final summary
        logger.info("\n" + "=" * 60)
        logger.info("📋 MTF ANALYSIS SUMMARY")
        logger.info("=" * 60)
        logger.info(f"H4 Trend Boss: {result.h4_analysis.trend_bias.value} ({result.h4_analysis.structure.value})")
        logger.info(f"H1 Validation: {result.h1_analysis.trend_bias.value} ({result.h1_analysis.structure.value})")
        if result.m15_analysis:
            logger.info(f"M15 Confirmation: {result.m15_analysis.trend_bias.value}")
        logger.info(f"Hierarchy Aligned: {'✅ YES' if result.hierarchy_aligned else '❌ NO'}")
        logger.info(f"Price Position: {result.price_position.value}")
        logger.info(f"In Valid Zone: {'✅ YES' if result.in_zone else '❌ NO'}")
        logger.info(f"Overall Confidence: {result.overall_confidence}%")
        logger.info(f"CAN TRADE: {'✅ YES' if result.can_trade else '❌ NO'}")
        
        if result.rejection_reasons:
            logger.info("\n⚠️ REJECTION REASONS:")
            for reason in result.rejection_reasons:
                logger.info(f"  - {reason}")
        
        return result
