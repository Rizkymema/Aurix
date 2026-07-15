"""
API Routes
==========
FastAPI router definitions for bot control and data endpoints.
"""

from datetime import datetime
from typing import Dict, Any, List, Optional
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, Depends, Header
from fastapi.responses import JSONResponse

from backend.core import logger, get_settings
from backend.models import (
    ApiResponse,
    BotStatus,
    BotState,
    StartBotRequest,
    ConfigUpdateRequest,
    SignalRequest,
)
from backend.services import StrategyService, RiskService, TradeService, DataService


# =======================
# Settings
# =======================

settings = get_settings()


# =======================
# Routers
# =======================

def verify_api_key(x_bot_api_key: Optional[str] = Header(None)) -> None:
    if settings.bot_api_key and x_bot_api_key != settings.bot_api_key:
        raise HTTPException(status_code=401, detail="Unauthorized")


router = APIRouter(prefix="/api/bot", tags=["Bot Control"], dependencies=[Depends(verify_api_key)])
health_router = APIRouter(tags=["Health"])


# =======================
# Service Instances
# =======================
data_service = DataService()
strategy_service = StrategyService()
risk_service = RiskService(
    equity=settings.default_equity,
    leverage=settings.leverage,
    max_risk_percent=settings.max_risk_percent
)
trade_service = TradeService(dry_run=settings.dry_run)


# Bot state
_bot_status = BotStatus(
    state=BotState.STOPPED,
    symbol=settings.default_symbol,
    timeframe=settings.default_timeframe,
    dry_run=settings.dry_run,
    equity=settings.default_equity
)


# =======================
# Health Endpoints
# =======================

@health_router.get("/health")
async def health_check() -> Dict[str, Any]:
    """Health check endpoint."""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "version": "2.0.0"
    }


@health_router.get("/")
async def root() -> Dict[str, str]:
    """Root endpoint."""
    return {
        "message": "Trading Bot API",
        "docs": "/docs",
        "health": "/health"
    }


# =======================
# Bot Control Endpoints
# =======================

@router.get("/status")
async def get_status() -> ApiResponse:
    """Get current bot status."""
    return ApiResponse(
        success=True,
        data=_bot_status.model_dump()
    )


@router.post("/start")
async def start_bot(request: StartBotRequest) -> ApiResponse:
    """Start the trading bot."""
    global _bot_status
    
    if _bot_status.state == BotState.RUNNING:
        return ApiResponse(
            success=False,
            error="Bot is already running"
        )
    
    try:
        _bot_status.state = BotState.STARTING
        _bot_status.symbol = request.symbol
        _bot_status.timeframe = request.timeframe
        _bot_status.dry_run = request.dry_run
        _bot_status.equity = request.equity
        _bot_status.running_since = datetime.utcnow()
        
        # Update services
        risk_service.equity = request.equity
        
        _bot_status.state = BotState.RUNNING
        
        logger.info(
            f"Bot started: {request.symbol} {request.timeframe} "
            f"({'DRY-RUN' if request.dry_run else 'LIVE'})"
        )
        
        return ApiResponse(
            success=True,
            message="Bot started successfully",
            data=_bot_status.model_dump()
        )
        
    except Exception as e:
        _bot_status.state = BotState.ERROR
        _bot_status.error = str(e)
        logger.error(f"Failed to start bot: {e}")
        
        return ApiResponse(
            success=False,
            error=str(e)
        )


@router.post("/stop")
async def stop_bot() -> ApiResponse:
    """Stop the trading bot."""
    global _bot_status
    
    if _bot_status.state == BotState.STOPPED:
        return ApiResponse(
            success=False,
            error="Bot is not running"
        )
    
    _bot_status.state = BotState.STOPPING
    
    # Close all positions
    positions = trade_service.get_positions()
    for pos in positions:
        trade_service.close_position(pos.id, pos.current_price, "bot_stopped")
    
    _bot_status.state = BotState.STOPPED
    _bot_status.running_since = None
    
    logger.info("Bot stopped")
    
    return ApiResponse(
        success=True,
        message="Bot stopped successfully"
    )


