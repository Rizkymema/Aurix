"""
AI Trading System Core - FastAPI Integration
============================================
API endpoint untuk AI Trading System Core dengan multi-timeframe hierarchy lock.

Endpoints:
- POST /api/ai-signal/analyze - Analisis lengkap dan generate signal
- GET /api/ai-signal/status - Status sistem
- POST /api/ai-signal/validate - Validasi signal yang sudah ada
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime
import logging

from ai_trading_core import (
    AITradingSystemCore,
    TradingSignal,
    SignalStatus,
    candles_to_ohlc,
    zones_to_zoneinfo,
    OHLC,
    ZoneInfo
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create router
router = APIRouter(prefix="/api/ai-signal", tags=["AI Trading Signal"])

# Initialize AI Trading System
ai_system = AITradingSystemCore(
    min_rrr=2.0,
    min_validity_score=60,
    news_buffer_minutes=30
)


# ================================================
# Pydantic Models for API
# ================================================

class CandleData(BaseModel):
    """Candlestick data model"""
    time: int = Field(..., description="Unix timestamp")
    open: float = Field(..., description="Open price")
    high: float = Field(..., description="High price")
    low: float = Field(..., description="Low price")
    close: float = Field(..., description="Close price")
    volume: Optional[float] = Field(0.0, description="Volume")


class ZoneData(BaseModel):
    """Supply/Demand zone model"""
    type: str = Field(..., description="Zone type: 'supply' or 'demand'")
    high: float = Field(..., alias="price_high", description="Zone high price")
    low: float = Field(..., alias="price_low", description="Zone low price")
    strength: int = Field(50, description="Zone strength 0-100")
    timeframe: str = Field("H1", description="Zone timeframe")
    status: str = Field("fresh", description="Zone status: fresh, tested, broken")
    
    class Config:
        populate_by_name = True


class AnalyzeRequest(BaseModel):
    """Request model untuk analyze endpoint"""
    symbol: str = Field(..., description="Trading pair (e.g., EURUSD, BTCUSDT)")
    h4_candles: List[CandleData] = Field(..., description="H4 candlestick data (min 200)")
    h1_candles: List[CandleData] = Field(..., description="H1 candlestick data (min 100)")
    m15_candles: List[CandleData] = Field(..., description="M15 candlestick data (min 50)")
    m5_candles: Optional[List[CandleData]] = Field(None, description="M5 candlestick data (optional)")
    zones: Optional[List[ZoneData]] = Field(None, description="Supply/Demand zones (optional)")


class SignalResponse(BaseModel):
    """Response model untuk signal"""
    success: bool
    signal: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    timestamp: str


class StatusResponse(BaseModel):
    """Response model untuk status endpoint"""
    status: str
    version: str
    min_rrr: float
    min_validity_score: int
    news_buffer_minutes: int
    timestamp: str


# ================================================
# API Endpoints
# ================================================

@router.get("/status", response_model=StatusResponse)
async def get_status():
    """
    Get AI Trading System status
    
    Returns current configuration and system status.
    """
    return StatusResponse(
        status="operational",
        version="2.0.0",
        min_rrr=ai_system.min_rrr,
        min_validity_score=ai_system.min_validity_score,
        news_buffer_minutes=30,
        timestamp=datetime.now().isoformat()
    )


@router.post("/analyze", response_model=SignalResponse)
async def analyze_market(request: AnalyzeRequest):
    """
    🎯 MAIN ENDPOINT: Analyze market and generate trading signal
    
    This endpoint performs:
    1. Multi-timeframe hierarchy analysis (H4 > H1 > M15 > M5)
    2. Market structure detection (HH-HL / LH-LL)
    3. Supply/Demand zone validation
    4. News filter check
    5. Entry pattern detection
    6. Risk/Reward calculation
    7. Validity score calculation
    
    Returns:
    - VALID signal with entry, SL, TP1, TP2, and explanation
    - NO_TRADE with clear rejection reasons
    """
    logger.info(f"📊 Analyze request received for {request.symbol}")
    
    try:
        # Validate input data
        if len(request.h4_candles) < 200:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient H4 data. Need 200+ candles, got {len(request.h4_candles)}"
            )
        
        if len(request.h1_candles) < 100:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient H1 data. Need 100+ candles, got {len(request.h1_candles)}"
            )
        
        if len(request.m15_candles) < 50:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient M15 data. Need 50+ candles, got {len(request.m15_candles)}"
            )
        
        # Convert to internal formats
        h4_ohlc = [
            OHLC(c.time, c.open, c.high, c.low, c.close, c.volume or 0)
            for c in request.h4_candles
        ]
        
        h1_ohlc = [
            OHLC(c.time, c.open, c.high, c.low, c.close, c.volume or 0)
            for c in request.h1_candles
        ]
        
        m15_ohlc = [
            OHLC(c.time, c.open, c.high, c.low, c.close, c.volume or 0)
            for c in request.m15_candles
        ]
        
        m5_ohlc = None
        if request.m5_candles:
            m5_ohlc = [
                OHLC(c.time, c.open, c.high, c.low, c.close, c.volume or 0)
                for c in request.m5_candles
            ]
        
        zones = None
        if request.zones:
            zones = [
                ZoneInfo(
                    zone_type=z.type,
                    price_high=z.high,
                    price_low=z.low,
                    strength=z.strength,
                    timeframe=z.timeframe,
                    status=z.status
                )
                for z in request.zones
            ]
        
        # Run analysis
        signal = await ai_system.analyze(
            symbol=request.symbol,
            h4_candles=h4_ohlc,
            h1_candles=h1_ohlc,
            m15_candles=m15_ohlc,
            m5_candles=m5_ohlc,
            zones=zones
        )
        
        logger.info(f"✅ Analysis complete for {request.symbol}: {signal.status.value}")
        
        return SignalResponse(
            success=True,
            signal=signal.to_dict(),
            timestamp=datetime.now().isoformat()
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Analysis error: {str(e)}")
        return SignalResponse(
            success=False,
            error=str(e),
            timestamp=datetime.now().isoformat()
        )


@router.post("/quick-check")
async def quick_check(symbol: str, h4_trend: str, h1_trend: str, price_position: str):
    """
    Quick hierarchy check without full analysis
    
    Args:
        symbol: Trading pair
        h4_trend: H4 trend direction (BULLISH/BEARISH/SIDEWAYS)
        h1_trend: H1 trend direction
        price_position: Price position (PREMIUM/DISCOUNT/MIDDLE)
    
    Returns:
        Quick validation result
    """
    # Validate hierarchy
    aligned = False
    can_trade = False
    direction = None
    reasons = []
    
    if h4_trend == "SIDEWAYS":
        reasons.append("❌ H4 sideways - NO TRADE")
    elif h4_trend == "BULLISH":
        direction = "BUY"
        if h1_trend == "BULLISH":
            aligned = True
            reasons.append("✅ H4 & H1 both BULLISH")
        elif h1_trend == "BEARISH":
            reasons.append("❌ H1 BEARISH conflicts with H4 BULLISH")
        else:
            reasons.append("⚠️ H1 unclear")
    elif h4_trend == "BEARISH":
        direction = "SELL"
        if h1_trend == "BEARISH":
            aligned = True
            reasons.append("✅ H4 & H1 both BEARISH")
        elif h1_trend == "BULLISH":
            reasons.append("❌ H1 BULLISH conflicts with H4 BEARISH")
        else:
            reasons.append("⚠️ H1 unclear")
    
    # Check price position
    if aligned:
        if direction == "BUY" and price_position == "DISCOUNT":
            can_trade = True
            reasons.append("✅ BUY in DISCOUNT zone - good entry")
        elif direction == "BUY" and price_position == "PREMIUM":
            reasons.append("⚠️ BUY in PREMIUM - wait for pullback")
        elif direction == "SELL" and price_position == "PREMIUM":
            can_trade = True
            reasons.append("✅ SELL in PREMIUM zone - good entry")
        elif direction == "SELL" and price_position == "DISCOUNT":
            reasons.append("⚠️ SELL in DISCOUNT - wait for pullback")
        elif price_position == "MIDDLE":
            reasons.append("❌ Price in MIDDLE of range - NO TRADE")
    
    return {
        "symbol": symbol,
        "hierarchy_aligned": aligned,
        "can_trade": can_trade,
        "suggested_direction": direction,
        "h4_trend": h4_trend,
        "h1_trend": h1_trend,
        "price_position": price_position,
        "reasons": reasons,
        "timestamp": datetime.now().isoformat()
    }


# ================================================
# Include in main FastAPI app
# ================================================

def include_router(app):
    """Include this router in FastAPI app"""
    app.include_router(router)
