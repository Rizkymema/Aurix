"""
Strategy Service
================
Centralized strategy logic for signal generation.
Refactored from bot/strategy_engine.py with proper logging.
"""

import numpy as np
from dataclasses import dataclass, asdict
from typing import Optional, List, Dict, Any
from datetime import datetime

from backend.core import logger
from backend.models import TradeSignal, SignalType


class StrategyService:
    """
    Quant Strategy Service for market analysis.
    
    Strategy:
    1. Trend Filter using EMA 200
    2. Entry trigger with EMA 9/21 crossover
    3. Stop Loss at last Swing Low/High
    4. Take Profit with minimum RRR 1:1.5
    """
    
    def __init__(
        self,
        ema_fast: int = 9,
        ema_medium: int = 21,
        ema_slow: int = 200,
        swing_lookback: int = 10,
        min_rrr: float = 1.5,
        min_confidence: float = 60.0
    ):
        """
        Initialize Strategy Service.
        
        Args:
            ema_fast: Fast EMA period (default: 9)
            ema_medium: Medium EMA period (default: 21)
            ema_slow: Slow EMA for trend filter (default: 200)
            swing_lookback: Period for swing point detection (default: 10)
            min_rrr: Minimum Risk Reward Ratio (default: 1.5)
            min_confidence: Minimum confidence for signal (default: 60%)
        """
        self.ema_fast = ema_fast
        self.ema_medium = ema_medium
        self.ema_slow = ema_slow
        self.swing_lookback = swing_lookback
        self.min_rrr = min_rrr
        self.min_confidence = min_confidence
        
        self._prev_ema_fast = None
        self._prev_ema_medium = None
        
        logger.info(
            f"StrategyService initialized: EMA {ema_fast}/{ema_medium}/{ema_slow}"
        )
    
    def analyze(
        self,
        symbol: str,
        candles: List[Dict[str, float]],
        current_price: Optional[float] = None
    ) -> Optional[TradeSignal]:
        """
        Analyze candles and generate trade signal.
        
        Args:
            symbol: Trading symbol
            candles: List of OHLCV candles
            current_price: Current market price
            
        Returns:
            TradeSignal if conditions met, None otherwise
        """
        if len(candles) < self.ema_slow + 10:
            logger.warning(f"Insufficient candles for analysis: {len(candles)}")
            return None
        
        # Extract close prices
        closes = np.array([c['close'] for c in candles])
        highs = np.array([c['high'] for c in candles])
        lows = np.array([c['low'] for c in candles])
        
        # Calculate EMAs
        ema_fast = self._calculate_ema(closes, self.ema_fast)
        ema_medium = self._calculate_ema(closes, self.ema_medium)
        ema_slow = self._calculate_ema(closes, self.ema_slow)
        
        # Current values
        current = current_price or closes[-1]
        ema_9 = ema_fast[-1]
        ema_21 = ema_medium[-1]
        ema_200 = ema_slow[-1]
        
        # Determine trend
        trend = self._determine_trend(current, ema_200)
        
        # Check for crossover
        crossover = self._detect_crossover(ema_fast[-2:], ema_medium[-2:])
        
        if not crossover:
            return None
        
        # Find swing points
        swing_low = self._find_swing_low(lows)
        swing_high = self._find_swing_high(highs)
        
        # Generate signal based on trend and crossover
        signal_type = None
        stop_loss = 0.0
        swing_point = 0.0
        
        if trend == 'bullish' and crossover == 'bullish':
            signal_type = SignalType.BUY
            stop_loss = swing_low
            swing_point = swing_low
            
        elif trend == 'bearish' and crossover == 'bearish':
            signal_type = SignalType.SELL
            stop_loss = swing_high
            swing_point = swing_high
        
        if not signal_type:
            return None
        
        # Calculate take profit with minimum RRR
        risk_distance = abs(current - stop_loss)
        reward_distance = risk_distance * self.min_rrr
        
        if signal_type == SignalType.BUY:
            take_profit = current + reward_distance
        else:
            take_profit = current - reward_distance
        
        # Calculate confidence
        confidence = self._calculate_confidence(
            trend, crossover, current, ema_9, ema_21, ema_200
        )
        
        if confidence < self.min_confidence:
            logger.info(f"Signal rejected: Confidence {confidence:.1f}% < {self.min_confidence}%")
            return None
        
        # Calculate RRR
        rrr = reward_distance / risk_distance if risk_distance > 0 else 0
        
        signal = TradeSignal(
            symbol=symbol,
            signal_type=signal_type,
            entry_price=current,
            stop_loss=stop_loss,
            take_profit_1=take_profit,
            confidence=confidence,
            rrr=rrr,
            timestamp=datetime.utcnow(),
            reason=f"{trend.title()} trend with {crossover} EMA crossover"
        )
        
        logger.info(
            f"Signal generated: {signal_type.value} {symbol} @ {current:.5f}, "
            f"SL={stop_loss:.5f}, TP={take_profit:.5f}, "
            f"Confidence={confidence:.1f}%, RRR=1:{rrr:.2f}"
        )
        
        return signal
    
    def _calculate_ema(self, data: np.ndarray, period: int) -> np.ndarray:
        """Calculate Exponential Moving Average."""
        ema = np.zeros_like(data)
        multiplier = 2 / (period + 1)
        ema[0] = data[0]
        
        for i in range(1, len(data)):
            ema[i] = (data[i] * multiplier) + (ema[i-1] * (1 - multiplier))
        
        return ema
    
    def _determine_trend(self, price: float, ema_200: float) -> str:
        """Determine trend based on price vs EMA 200."""
        margin = abs(ema_200) * 0.001  # 0.1% margin
        
        if price > ema_200 + margin:
            return 'bullish'
        elif price < ema_200 - margin:
            return 'bearish'
        else:
            return 'sideways'
    
    def _detect_crossover(
        self,
        ema_fast: np.ndarray,
        ema_medium: np.ndarray
    ) -> Optional[str]:
        """Detect EMA crossover."""
        prev_fast, curr_fast = ema_fast
        prev_medium, curr_medium = ema_medium
        
        # Bullish crossover: fast crosses above medium
        if prev_fast <= prev_medium and curr_fast > curr_medium:
            return 'bullish'
        
        # Bearish crossover: fast crosses below medium
        if prev_fast >= prev_medium and curr_fast < curr_medium:
            return 'bearish'
        
        return None
    
    def _find_swing_low(self, lows: np.ndarray) -> float:
        """Find recent swing low."""
        lookback = min(self.swing_lookback, len(lows) - 1)
        return float(np.min(lows[-lookback:]))
    
    def _find_swing_high(self, highs: np.ndarray) -> float:
        """Find recent swing high."""
        lookback = min(self.swing_lookback, len(highs) - 1)
        return float(np.max(highs[-lookback:]))
    
    def _calculate_confidence(
        self,
        trend: str,
        crossover: str,
        price: float,
        ema_9: float,
        ema_21: float,
        ema_200: float
    ) -> float:
        """Calculate signal confidence score (0-100)."""
        confidence = 50.0  # Base confidence
        
        # Trend alignment (+15)
        if (trend == 'bullish' and crossover == 'bullish') or \
           (trend == 'bearish' and crossover == 'bearish'):
            confidence += 15.0
        
        # EMA stack alignment (+10)
        if trend == 'bullish' and ema_9 > ema_21 > ema_200:
            confidence += 10.0
        elif trend == 'bearish' and ema_9 < ema_21 < ema_200:
            confidence += 10.0
        
        # Distance from EMA 200 (+10 for strong trend)
        distance_pct = abs(price - ema_200) / ema_200 * 100
        if distance_pct > 1.0:
            confidence += min(distance_pct * 2, 10.0)
        
        # EMA momentum (+15)
        ema_spread = abs(ema_9 - ema_21) / ema_21 * 100
        if ema_spread > 0.5:
            confidence += min(ema_spread * 5, 15.0)
        
        return min(confidence, 100.0)