@router.put("/config")
async def update_config(request: ConfigUpdateRequest) -> ApiResponse:
    """Update bot configuration."""
    global _bot_status
    
    updates = request.model_dump(exclude_none=True)
    
    if 'symbol' in updates:
        _bot_status.symbol = updates['symbol']
    if 'timeframe' in updates:
        _bot_status.timeframe = updates['timeframe']
    if 'dry_run' in updates:
        _bot_status.dry_run = updates['dry_run']
    if 'equity' in updates:
        _bot_status.equity = updates['equity']
        risk_service.update_equity(updates['equity'])
    
    logger.info(f"Config updated: {updates}")
    
    return ApiResponse(
        success=True,
        message="Configuration updated",
        data=_bot_status.model_dump()
    )


# =======================
# Signal Endpoints
# =======================

@router.post("/signal")
async def generate_signal(request: SignalRequest) -> ApiResponse:
    """Generate trading signal from candle data."""
    
    try:
        signal = strategy_service.analyze(
            symbol=request.symbol,
            candles=request.candles,
            current_price=request.current_price
        )
        
        if not signal:
            return ApiResponse(
                success=True,
                message="No signal generated",
                data={"signal": None}
            )
        
        # Calculate position size
        position = risk_service.calculate_position_size(
            symbol=signal.symbol,
            entry_price=signal.entry_price,
            stop_loss=signal.stop_loss,
            take_profit=signal.take_profit_1
        )
        
        return ApiResponse(
            success=True,
            data={
                "signal": signal.model_dump(),
                "position": position.to_dict()
            }
        )
        
    except Exception as e:
        logger.error(f"Signal generation error: {e}")
        return ApiResponse(
            success=False,
            error=str(e)
        )


# =======================
# Position Endpoints
# =======================

@router.get("/positions")
async def get_positions() -> ApiResponse:
    """Get all open positions."""
    positions = trade_service.get_positions()
    return ApiResponse(
        success=True,
        data={"positions": [p.model_dump() for p in positions]}
    )


@router.get("/history")
async def get_history(limit: int = 50) -> ApiResponse:
    """Get trade history."""
    history = trade_service.get_trade_history(limit)
    return ApiResponse(
        success=True,
        data={"trades": [t.model_dump() for t in history]}
    )


@router.post("/execute")
async def execute_trade(
    signal_data: Dict[str, Any],
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key")
) -> ApiResponse:
    """Execute a trade based on signal."""
    
    if _bot_status.state != BotState.RUNNING:
        return ApiResponse(
            success=False,
            error="Bot is not running"
        )
    
    try:
        effective_key = idempotency_key or f"{signal_data.get('symbol')}-{signal_data.get('signal_type')}-{signal_data.get('entry_price')}"
        if effective_key and trade_service.is_duplicate(effective_key):
            return JSONResponse(
                status_code=409,
                content=ApiResponse(success=False, error="Duplicate request").model_dump()
            )

        from backend.models import SignalType
        
        result = trade_service.execute_order(
            symbol=signal_data['symbol'],
            order_type=SignalType(signal_data['signal_type']),
            quantity=signal_data['lot_size'],
            entry_price=signal_data['entry_price'],
            stop_loss=signal_data['stop_loss'],
            take_profit=signal_data['take_profit']
        )
        
        return ApiResponse(
            success=result.success,
            message=result.message,
            data=result.model_dump()
        )
        
    except Exception as e:
        logger.error(f"Trade execution error: {e}")
        return ApiResponse(
            success=False,
            error=str(e)
        )


# =======================
# Statistics Endpoint
# =======================

@router.get("/stats")
async def get_statistics() -> ApiResponse:
    """Get trading statistics."""
    stats = trade_service.get_statistics()
    return ApiResponse(
        success=True,
        data=stats
    )
