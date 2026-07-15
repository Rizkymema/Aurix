"""
AI TRADING SYSTEM CORE - Professional Signal Generator
=======================================================
Sistem trading berbasis AI dengan multi-timeframe hierarchy lock dan validasi ketat.

🎯 PRINSIP INTI:
1. Fokus pada market structure dan price action, bukan indikator semata
2. Lebih baik sedikit signal tapi berkualitas, daripada banyak tapi tidak konsisten
3. Sistem ini mengikuti market, bukan menebak market

🔒 ATURAN HIERARKI TIME FRAME (MUTLAK):
  H4 = Trend Boss (arah final)
  H1 = Validasi struktur  
  M15 = Konfirmasi & timing
  M5/M1 = Entry ONLY

📊 LOGIKA ANALISIS (URUT & DISIPLIN):
1. Deteksi struktur market di H4: HH-HL→BUY, LH-LL→SELL, Tidak jelas→NO TRADE
2. Validasi struktur di H1 (harus searah H4)
3. Pastikan harga tidak di tengah range
4. Konfirmasi zona Supply/Demand yang relevan
5. Tunggu pullback, bukan entry breakout
6. Entry hanya jika ada price action valid di M5/M1

🎯 KRITERIA SIGNAL VALID:
- Arah WAJIB searah trend H4
- Harga di zona penting (S/D)
- RRR minimal 1:2
- Tidak ada high impact news aktif
- Candle pattern hanya konfirmasi

Author: AI Trading System
Version: 2.0.0
"""

from dataclasses import dataclass, field
from typing import Dict, Any, Optional, List, Tuple
from enum import Enum
from datetime import datetime
import logging
import json
import asyncio

from mtf_hierarchy_system import (
    MTFHierarchyAnalyzer,
    MTFAnalysisResult,
    TrendBias,
    PricePosition,
    MarketStructure,
    ZoneInfo,
    OHLC,
    Timeframe
)
from news_filter import NewsFilter, NewsEvent

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class EntryPattern(Enum):
    """Valid entry patterns di M5/M1"""
    ENGULFING_BULLISH = "engulfing_bullish"
    ENGULFING_BEARISH = "engulfing_bearish"
    REJECTION_BULLISH = "rejection_bullish"
    REJECTION_BEARISH = "rejection_bearish"
    BREAK_RETEST_BULLISH = "break_retest_bullish"
    BREAK_RETEST_BEARISH = "break_retest_bearish"
    PINBAR_BULLISH = "pinbar_bullish"
    PINBAR_BEARISH = "pinbar_bearish"
    INSIDE_BAR_BREAK = "inside_bar_break"
    NONE = "none"


class SignalStatus(Enum):
    """Status signal"""
    VALID = "VALID"
    NO_TRADE = "NO_TRADE"
    PENDING = "PENDING"


@dataclass
class RiskRewardAnalysis:
    """Analisis Risk/Reward"""
    entry: float
    stop_loss: float
    take_profit_1: float
    take_profit_2: float
    risk_pips: float
    reward_pips_tp1: float
    reward_pips_tp2: float
    rrr_tp1: float
    rrr_tp2: float
    is_valid: bool
    notes: str = ""
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'entry': round(self.entry, 5),
            'stop_loss': round(self.stop_loss, 5),
            'take_profit_1': round(self.take_profit_1, 5),
            'take_profit_2': round(self.take_profit_2, 5),
            'risk_pips': round(self.risk_pips, 1),
            'reward_pips_tp1': round(self.reward_pips_tp1, 1),
            'reward_pips_tp2': round(self.reward_pips_tp2, 1),
            'rrr_tp1': round(self.rrr_tp1, 2),
            'rrr_tp2': round(self.rrr_tp2, 2),
            'is_valid': self.is_valid,
            'notes': self.notes
        }


