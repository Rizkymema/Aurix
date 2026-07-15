"""
StrategyEngine - Otak yang Menentukan Arah Trading
===================================================
Menganalisa data market untuk menghasilkan keputusan Entry yang presisi.

Logic (Legacy):
- Trend Filter: EMA 200 untuk filter arah
- Trigger: EMA 9 & EMA 21 crossover searah tren
- SL: Swing Low/High terakhir
- TP: Minimal 2.0x jarak SL (RRR 1:2.0)

Institutional Mode (New):
- 11-step scoring pipeline (market context → grading → discipline)
- Grades: A+ ≥ 90, A 80-89, B 70-79, <70 → NO_TRADE
- Anti-revenge cooldown after consecutive losses
- Full score breakdown with step-by-step audit trail
"""

import numpy as np
from dataclasses import dataclass
from typing import Optional, List, Dict, Any
from datetime import datetime
import logging

try:
    from institutional_engine import (
        run_institutional_engine,
        DisciplineState,
        InstitutionalOutput,
        record_trade_result,
        tick_cooldown,
    )
    HAS_INSTITUTIONAL = True
except ImportError:
    HAS_INSTITUTIONAL = False

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@dataclass
class TradeSignal:
    """Data class untuk sinyal trading"""
    action: str  # 'BUY' atau 'SELL'
    entry_price: float
    stop_loss: float
    take_profit: float
    swing_point: float
    ema_9: float
    ema_21: float
    ema_200: float
    risk_reward_ratio: float
    confidence: float
    timestamp: datetime
    reason: str
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'action': self.action,
            'entry_price': round(self.entry_price, 5),
            'sl': round(self.stop_loss, 5),
            'tp': round(self.take_profit, 5),
            'swing_point': round(self.swing_point, 5),
            'ema_9': round(self.ema_9, 5),
            'ema_21': round(self.ema_21, 5),
            'ema_200': round(self.ema_200, 5),
            'risk_reward_ratio': round(self.risk_reward_ratio, 2),
            'confidence': round(self.confidence, 2),
            'timestamp': self.timestamp.isoformat(),
            'reason': self.reason
        }


