"""
Pydantic Schemas
================
All data models and schemas for the trading bot API.
"""

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional, Union
from pydantic import BaseModel, Field


# =======================
# Enums
# =======================

class BotState(str, Enum):
    """Bot state enumeration."""
    STOPPED = "stopped"
    STARTING = "starting"
    RUNNING = "running"
    ANALYZING = "analyzing"
    TRADING = "trading"
    STOPPING = "stopping"
    ERROR = "error"


class SignalType(str, Enum):
    """Trade signal type."""
    BUY = "BUY"
    SELL = "SELL"
    HOLD = "HOLD"


class OrderStatus(str, Enum):
    """Order execution status."""
    PENDING = "pending"
    FILLED = "filled"
    PARTIAL = "partial"
    CANCELLED = "cancelled"
    REJECTED = "rejected"


class ZoneType(str, Enum):
    """Supply/Demand zone type."""
    SUPPLY = "supply"
    DEMAND = "demand"


class ZoneStatus(str, Enum):
    """Zone validity status."""
    FRESH = "fresh"
    TESTED = "tested"
    BROKEN = "broken"


# =======================
# Bot Models
# =======================

class BotConfig(BaseModel):
    """Bot configuration model."""
    dry_run: bool = True
    symbol: str = "XAUUSD"
    timeframe: str = "15m"
    
    # Strategy params
    ema_fast: int = 9
    ema_medium: int = 21
    ema_slow: int = 200
    min_confidence: float = 60.0
    min_rrr: float = 1.5
    
    # Risk params
    equity: float = 10000.0
    leverage: int = 100
    risk_percent: float = 1.0
    max_risk_percent: float = 2.0
    
    # Loop settings
    analysis_interval: int = 60
    max_open_positions: int = 1


class BotStatus(BaseModel):
    """Bot status model."""
    state: BotState
    symbol: Optional[str] = None
    timeframe: Optional[str] = None
    dry_run: bool = True
    equity: Optional[float] = None
    running_since: Optional[datetime] = None
    last_signal: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    total_trades: int = 0
    winning_trades: int = 0
    total_pnl: float = 0.0


class BotLog(BaseModel):
    """Bot log entry model."""
    timestamp: datetime
    level: str
    message: str
    data: Optional[Dict[str, Any]] = None


# =======================
# Trade Models
# =======================

class TradeSignal(BaseModel):
    """Trade signal from strategy engine."""
    symbol: str
    signal_type: SignalType
    entry_price: float
    stop_loss: float
    take_profit_1: float
    take_profit_2: Optional[float] = None
    confidence: float = Field(ge=0, le=100)
    rrr: float = Field(ge=0)
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    reason: str = ""
    
    # SMC specific
    zone_type: Optional[ZoneType] = None
    market_structure: Optional[str] = None


class TradeRecord(BaseModel):
    """Executed trade record."""
    id: str
    symbol: str
    side: SignalType
    entry_price: float
    exit_price: Optional[float] = None
    quantity: float
    stop_loss: float
    take_profit: float
    status: str  # 'open', 'closed', 'stopped_out', 'take_profit'
    pnl: float = 0.0
    opened_at: datetime
    closed_at: Optional[datetime] = None


class Position(BaseModel):
    """Open position model."""
    id: str
    symbol: str
    type: SignalType
    entry_price: float
    current_price: float
    stop_loss: float
    take_profit: float
    lot_size: float
    pnl: float
    pnl_percent: float
    opened_at: datetime


class OrderResult(BaseModel):
    """Order execution result."""
    success: bool
    order_id: Optional[str] = None
    status: OrderStatus
    filled_price: Optional[float] = None
    filled_quantity: Optional[float] = None
    message: str = ""
    timestamp: datetime = Field(default_factory=datetime.utcnow)


# =======================
# Analysis Models
# =======================

class SupplyDemandZone(BaseModel):
    """Supply/Demand zone model."""
    id: str
    type: ZoneType
    status: ZoneStatus
    high: float
    low: float
    strength: float = Field(ge=0, le=100)
    formation_time: datetime
    test_count: int = 0


class MarketStructure(BaseModel):
    """Market structure analysis."""
    trend: str  # 'bullish', 'bearish', 'sideways'
    trend_strength: float = Field(ge=0, le=100)
    last_swing_high: Optional[float] = None
    last_swing_low: Optional[float] = None
    structure_break: Optional[str] = None  # 'BOS', 'CHOCH'
    current_phase: str = ""  # 'impulse', 'correction', 'consolidation'


class SMCAnalysis(BaseModel):
    """Complete SMC analysis result."""
    decision: SignalType
    confidence_score: float = Field(ge=0, le=100)
    logic: str
    
    # Setup details
    entry: Optional[float] = None
    stop_loss: Optional[float] = None
    take_profit_1: Optional[float] = None
    take_profit_2: Optional[float] = None
    rrr_tp1: Optional[float] = None
    rrr_tp2: Optional[float] = None
    
    # Analysis components
    trend_h4: Optional[str] = None
    trend_m15: Optional[str] = None
    market_structure: Optional[MarketStructure] = None
    active_zone: Optional[SupplyDemandZone] = None
    confirmation: Optional[str] = None


# =======================
# Request/Response Models
# =======================

class StartBotRequest(BaseModel):
    """Request to start the bot."""
    symbol: str = "XAUUSD"
    timeframe: str = "15m"
    dry_run: bool = True
    equity: float = 10000.0
    risk_percent: float = 1.0
    leverage: int = 100


class ConfigUpdateRequest(BaseModel):
    """Request to update bot config."""
    symbol: Optional[str] = None
    timeframe: Optional[str] = None
    dry_run: Optional[bool] = None
    equity: Optional[float] = None
    risk_percent: Optional[float] = None
    leverage: Optional[int] = None
    analysis_interval: Optional[int] = None


class SignalRequest(BaseModel):
    """Request for signal generation."""
    symbol: str
    timeframe: str
    candles: List[Dict[str, float]]
    current_price: Optional[float] = None


class ApiResponse(BaseModel):
    """Standard API response wrapper."""
    success: bool
    message: str = ""
    data: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)