@dataclass
class TradingSignal:
    """
    Output Signal Final
    
    Jika SIGNAL VALID:
    - Pair, Arah, Trend H4, Zona Entry
    - SL (di luar struktur), TP1, TP2
    - RRR, Validity Score, Why This Signal
    
    Jika TIDAK VALID:
    - Status: NO_TRADE
    - Alasan jelas
    """
    # Signal Identity
    signal_id: str
    timestamp: datetime
    symbol: str
    
    # Signal Status
    status: SignalStatus
    direction: Optional[str] = None  # 'BUY' or 'SELL'
    
    # Trend Analysis
    h4_trend: Optional[str] = None
    h4_structure: Optional[str] = None
    h1_structure: Optional[str] = None
    hierarchy_aligned: bool = False
    
    # Entry Zone
    entry_zone: Optional[str] = None
    zone_type: Optional[str] = None
    zone_strength: int = 0
    
    # Trade Levels
    entry_price: Optional[float] = None
    stop_loss: Optional[float] = None
    take_profit_1: Optional[float] = None
    take_profit_2: Optional[float] = None
    
    # Risk Analysis
    risk_pips: float = 0
    reward_pips_tp1: float = 0
    reward_pips_tp2: float = 0
    rrr_tp1: float = 0
    rrr_tp2: float = 0
    
    # Validation
    validity_score: int = 0
    quality_grade: str = "F"
    
    # Entry Pattern
    entry_pattern: Optional[str] = None
    entry_timeframe: str = "M5"
    
    # News Filter
    news_clear: bool = True
    upcoming_news: List[str] = field(default_factory=list)
    
    # Explanation
    why_this_signal: str = ""
    technical_reasons: List[str] = field(default_factory=list)
    rejection_reasons: List[str] = field(default_factory=list)
    
    # Raw Analysis
    mtf_analysis: Optional[Dict] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for API response"""
        if self.status == SignalStatus.NO_TRADE:
            return {
                'status': 'NO_TRADE',
                'symbol': self.symbol,
                'timestamp': self.timestamp.isoformat(),
                'signal_id': self.signal_id,
                'rejection_reasons': self.rejection_reasons,
                'h4_trend': self.h4_trend,
                'h4_structure': self.h4_structure,
                'hierarchy_aligned': self.hierarchy_aligned,
                'news_clear': self.news_clear,
                'upcoming_news': self.upcoming_news
            }
        
        return {
            'status': self.status.value,
            'signal_id': self.signal_id,
            'timestamp': self.timestamp.isoformat(),
            'symbol': self.symbol,
            'direction': self.direction,
            
            'trend_analysis': {
                'h4_trend': self.h4_trend,
                'h4_structure': self.h4_structure,
                'h1_structure': self.h1_structure,
                'hierarchy_aligned': self.hierarchy_aligned
            },
            
            'entry_zone': {
                'description': self.entry_zone,
                'type': self.zone_type,
                'strength': self.zone_strength
            },
            
            'trade_levels': {
                'entry': round(self.entry_price, 5) if self.entry_price else None,
                'stop_loss': round(self.stop_loss, 5) if self.stop_loss else None,
                'take_profit_1': round(self.take_profit_1, 5) if self.take_profit_1 else None,
                'take_profit_2': round(self.take_profit_2, 5) if self.take_profit_2 else None
            },
            
            'risk_reward': {
                'risk_pips': round(self.risk_pips, 1),
                'reward_pips_tp1': round(self.reward_pips_tp1, 1),
                'reward_pips_tp2': round(self.reward_pips_tp2, 1),
                'rrr_tp1': round(self.rrr_tp1, 2),
                'rrr_tp2': round(self.rrr_tp2, 2)
            },
            
            'validation': {
                'validity_score': self.validity_score,
                'quality_grade': self.quality_grade
            },
            
            'entry_confirmation': {
                'pattern': self.entry_pattern,
                'timeframe': self.entry_timeframe
            },
            
            'news_filter': {
                'clear': self.news_clear,
                'upcoming': self.upcoming_news
            },
            
            'why_this_signal': self.why_this_signal,
            'technical_reasons': self.technical_reasons
        }
    
    def to_json(self) -> str:
        """Convert to JSON string"""
        return json.dumps(self.to_dict(), indent=2)


class AITradingSystemCore:
    """
    🤖 AI TRADING SYSTEM CORE
    
    Sistem trading profesional dengan aturan ketat:
    
    1. Multi-Timeframe Hierarchy Lock (H4 > H1 > M15 > M5/M1)
    2. Market Structure Detection (HH-HL / LH-LL)
    3. Supply/Demand Zone Validation
    4. Price Action Entry Confirmation
    5. News Filter Integration
    6. Risk/Reward Validation (min 1:2)
    
    🚫 LARANGAN KERAS:
    - Dilarang generate signal dari M1/M5 tanpa konfirmasi H4
    - Dilarang entry di tengah market
    - Dilarang memberi skor tinggi jika melawan trend
    - Dilarang memaksakan signal saat market sideways
    """
    
    # Configuration
    MIN_RRR = 2.0
    MIN_VALIDITY_SCORE = 60
    PIP_VALUE = 0.0001  # For forex pairs (0.01 for JPY pairs)
    
    def __init__(
        self,
        min_rrr: float = 2.0,
        min_validity_score: int = 60,
        news_buffer_minutes: int = 30
    ):
        """
        Initialize AI Trading System Core
        
        Args:
            min_rrr: Minimum Risk/Reward Ratio (default: 2.0)
            min_validity_score: Minimum validity score untuk signal valid (default: 60)
            news_buffer_minutes: Buffer waktu sebelum news high impact (default: 30)
        """
        self.min_rrr = min_rrr
        self.min_validity_score = min_validity_score
        
        # Initialize components
        self.mtf_analyzer = MTFHierarchyAnalyzer()
        self.news_filter = NewsFilter(buffer_minutes=news_buffer_minutes)
        
        logger.info("=" * 60)
        logger.info("🤖 AI TRADING SYSTEM CORE INITIALIZED")
        logger.info("=" * 60)
        logger.info(f"📊 Min RRR: {min_rrr}")
        logger.info(f"📈 Min Validity Score: {min_validity_score}")
        logger.info(f"📰 News Buffer: {news_buffer_minutes} minutes")
        logger.info("🔒 Hierarchy: H4 (Boss) > H1 > M15 > M5/M1")
    
    def get_pip_value(self, symbol: str) -> float:
        """Get pip value based on symbol"""
        if "JPY" in symbol.upper():
            return 0.01
        elif "XAU" in symbol.upper():
            return 0.1
        elif "BTC" in symbol.upper() or "ETH" in symbol.upper():
            return 1.0
        return 0.0001
    
    def calculate_pips(self, price1: float, price2: float, symbol: str) -> float:
        """Calculate pips between two prices"""
        pip_value = self.get_pip_value(symbol)
        return abs(price1 - price2) / pip_value
    
    def detect_entry_pattern(
        self,
        candles: List[OHLC],
        direction: str
    ) -> Tuple[EntryPattern, str]:
        """
        Deteksi pattern entry yang valid di M5/M1
        
        Valid patterns:
        - Engulfing (bullish/bearish)
        - Rejection / Pinbar
        - Break & Retest
        - Inside Bar Break
        """
        if len(candles) < 3:
            return EntryPattern.NONE, "Insufficient candles"
        
        last = candles[-1]
        prev = candles[-2]
        prev2 = candles[-3]
        
        # Engulfing Pattern
        if direction == "BUY":
            # Bullish Engulfing
            if prev.is_bearish and last.is_bullish:
                if last.close > prev.open and last.open < prev.close:
                    return EntryPattern.ENGULFING_BULLISH, "Bullish engulfing - strong reversal signal"
            
            # Bullish Pinbar / Rejection
            if last.is_bullish and last.lower_wick > last.body_size * 2:
                return EntryPattern.PINBAR_BULLISH, "Bullish pinbar with long lower wick - rejection from support"
            
            # Bullish Rejection
            if last.low < prev.low and last.close > prev.close:
                return EntryPattern.REJECTION_BULLISH, "Bullish rejection - false break down"
        
        else:  # SELL
            # Bearish Engulfing
            if prev.is_bullish and last.is_bearish:
                if last.close < prev.open and last.open > prev.close:
                    return EntryPattern.ENGULFING_BEARISH, "Bearish engulfing - strong reversal signal"
            
            # Bearish Pinbar / Rejection
            if last.is_bearish and last.upper_wick > last.body_size * 2:
                return EntryPattern.PINBAR_BEARISH, "Bearish pinbar with long upper wick - rejection from resistance"
            
            # Bearish Rejection
            if last.high > prev.high and last.close < prev.close:
                return EntryPattern.REJECTION_BEARISH, "Bearish rejection - false break up"
        
        # Inside Bar Break
        if prev.high < prev2.high and prev.low > prev2.low:  # prev is inside bar
            if direction == "BUY" and last.close > prev2.high:
                return EntryPattern.INSIDE_BAR_BREAK, "Inside bar break to the upside"
            elif direction == "SELL" and last.close < prev2.low:
                return EntryPattern.INSIDE_BAR_BREAK, "Inside bar break to the downside"
        
        return EntryPattern.NONE, "No valid entry pattern detected - wait for confirmation"
    
    def calculate_trade_levels(
        self,
        mtf_result: MTFAnalysisResult,
        current_price: float,
        symbol: str
    ) -> RiskRewardAnalysis:
        """
        Calculate Entry, SL, TP1, TP2 based on structure
        
        SL: Di luar struktur (swing point + buffer)
        TP1: 2x risk (1:2 RRR)
        TP2: 4x risk (1:4 RRR)
        """
        direction = mtf_result.final_bias.value
        h4 = mtf_result.h4_analysis
        pip_value = self.get_pip_value(symbol)
        
        entry = current_price
        stop_loss = 0
        
        # Get ATR for buffer calculation (simplified - using swing range)
        swing_highs = [s.price for s in h4.swing_points if s.is_high][-5:]
        swing_lows = [s.price for s in h4.swing_points if not s.is_high][-5:]
        
        avg_range = 0
        if swing_highs and swing_lows:
            avg_range = (max(swing_highs) - min(swing_lows)) / 10  # ~10% of range as buffer
        
        buffer = avg_range if avg_range > 0 else current_price * 0.001  # 0.1% fallback
        
        if direction == "BUY":
            # SL below swing low + buffer
            if h4.last_hl:
                stop_loss = h4.last_hl - buffer
            elif swing_lows:
                stop_loss = min(swing_lows[-3:]) - buffer
            else:
                stop_loss = entry - (buffer * 3)
            
            risk = entry - stop_loss
            take_profit_1 = entry + (risk * 2)  # 1:2 RRR
            take_profit_2 = entry + (risk * 4)  # 1:4 RRR
        
        else:  # SELL
            # SL above swing high + buffer
            if h4.last_lh:
                stop_loss = h4.last_lh + buffer
            elif swing_highs:
                stop_loss = max(swing_highs[-3:]) + buffer
            else:
                stop_loss = entry + (buffer * 3)
            
            risk = stop_loss - entry
            take_profit_1 = entry - (risk * 2)  # 1:2 RRR
            take_profit_2 = entry - (risk * 4)  # 1:4 RRR
        
        # Calculate pips
        risk_pips = self.calculate_pips(entry, stop_loss, symbol)
        reward_pips_tp1 = self.calculate_pips(entry, take_profit_1, symbol)
        reward_pips_tp2 = self.calculate_pips(entry, take_profit_2, symbol)
        
        # Calculate RRR
        rrr_tp1 = reward_pips_tp1 / risk_pips if risk_pips > 0 else 0
        rrr_tp2 = reward_pips_tp2 / risk_pips if risk_pips > 0 else 0
        
        is_valid = rrr_tp1 >= self.min_rrr
        notes = f"RRR TP1: 1:{rrr_tp1:.1f} | TP2: 1:{rrr_tp2:.1f}"
        
        if not is_valid:
            notes = f"❌ RRR insufficient (1:{rrr_tp1:.1f} < 1:{self.min_rrr})"
        
        return RiskRewardAnalysis(
            entry=entry,
            stop_loss=stop_loss,
            take_profit_1=take_profit_1,
            take_profit_2=take_profit_2,
            risk_pips=risk_pips,
            reward_pips_tp1=reward_pips_tp1,
            reward_pips_tp2=reward_pips_tp2,
            rrr_tp1=rrr_tp1,
            rrr_tp2=rrr_tp2,
            is_valid=is_valid,
            notes=notes
        )
    
    def calculate_validity_score(
        self,
        mtf_result: MTFAnalysisResult,
        rr_analysis: RiskRewardAnalysis,
        entry_pattern: EntryPattern,
        news_clear: bool,
        in_zone: bool
    ) -> Tuple[int, str, List[str]]:
        """
        Calculate validity score (0-100) dengan bobot
        
        Komponen:
        - H4 Trend clarity: 30%
        - Hierarchy alignment: 20%
        - RRR quality: 20%
        - Zone position: 15%
        - Entry pattern: 10%
        - News filter: 5%
        """
        score = 0
        grade = "F"
        reasons = []
        
        # 1. H4 Trend Clarity (30 points max)
        h4_score = 0
        if mtf_result.h4_analysis:
            if mtf_result.h4_analysis.structure in [MarketStructure.HH_HL, MarketStructure.LH_LL]:
                h4_score = 30
                reasons.append(f"✅ H4: Clear {mtf_result.h4_analysis.structure.value} structure")
            else:
                h4_score = 5
                reasons.append(f"❌ H4: Unclear structure ({mtf_result.h4_analysis.structure.value})")
        score += h4_score
        
        # 2. Hierarchy Alignment (20 points max)
        if mtf_result.hierarchy_aligned:
            score += 20
            reasons.append("✅ All timeframes aligned with H4")
        else:
            reasons.append("❌ Timeframe conflict detected")
        
        # 3. RRR Quality (20 points max)
        if rr_analysis.rrr_tp1 >= 3:
            score += 20
            reasons.append(f"✅ Excellent RRR: 1:{rr_analysis.rrr_tp1:.1f}")
        elif rr_analysis.rrr_tp1 >= 2:
            score += 15
            reasons.append(f"✅ Good RRR: 1:{rr_analysis.rrr_tp1:.1f}")
        elif rr_analysis.rrr_tp1 >= 1.5:
            score += 8
            reasons.append(f"⚠️ Acceptable RRR: 1:{rr_analysis.rrr_tp1:.1f}")
        else:
            reasons.append(f"❌ Poor RRR: 1:{rr_analysis.rrr_tp1:.1f}")
        
        # 4. Zone Position (15 points max)
        if in_zone:
            score += 15
            reasons.append("✅ Price in valid S/D zone")
        elif mtf_result.price_position in [PricePosition.DISCOUNT, PricePosition.PREMIUM]:
            score += 10
            reasons.append(f"⚠️ Price in {mtf_result.price_position.value} area")
        else:
            reasons.append("❌ Price in MIDDLE of range")
        
        # 5. Entry Pattern (10 points max)
        if entry_pattern != EntryPattern.NONE:
            score += 10
            reasons.append(f"✅ Entry pattern: {entry_pattern.value}")
        else:
            reasons.append("⚠️ No clear entry pattern yet")
        
        # 6. News Filter (5 points max)
        if news_clear:
            score += 5
            reasons.append("✅ No high impact news nearby")
        else:
            reasons.append("⚠️ High impact news approaching")
        
        # Determine grade
        if score >= 90:
            grade = "A+"
        elif score >= 80:
            grade = "A"
        elif score >= 70:
            grade = "B"
        elif score >= 60:
            grade = "C"
        elif score >= 50:
            grade = "D"
        else:
            grade = "F"
        
        return score, grade, reasons
    
    def generate_why_this_signal(
        self,
        signal: 'TradingSignal',
        mtf_result: MTFAnalysisResult
    ) -> str:
        """Generate explanation for the signal"""
        if signal.status == SignalStatus.NO_TRADE:
            return f"NO TRADE: {'; '.join(signal.rejection_reasons[:3])}"
        
        direction = "BELI" if signal.direction == "BUY" else "JUAL"
        zone_desc = f"zona {signal.zone_type}" if signal.zone_type else "area struktural"
        
        explanation = f"""📊 SIGNAL {direction} {signal.symbol}