class StrategyEngine:
    """
    Quant Strategy Engine untuk analisis market
    
    Strategi:
    1. Trend Filter menggunakan EMA 200
    2. Entry trigger dengan EMA 9/21 crossover
    3. Stop Loss di Swing Low/High terakhir
    4. Take Profit dengan RRR minimal 1:1.5
    """
    
    def __init__(
        self,
        ema_fast: int = 9,
        ema_medium: int = 21,
        ema_slow: int = 200,
        swing_lookback: int = 10,
        min_rrr: float = 2.0,
        min_confidence: float = 70.0,
        institutional_mode: bool = True
    ):
        """
        Initialize Strategy Engine
        
        Args:
            ema_fast: Period EMA cepat (default: 9)
            ema_medium: Period EMA medium (default: 21)
            ema_slow: Period EMA lambat untuk trend filter (default: 200)
            swing_lookback: Periode untuk deteksi swing point (default: 10)
            min_rrr: Minimum Risk Reward Ratio (default: 2.0)
            min_confidence: Minimum confidence untuk signal (default: 70)
            institutional_mode: Use 11-step institutional engine (default: True)
        """
        self.ema_fast = ema_fast
        self.ema_medium = ema_medium
        self.ema_slow = ema_slow
        self.swing_lookback = swing_lookback
        self.min_rrr = min_rrr
        self.min_confidence = min_confidence
        self.institutional_mode = institutional_mode and HAS_INSTITUTIONAL
        
        # State untuk tracking crossover
        self._prev_ema_fast = None
        self._prev_ema_medium = None
        
        # Institutional discipline state
        self._discipline = DisciplineState() if HAS_INSTITUTIONAL else None
        
        logger.info(f"StrategyEngine initialized with EMA {ema_fast}/{ema_medium}/{ema_slow}")
        if self.institutional_mode:
            logger.info("📊 Institutional 11-step engine ACTIVE (min RRR 2.0, grade ≥ B)")
    
    def calculate_ema(self, data: np.ndarray, period: int) -> np.ndarray:
        """
        Menghitung Exponential Moving Average
        
        Args:
            data: Array harga (close prices)
            period: Periode EMA
            
        Returns:
            Array EMA values
        """
        if len(data) < period:
            return np.array([])
        
        multiplier = 2 / (period + 1)
        ema = np.zeros(len(data))
        
        # SMA untuk nilai awal
        ema[period - 1] = np.mean(data[:period])
        
        # Hitung EMA
        for i in range(period, len(data)):
            ema[i] = (data[i] * multiplier) + (ema[i - 1] * (1 - multiplier))
        
        return ema
    
    def find_swing_low(self, lows: np.ndarray, lookback: int) -> float:
        """
        Mencari Swing Low terakhir
        
        Args:
            lows: Array harga low
            lookback: Periode lookback
            
        Returns:
            Nilai Swing Low
        """
        if len(lows) < lookback * 2 + 1:
            return lows[-lookback:].min() if len(lows) >= lookback else lows.min()
        
        swing_lows = []
        for i in range(lookback, len(lows) - lookback):
            # Cek apakah titik ini adalah local minimum
            if lows[i] == min(lows[i - lookback:i + lookback + 1]):
                swing_lows.append((i, lows[i]))
        
        if swing_lows:
            # Return swing low terakhir
            return swing_lows[-1][1]
        
        # Fallback: return low terendah dalam lookback terakhir
        return lows[-lookback:].min()
    
    def find_swing_high(self, highs: np.ndarray, lookback: int) -> float:
        """
        Mencari Swing High terakhir
        
        Args:
            highs: Array harga high
            lookback: Periode lookback
            
        Returns:
            Nilai Swing High
        """
        if len(highs) < lookback * 2 + 1:
            return highs[-lookback:].max() if len(highs) >= lookback else highs.max()
        
        swing_highs = []
        for i in range(lookback, len(highs) - lookback):
            # Cek apakah titik ini adalah local maximum
            if highs[i] == max(highs[i - lookback:i + lookback + 1]):
                swing_highs.append((i, highs[i]))
        
        if swing_highs:
            # Return swing high terakhir
            return swing_highs[-1][1]
        
        # Fallback: return high tertinggi dalam lookback terakhir
        return highs[-lookback:].max()
    
    def detect_crossover(
        self, 
        ema_fast_current: float, 
        ema_medium_current: float,
        ema_fast_prev: float,
        ema_medium_prev: float
    ) -> Optional[str]:
        """
        Mendeteksi EMA crossover
        
        Args:
            ema_fast_current: EMA cepat saat ini
            ema_medium_current: EMA medium saat ini
            ema_fast_prev: EMA cepat sebelumnya
            ema_medium_prev: EMA medium sebelumnya
            
        Returns:
            'BULLISH' untuk golden cross, 'BEARISH' untuk death cross, None jika tidak ada
        """
        # Golden Cross: EMA fast crosses above EMA medium
        if ema_fast_prev <= ema_medium_prev and ema_fast_current > ema_medium_current:
            return 'BULLISH'
        
        # Death Cross: EMA fast crosses below EMA medium
        if ema_fast_prev >= ema_medium_prev and ema_fast_current < ema_medium_current:
            return 'BEARISH'
        
        return None
    
    def calculate_confidence(
        self,
        action: str,
        close: float,
        ema_9: float,
        ema_21: float,
        ema_200: float,
        volume_ratio: float = 1.0
    ) -> float:
        """
        Menghitung confidence level sinyal
        
        Args:
            action: 'BUY' atau 'SELL'
            close: Harga close saat ini
            ema_9/21/200: Nilai EMA
            volume_ratio: Rasio volume vs average (opsional)
            
        Returns:
            Confidence score 0-100
        """
        confidence = 0.0
        
        if action == 'BUY':
            # Trend alignment
            if close > ema_200:
                confidence += 25  # Above EMA 200
            if ema_9 > ema_21:
                confidence += 20  # EMA alignment
            if ema_21 > ema_200:
                confidence += 15  # Strong uptrend
            
            # Price position
            price_above_ema9 = (close - ema_9) / close * 100
            if 0 < price_above_ema9 < 1:
                confidence += 15  # Near EMA 9 (good entry)
            elif price_above_ema9 > 2:
                confidence -= 10  # Too extended
            
        elif action == 'SELL':
            # Trend alignment
            if close < ema_200:
                confidence += 25  # Below EMA 200
            if ema_9 < ema_21:
                confidence += 20  # EMA alignment
            if ema_21 < ema_200:
                confidence += 15  # Strong downtrend
            
            # Price position
            price_below_ema9 = (ema_9 - close) / close * 100
            if 0 < price_below_ema9 < 1:
                confidence += 15  # Near EMA 9 (good entry)
            elif price_below_ema9 > 2:
                confidence -= 10  # Too extended
        
        # Volume confirmation
        if volume_ratio > 1.2:
            confidence += 15  # Above average volume
        elif volume_ratio > 1.5:
            confidence += 25  # High volume
        
        # Clamp to 0-100
        return max(0, min(100, confidence))
    
    def get_signal(self, ohlcv_data: List[Dict[str, Any]]) -> Optional[TradeSignal]:
        """
        Menganalisa data OHLCV dan menghasilkan sinyal trading
        
        Args:
            ohlcv_data: List of OHLCV data dengan format:
                [{'open': x, 'high': x, 'low': x, 'close': x, 'volume': x, 'timestamp': x}, ...]
                
        Returns:
            TradeSignal object jika ada sinyal valid, None jika tidak ada
        """
        # Validasi data minimum
        min_candles = max(self.ema_slow + 10, 250)
        if len(ohlcv_data) < min_candles:
            logger.warning(f"Data tidak cukup. Butuh minimal {min_candles} candles, dapat {len(ohlcv_data)}")
            return None
        
        # Convert to numpy arrays
        opens = np.array([c['open'] for c in ohlcv_data])
        highs = np.array([c['high'] for c in ohlcv_data])
        lows = np.array([c['low'] for c in ohlcv_data])
        closes = np.array([c['close'] for c in ohlcv_data])
        volumes = np.array([c.get('volume', 0) for c in ohlcv_data])
        
        # Hitung EMA
        ema_9 = self.calculate_ema(closes, self.ema_fast)
        ema_21 = self.calculate_ema(closes, self.ema_medium)
        ema_200 = self.calculate_ema(closes, self.ema_slow)
        
        # Ambil nilai terkini
        current_close = closes[-1]
        current_ema_9 = ema_9[-1]
        current_ema_21 = ema_21[-1]
        current_ema_200 = ema_200[-1]
        
        prev_ema_9 = ema_9[-2] if len(ema_9) > 1 else current_ema_9
        prev_ema_21 = ema_21[-2] if len(ema_21) > 1 else current_ema_21
        
        # Hitung volume ratio
        avg_volume = np.mean(volumes[-20:]) if len(volumes) >= 20 else np.mean(volumes)
        current_volume = volumes[-1]
        volume_ratio = current_volume / avg_volume if avg_volume > 0 else 1.0
        
        # =======================
        # STEP 1: TREND FILTER (EMA 200)
        # =======================
        is_uptrend = current_close > current_ema_200
        is_downtrend = current_close < current_ema_200
        
        if not is_uptrend and not is_downtrend:
            logger.info("Harga tepat di EMA 200, tidak ada sinyal")
            return None
        
        # =======================
        # STEP 2: ENTRY TRIGGER (EMA 9/21 Crossover)
        # =======================
        crossover = self.detect_crossover(
            current_ema_9, current_ema_21,
            prev_ema_9, prev_ema_21
        )
        
        if crossover is None:
            logger.debug("Tidak ada crossover, tidak ada sinyal")
            return None
        
        # Validasi crossover searah trend
        action = None
        reason_parts = []
        
        if crossover == 'BULLISH' and is_uptrend:
            action = 'BUY'
            reason_parts.append("Golden Cross (EMA 9 > EMA 21)")
            reason_parts.append(f"Harga di atas EMA 200 ({current_close:.2f} > {current_ema_200:.2f})")
            
        elif crossover == 'BEARISH' and is_downtrend:
            action = 'SELL'
            reason_parts.append("Death Cross (EMA 9 < EMA 21)")
            reason_parts.append(f"Harga di bawah EMA 200 ({current_close:.2f} < {current_ema_200:.2f})")
        
        else:
            logger.info(f"Crossover {crossover} tidak searah trend ({'UP' if is_uptrend else 'DOWN'})")
            return None
        
        # =======================
        # STEP 3: CALCULATE SL (Swing Low/High)
        # =======================
        entry_price = current_close
        
        if action == 'BUY':
            # SL di Swing Low terakhir
            swing_low = self.find_swing_low(lows, self.swing_lookback)
            stop_loss = swing_low - (swing_low * 0.001)  # Sedikit di bawah swing low
            swing_point = swing_low
            reason_parts.append(f"SL di Swing Low: {swing_low:.2f}")
            
        else:  # SELL
            # SL di Swing High terakhir
            swing_high = self.find_swing_high(highs, self.swing_lookback)
            stop_loss = swing_high + (swing_high * 0.001)  # Sedikit di atas swing high
            swing_point = swing_high
            reason_parts.append(f"SL di Swing High: {swing_high:.2f}")
        
        # =======================
        # STEP 4: CALCULATE TP (RRR 1:1.5 minimum)
        # =======================
        sl_distance = abs(entry_price - stop_loss)
        
        if sl_distance == 0:
            logger.warning("SL distance = 0, tidak valid")
            return None
        
        tp_distance = sl_distance * self.min_rrr
        
        if action == 'BUY':
            take_profit = entry_price + tp_distance
        else:
            take_profit = entry_price - tp_distance
        
        # Hitung actual RRR
        risk_reward_ratio = tp_distance / sl_distance
        reason_parts.append(f"TP dengan RRR 1:{risk_reward_ratio:.1f}")
        
        # Reject if RRR below institutional minimum
        if risk_reward_ratio < self.min_rrr:
            logger.info(f"RRR {risk_reward_ratio:.2f} < {self.min_rrr} → NO SIGNAL")
            return None
        
        # =======================
        # STEP 5: CALCULATE CONFIDENCE
        # =======================
        confidence = self.calculate_confidence(
            action, current_close,
            current_ema_9, current_ema_21, current_ema_200,
            volume_ratio
        )
        
        if confidence < self.min_confidence:
            logger.info(f"Confidence terlalu rendah: {confidence:.1f}% < {self.min_confidence}%")
            return None
        
        reason_parts.append(f"Confidence: {confidence:.1f}%")
        
        # =======================
        # CREATE SIGNAL
        # =======================
        signal = TradeSignal(
            action=action,
            entry_price=entry_price,
            stop_loss=stop_loss,
            take_profit=take_profit,
            swing_point=swing_point,
            ema_9=current_ema_9,
            ema_21=current_ema_21,
            ema_200=current_ema_200,
            risk_reward_ratio=risk_reward_ratio,
            confidence=confidence,
            timestamp=datetime.now(),
            reason=" | ".join(reason_parts)
        )
        
        logger.info(f"✅ SINYAL VALID: {action} @ {entry_price:.2f} | SL: {stop_loss:.2f} | TP: {take_profit:.2f}")
        
        return signal
    
    def analyze_market_state(self, ohlcv_data: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Menganalisa kondisi market saat ini tanpa menghasilkan sinyal
        
        Returns:
            Dict dengan informasi market state
        """
        if len(ohlcv_data) < self.ema_slow + 10:
            return {'error': 'Data tidak cukup'}
        
        closes = np.array([c['close'] for c in ohlcv_data])
        highs = np.array([c['high'] for c in ohlcv_data])
        lows = np.array([c['low'] for c in ohlcv_data])
        
        ema_9 = self.calculate_ema(closes, self.ema_fast)
        ema_21 = self.calculate_ema(closes, self.ema_medium)
        ema_200 = self.calculate_ema(closes, self.ema_slow)
        
        current_close = closes[-1]
        
        # Determine trend
        if current_close > ema_200[-1]:
            if ema_9[-1] > ema_21[-1]:
                trend = 'STRONG_UPTREND'
            else:
                trend = 'WEAK_UPTREND'
        elif current_close < ema_200[-1]:
            if ema_9[-1] < ema_21[-1]:
                trend = 'STRONG_DOWNTREND'
            else:
                trend = 'WEAK_DOWNTREND'
        else:
            trend = 'SIDEWAYS'
        
        return {
            'current_price': round(current_close, 5),
            'ema_9': round(ema_9[-1], 5),
            'ema_21': round(ema_21[-1], 5),
            'ema_200': round(ema_200[-1], 5),
            'trend': trend,
            'swing_low': round(self.find_swing_low(lows, self.swing_lookback), 5),
            'swing_high': round(self.find_swing_high(highs, self.swing_lookback), 5),
            'price_vs_ema200': round((current_close - ema_200[-1]) / ema_200[-1] * 100, 2),
            'ema9_vs_ema21': 'ABOVE' if ema_9[-1] > ema_21[-1] else 'BELOW',
            'ready_for_buy': current_close > ema_200[-1] and ema_9[-1] <= ema_21[-1],
            'ready_for_sell': current_close < ema_200[-1] and ema_9[-1] >= ema_21[-1],
        }

    # =======================
    # INSTITUTIONAL ENGINE INTEGRATION
    # =======================
    
    def get_institutional_signal(
        self,
        ohlcv_data: List[Dict[str, Any]],
        zones: Optional[List[Dict]] = None,
        news: Optional[List[Dict]] = None,
        sentiment: Optional[Dict] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        Run the 11-step institutional analysis pipeline.
        
        Returns:
            InstitutionalOutput.to_dict() if institutional mode active,
            None if not available or insufficient data.
        """
        if not self.institutional_mode:
            logger.info("Institutional mode disabled, falling back to legacy signal")
            return None
        
        if len(ohlcv_data) < 200:
            logger.warning(f"Institutional engine needs 200+ candles, got {len(ohlcv_data)}")
            return None
        
        # Convert OHLCV dicts to format institutional engine expects
        candles = []
        for c in ohlcv_data:
            candles.append({
                'time': c.get('timestamp', c.get('time', 0)),
                'open': c['open'],
                'high': c['high'],
                'low': c['low'],
                'close': c['close'],
                'volume': c.get('volume', 0),
            })
        
        result: InstitutionalOutput = run_institutional_engine(
            candles=candles,
            zones=zones,
            news=news,
            sentiment=sentiment,
            discipline=self._discipline,
        )
        
        # Update discipline state
        self._discipline = result.discipline
        
        # Log grade
        grade = result.grade
        decision = result.decision
        if decision == 'TRADE':
            logger.info(
                f"🎯 INSTITUTIONAL SIGNAL: {result.direction} "
                f"Grade {grade} (confidence {result.confidence}/100) "
                f"Entry {result.entry} SL {result.stop_loss} "
                f"TP {result.take_profit}"
            )
        else:
            reasons = ' | '.join(result.reason)
            logger.info(f"⏸️ NO TRADE: {reasons}")
        
        return result.to_dict()
    
    def record_result(self, won: bool, grade: str, candle_duration_ms: float = 60_000):
        """
        Record trade result for discipline tracking.
        
        Args:
            won: True if trade hit TP, False if hit SL
            grade: Grade of the trade (A+, A, B)
            candle_duration_ms: Duration of one candle in milliseconds
        """
        if not HAS_INSTITUTIONAL or self._discipline is None:
            return
        
        self._discipline = record_trade_result(
            self._discipline, won, grade, candle_duration_ms
        )
        
        if self._discipline.cooldown_active:
            logger.warning(
                f"🛑 COOLDOWN ACTIVE: {self._discipline.cooldown_reason} "
                f"({self._discipline.locked_candles_remaining} candles)"
            )
        elif won:
            logger.info("✅ Win recorded, discipline state reset")
    
    def tick_discipline(self):
        """Call on each candle close to decrement cooldown counter."""
        if HAS_INSTITUTIONAL and self._discipline is not None:
            self._discipline = tick_cooldown(self._discipline)
    
    @property
    def discipline_state(self) -> Optional[Dict]:
        """Get current discipline state as dict."""
        if self._discipline is None:
            return None
        return self._discipline.to_dict()
    
    def get_signal_with_institutional(
        self,
        ohlcv_data: List[Dict[str, Any]],
        zones: Optional[List[Dict]] = None,
        news: Optional[List[Dict]] = None,
        sentiment: Optional[Dict] = None,
    ) -> Dict[str, Any]:
        """
        Combined signal: tries institutional first, falls back to legacy.
        Returns a unified dict with 'source' key indicating which engine.
        """
        # Try institutional first
        if self.institutional_mode:
            inst = self.get_institutional_signal(ohlcv_data, zones, news, sentiment)
            if inst is not None:
                inst['source'] = 'institutional'
                return inst
        
        # Fallback to legacy
        legacy = self.get_signal(ohlcv_data)
        if legacy:
            result = legacy.to_dict()
            result['source'] = 'legacy'
            result['grade'] = 'B'  # Legacy signals are at most B grade
            result['decision'] = 'TRADE'
            result['direction'] = result['action']
            return result
        
        return {
            'source': 'legacy',
            'decision': 'NO_TRADE',
            'direction': 'NONE',
            'grade': 'NO_TRADE',
            'confidence': 0,
            'reason': ['No valid setup found'],
        }


# =======================
# USAGE EXAMPLE
# =======================
if __name__ == "__main__":
    # Contoh penggunaan
    engine = StrategyEngine(
        ema_fast=9,
        ema_medium=21,
        ema_slow=200,
        swing_lookback=10,
        min_rrr=2.0,
        min_confidence=70.0,
        institutional_mode=True
    )
    
    # Simulasi data OHLCV (dalam production, ambil dari API)
    import random
    
    base_price = 2000.0
    sample_data = []
    
    for i in range(300):
        # Simulasi trending market
        trend = 0.1 if i > 150 else -0.1
        noise = random.uniform(-5, 5)
        
        open_price = base_price + noise
        close_price = open_price + trend + random.uniform(-2, 2)
        high_price = max(open_price, close_price) + random.uniform(0, 3)
        low_price = min(open_price, close_price) - random.uniform(0, 3)
        
        sample_data.append({
            'open': open_price,
            'high': high_price,
            'low': low_price,
            'close': close_price,
            'volume': random.uniform(1000, 5000),
            'timestamp': datetime.now().isoformat()
        })
        
        base_price = close_price
    
    # Analisa market state
    state = engine.analyze_market_state(sample_data)
    print("\n📊 Market State:")
    for key, value in state.items():
        print(f"  {key}: {value}")
    
    # Get signal
    signal = engine.get_signal(sample_data)
    
    if signal:
        print("\n🎯 Trade Signal:")
        print(signal.to_dict())
    else:
        print("\n⏸️ Tidak ada sinyal saat ini")