🔒 ALASAN TEKNIKAL:
• H4 Trend: {signal.h4_trend} dengan struktur {signal.h4_structure}
• Hierarki: {'✅ Semua TF searah' if signal.hierarchy_aligned else '⚠️ Ada konflik TF'}
• Posisi: Harga di {zone_desc}
• Entry Pattern: {signal.entry_pattern or 'Menunggu konfirmasi'}

📈 RISK/REWARD:
• Entry: {signal.entry_price:.5f}
• SL: {signal.stop_loss:.5f} ({signal.risk_pips:.1f} pips)
• TP1: {signal.take_profit_1:.5f} (RRR 1:{signal.rrr_tp1:.1f})
• TP2: {signal.take_profit_2:.5f} (RRR 1:{signal.rrr_tp2:.1f})

🎯 VALIDITY: {signal.validity_score}/100 (Grade {signal.quality_grade})
"""
        return explanation.strip()
    
    async def analyze(
        self,
        symbol: str,
        h4_candles: List[OHLC],
        h1_candles: List[OHLC],
        m15_candles: List[OHLC],
        m5_candles: Optional[List[OHLC]] = None,
        zones: Optional[List[ZoneInfo]] = None
    ) -> TradingSignal:
        """
        🎯 MAIN ANALYSIS METHOD
        
        Melakukan analisis lengkap dan menghasilkan signal trading.
        
        Args:
            symbol: Trading pair (e.g., 'EURUSD', 'BTCUSDT')
            h4_candles: H4 candlestick data
            h1_candles: H1 candlestick data
            m15_candles: M15 candlestick data
            m5_candles: M5 candlestick data (optional)
            zones: Supply/Demand zones (optional)
        
        Returns:
            TradingSignal - Either VALID signal or NO_TRADE with reasons
        """
        logger.info("\n" + "=" * 70)
        logger.info(f"🤖 AI TRADING SYSTEM CORE - ANALYZING {symbol}")
        logger.info("=" * 70)
        
        signal_id = f"{symbol}-{datetime.now().strftime('%Y%m%d%H%M%S')}"
        timestamp = datetime.now()
        
        # Initialize signal
        signal = TradingSignal(
            signal_id=signal_id,
            timestamp=timestamp,
            symbol=symbol,
            status=SignalStatus.NO_TRADE
        )
        
        # ================================================
        # STEP 1: CHECK NEWS FILTER
        # ================================================
        logger.info("\n📰 STEP 1: CHECKING NEWS FILTER...")
        
        try:
            # Extract currency from symbol
            currency = symbol[:3] if len(symbol) >= 3 else None
            has_news = await self.news_filter.has_high_impact_news(currency)
            
            if has_news:
                upcoming = await self.news_filter.get_upcoming_high_impact(currency)
                signal.news_clear = False
                signal.upcoming_news = [f"{n.title} in {n.minutes_until():.0f}min" for n in upcoming]
                signal.rejection_reasons.append(f"⚠️ High impact news approaching: {signal.upcoming_news[0]}")
                logger.warning(f"❌ High impact news detected - blocking trade")
                # Don't return yet, continue analysis for educational purposes
            else:
                signal.news_clear = True
                logger.info("✅ No high impact news nearby")
        except Exception as e:
            logger.warning(f"News filter error: {e}")
            signal.news_clear = True  # Assume clear if error
        
        # ================================================
        # STEP 2: MULTI-TIMEFRAME ANALYSIS
        # ================================================
        logger.info("\n📊 STEP 2: MULTI-TIMEFRAME ANALYSIS...")
        
        try:
            mtf_result = self.mtf_analyzer.analyze_mtf(
                h4_candles=h4_candles,
                h1_candles=h1_candles,
                m15_candles=m15_candles,
                m5_candles=m5_candles,
                zones=zones
            )
            
            signal.mtf_analysis = mtf_result.to_dict()
            
            # Update signal with MTF analysis
            if mtf_result.h4_analysis:
                signal.h4_trend = mtf_result.h4_analysis.trend_bias.value
                signal.h4_structure = mtf_result.h4_analysis.structure.value
            
            if mtf_result.h1_analysis:
                signal.h1_structure = mtf_result.h1_analysis.structure.value
            
            signal.hierarchy_aligned = mtf_result.hierarchy_aligned
            
            # Check if we can trade
            if not mtf_result.can_trade or mtf_result.final_bias == TrendBias.NO_TRADE:
                signal.rejection_reasons.extend(mtf_result.rejection_reasons)
                if not mtf_result.rejection_reasons:
                    signal.rejection_reasons.append("Market structure unclear - cannot determine direction")
                logger.warning("❌ MTF analysis: NO TRADE")
                
                # Still generate why_this_signal for education
                signal.why_this_signal = self.generate_why_this_signal(signal, mtf_result)
                return signal
        
        except Exception as e:
            logger.error(f"MTF analysis error: {e}")
            signal.rejection_reasons.append(f"Analysis error: {str(e)}")
            return signal
        
        # ================================================
        # STEP 3: CALCULATE TRADE LEVELS
        # ================================================
        logger.info("\n📐 STEP 3: CALCULATING TRADE LEVELS...")
        
        current_price = h4_candles[-1].close if h4_candles else 0
        rr_analysis = self.calculate_trade_levels(mtf_result, current_price, symbol)
        
        if not rr_analysis.is_valid:
            signal.rejection_reasons.append(rr_analysis.notes)
            logger.warning(f"❌ RRR insufficient: {rr_analysis.notes}")
            signal.why_this_signal = self.generate_why_this_signal(signal, mtf_result)
            return signal
        
        # Update signal with trade levels
        signal.entry_price = rr_analysis.entry
        signal.stop_loss = rr_analysis.stop_loss
        signal.take_profit_1 = rr_analysis.take_profit_1
        signal.take_profit_2 = rr_analysis.take_profit_2
        signal.risk_pips = rr_analysis.risk_pips
        signal.reward_pips_tp1 = rr_analysis.reward_pips_tp1
        signal.reward_pips_tp2 = rr_analysis.reward_pips_tp2
        signal.rrr_tp1 = rr_analysis.rrr_tp1
        signal.rrr_tp2 = rr_analysis.rrr_tp2
        
        logger.info(f"✅ Trade levels calculated: Entry={rr_analysis.entry:.5f}, SL={rr_analysis.stop_loss:.5f}, TP1={rr_analysis.take_profit_1:.5f}")
        
        # ================================================
        # STEP 4: DETECT ENTRY PATTERN (M5/M1)
        # ================================================
        logger.info("\n🕯️ STEP 4: DETECTING ENTRY PATTERN...")
        
        direction = mtf_result.final_bias.value
        entry_candles = m5_candles if m5_candles else m15_candles
        entry_tf = "M5" if m5_candles else "M15"
        
        entry_pattern, pattern_note = self.detect_entry_pattern(entry_candles, direction)
        signal.entry_pattern = entry_pattern.value if entry_pattern != EntryPattern.NONE else None
        signal.entry_timeframe = entry_tf
        
        logger.info(f"Entry Pattern: {entry_pattern.value} - {pattern_note}")
        
        # ================================================
        # STEP 5: CHECK ZONE
        # ================================================
        if mtf_result.in_zone and mtf_result.relevant_zone:
            signal.entry_zone = f"{mtf_result.relevant_zone.zone_type.upper()} zone @ {mtf_result.relevant_zone.price_low:.5f}-{mtf_result.relevant_zone.price_high:.5f}"
            signal.zone_type = mtf_result.relevant_zone.zone_type
            signal.zone_strength = mtf_result.relevant_zone.strength
        
        # ================================================
        # STEP 6: CALCULATE VALIDITY SCORE
        # ================================================
        logger.info("\n📊 STEP 6: CALCULATING VALIDITY SCORE...")
        
        validity_score, grade, reasons = self.calculate_validity_score(
            mtf_result=mtf_result,
            rr_analysis=rr_analysis,
            entry_pattern=entry_pattern,
            news_clear=signal.news_clear,
            in_zone=mtf_result.in_zone
        )
        
        signal.validity_score = validity_score
        signal.quality_grade = grade
        signal.technical_reasons = reasons
        
        logger.info(f"Validity Score: {validity_score}/100 (Grade {grade})")
        
        # ================================================
        # STEP 7: FINAL DECISION
        # ================================================
        logger.info("\n🎯 STEP 7: FINAL DECISION...")
        
        # Check if signal is valid
        if validity_score < self.min_validity_score:
            signal.rejection_reasons.append(f"Validity score too low: {validity_score} < {self.min_validity_score}")
            logger.warning(f"❌ Signal rejected: validity score {validity_score} < {self.min_validity_score}")
            signal.why_this_signal = self.generate_why_this_signal(signal, mtf_result)
            return signal
        
        if not signal.news_clear:
            # Already added to rejection_reasons in step 1
            logger.warning("❌ Signal rejected: high impact news approaching")
            signal.why_this_signal = self.generate_why_this_signal(signal, mtf_result)
            return signal
        
        # ✅ SIGNAL IS VALID!
        signal.status = SignalStatus.VALID
        signal.direction = direction
        
        # Generate why this signal
        signal.why_this_signal = self.generate_why_this_signal(signal, mtf_result)
        
        logger.info("\n" + "=" * 70)
        logger.info(f"✅ VALID SIGNAL GENERATED!")
        logger.info("=" * 70)
        logger.info(f"Direction: {signal.direction}")
        logger.info(f"Entry: {signal.entry_price:.5f}")
        logger.info(f"SL: {signal.stop_loss:.5f} ({signal.risk_pips:.1f} pips)")
        logger.info(f"TP1: {signal.take_profit_1:.5f} (RRR 1:{signal.rrr_tp1:.1f})")
        logger.info(f"TP2: {signal.take_profit_2:.5f} (RRR 1:{signal.rrr_tp2:.1f})")
        logger.info(f"Validity: {signal.validity_score}/100 (Grade {signal.quality_grade})")
        
        return signal
    
    def analyze_sync(
        self,
        symbol: str,
        h4_candles: List[OHLC],
        h1_candles: List[OHLC],
        m15_candles: List[OHLC],
        m5_candles: Optional[List[OHLC]] = None,
        zones: Optional[List[ZoneInfo]] = None
    ) -> TradingSignal:
        """Synchronous version of analyze()"""
        return asyncio.run(self.analyze(
            symbol=symbol,
            h4_candles=h4_candles,
            h1_candles=h1_candles,
            m15_candles=m15_candles,
            m5_candles=m5_candles,
            zones=zones
        ))


# ================================================
# HELPER: Convert raw data to OHLC objects
# ================================================

def candles_to_ohlc(candles: List[Dict]) -> List[OHLC]:
    """Convert list of candle dicts to OHLC objects"""
    return [
        OHLC(
            time=c.get('time', 0),
            open=c.get('open', 0),
            high=c.get('high', 0),
            low=c.get('low', 0),
            close=c.get('close', 0),
            volume=c.get('volume', 0)
        )
        for c in candles
    ]


def zones_to_zoneinfo(zones: List[Dict]) -> List[ZoneInfo]:
    """Convert list of zone dicts to ZoneInfo objects"""
    return [
        ZoneInfo(
            zone_type=z.get('type', 'demand'),
            price_high=z.get('high', z.get('price_high', 0)),
            price_low=z.get('low', z.get('price_low', 0)),
            strength=z.get('strength', 50),
            timeframe=z.get('timeframe', 'H1'),
            status=z.get('status', 'fresh')
        )
        for z in zones
    ]


# ================================================
# EXAMPLE USAGE
# ================================================

if __name__ == "__main__":
    # Demo usage
    print("AI Trading System Core - Demo")
    print("=" * 50)
    
    # Initialize
    ai_system = AITradingSystemCore(
        min_rrr=2.0,
        min_validity_score=60,
        news_buffer_minutes=30
    )
    
    # In real usage, you would pass actual candle data
    # signal = ai_system.analyze_sync(
    #     symbol="EURUSD",
    #     h4_candles=h4_data,
    #     h1_candles=h1_data,
    #     m15_candles=m15_data,
    #     m5_candles=m5_data,
    #     zones=zones_data
    # )
    # 
    # print(signal.to_json())
    
    print("\n✅ AI Trading System Core ready!")
    print("Use ai_system.analyze() or ai_system.analyze_sync() to generate signals")
