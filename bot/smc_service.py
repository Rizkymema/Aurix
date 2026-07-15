"""
SMC API Service - REST API untuk Smart Money Concept Analysis
==============================================================
FastAPI endpoint untuk integrasi dengan frontend dan bot.

Endpoints:
- POST /api/smc/analyze - Analisis SMC lengkap
- GET /api/smc/status - Status engine
"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime
import logging

from smc_strategy import SMCStrategyEngine

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ==========================================
# PYDANTIC MODELS
# ==========================================

class CandleData(BaseModel):
    """Single candlestick data"""
    time: int
    open: float
    high: float
    low: float
    close: float
    volume: float = 0.0


class ZoneData(BaseModel):
    """Supply/Demand zone data"""
    type: str  # 'supply' or 'demand'
    status: str = 'fresh'  # 'fresh', 'tested', 'broken'
    price_high: float = Field(alias='high')
    price_low: float = Field(alias='low')
    strength: int = 50
    created_at: int = 0
    tested_count: int = 0
    
    class Config:
        populate_by_name = True


class MarketStructureData(BaseModel):
    """Market structure information"""
    trend: Optional[str] = None
    last_swing_high: Optional[float] = None
    last_swing_low: Optional[float] = None
    structure: Optional[str] = None


class SMCAnalysisRequest(BaseModel):
    """Request body untuk SMC analysis"""
    ohlc_h4: List[CandleData]
    ohlc_m15: List[CandleData]
    supply_demand_zones: List[ZoneData] = []
    market_structure: MarketStructureData = MarketStructureData()
    current_volume: float = 0.0
    symbol: str = 'XAUUSD'


class SMCSetupResponse(BaseModel):
    """Trading setup response"""
    entry: float
    sl: float
    tp1: float
    tp2: float
    position_type: str
    risk_pips: float
    reward_pips_tp1: float
    reward_pips_tp2: float
    rrr_tp1: float
    rrr_tp2: float


class SMCAnalysisDetails(BaseModel):
    """Detailed analysis info"""
    trend_h4: Optional[str] = None
    poi_zone: Optional[Dict[str, Any]] = None
    confirmation: Optional[str] = None
    market_structure: Optional[str] = None


class SMCAnalysisResponse(BaseModel):
    """Response dari SMC analysis"""
    decision: str
    confidence_score: int
    logic: str
    setup: Optional[SMCSetupResponse] = None
    analysis: Optional[SMCAnalysisDetails] = None
    warnings: List[str] = []
    timestamp: str = Field(default_factory=lambda: datetime.now().isoformat())


# ==========================================
# SERVICE CLASS
# ==========================================

class SMCService:
    """
    SMC Analysis Service
    
    Menyediakan interface untuk analisis SMC yang dapat digunakan
    oleh FastAPI endpoints atau langsung oleh trading bot.
    """
    
    def __init__(
        self,
        min_zone_strength: int = 60,
        min_rrr: float = 2.0,
        min_confidence: int = 60
    ):
        """Initialize SMC Service"""
        self.engine = SMCStrategyEngine(
            min_zone_strength=min_zone_strength,
            min_rrr=min_rrr,
            min_confidence=min_confidence
        )
        self.analysis_count = 0
        self.last_analysis_time: Optional[datetime] = None
        
        logger.info("SMC Service initialized")
    
    def analyze(self, request: SMCAnalysisRequest) -> SMCAnalysisResponse:
        """
        Jalankan analisis SMC
        
        Args:
            request: SMCAnalysisRequest dengan semua data yang diperlukan
            
        Returns:
            SMCAnalysisResponse
        """
        self.analysis_count += 1
        self.last_analysis_time = datetime.now()
        
        # Convert Pydantic models to dicts
        ohlc_h4 = [c.model_dump() for c in request.ohlc_h4]
        ohlc_m15 = [c.model_dump() for c in request.ohlc_m15]
        zones = [z.model_dump(by_alias=True) for z in request.supply_demand_zones]
        structure = request.market_structure.model_dump()
        
        # Run analysis
        result = self.engine.analyze(
            ohlc_h4=ohlc_h4,
            ohlc_m15=ohlc_m15,
            supply_demand_zones=zones,
            market_structure=structure,
            current_volume=request.current_volume,
            symbol=request.symbol
        )
        
        # Convert to response
        result_dict = result.to_dict()
        
        setup = None
        if result_dict.get('setup'):
            setup = SMCSetupResponse(**result_dict['setup'])
        
        analysis = None
        if result_dict.get('analysis'):
            analysis = SMCAnalysisDetails(**result_dict['analysis'])
        
        return SMCAnalysisResponse(
            decision=result_dict['decision'],
            confidence_score=result_dict['confidence_score'],
            logic=result_dict['logic'],
            setup=setup,
            analysis=analysis,
            warnings=result_dict.get('warnings', [])
        )
    
    def analyze_dict(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Analisis dari dictionary (untuk integrasi bot)
        
        Args:
            data: Dict dengan format yang sama seperti SMCAnalysisRequest
            
        Returns:
            Dict hasil analisis
        """
        self.analysis_count += 1
        self.last_analysis_time = datetime.now()
        
        result = self.engine.analyze(
            ohlc_h4=data.get('ohlc_h4', []),
            ohlc_m15=data.get('ohlc_m15', []),
            supply_demand_zones=data.get('supply_demand_zones', []),
            market_structure=data.get('market_structure', {}),
            current_volume=data.get('current_volume', 0),
            symbol=data.get('symbol', 'XAUUSD')
        )
        
        return result.to_dict()
    
    def get_status(self) -> Dict[str, Any]:
        """Get service status"""
        return {
            'status': 'active',
            'analysis_count': self.analysis_count,
            'last_analysis': self.last_analysis_time.isoformat() if self.last_analysis_time else None,
            'config': {
                'min_zone_strength': self.engine.min_zone_strength,
                'min_rrr': self.engine.min_rrr,
                'min_confidence': self.engine.min_confidence
            }
        }


# ==========================================
# FASTAPI ROUTER
# ==========================================

def create_smc_router(service: Optional[SMCService] = None):
    """
    Create FastAPI router untuk SMC endpoints
    
    Args:
        service: SMCService instance (optional, akan dibuat jika None)
        
    Returns:
        FastAPI APIRouter
    """
    from fastapi import APIRouter
    
    router = APIRouter(prefix="/api/smc", tags=["SMC Strategy"])
    
    # Use provided service or create new one
    smc_service = service or SMCService()
    
    @router.post("/analyze", response_model=SMCAnalysisResponse)
    async def analyze_smc(request: SMCAnalysisRequest):
        """
        Analisis Smart Money Concept
        
        Input:
        - ohlc_h4: List candlestick H4 (minimal 200)
        - ohlc_m15: List candlestick M15 (minimal 20)
        - supply_demand_zones: List zona supply/demand
        - market_structure: Info struktur pasar
        - current_volume: Volume saat ini
        - symbol: Trading symbol
        
        Output:
        - decision: 'ENTRY' atau 'NO_TRADE'
        - confidence_score: 0-100
        - logic: Penjelasan singkat
        - setup: Entry, SL, TP1, TP2
        """
        try:
            result = smc_service.analyze(request)
            return result
        except Exception as e:
            logger.error(f"SMC analysis error: {e}")
            raise HTTPException(status_code=500, detail=str(e))
    
    @router.get("/status")
    async def get_status():
        """Get SMC service status"""
        return smc_service.get_status()
    
    return router


# ==========================================
# STANDALONE SERVER
# ==========================================

def create_app() -> FastAPI:
    """Create FastAPI application"""
    app = FastAPI(
        title="SMC Strategy API",
        description="Smart Money Concept & Institutional Order Flow Analysis",
        version="1.0.0"
    )
    
    # Add SMC router
    smc_service = SMCService()
    smc_router = create_smc_router(smc_service)
    app.include_router(smc_router)
    
    @app.get("/")
    async def root():
        return {
            "service": "SMC Strategy API",
            "version": "1.0.0",
            "endpoints": [
                "POST /api/smc/analyze",
                "GET /api/smc/status"
            ]
        }
    
    return app


# ==========================================
# CLI TEST
# ==========================================

if __name__ == "__main__":
    import json
    import random
    from datetime import timedelta
    
    print("\n🎯 SMC Service - Standalone Test")
    print("=" * 50)
    
    # Create service
    service = SMCService()
    
    # Generate test data
    base_time = int(datetime.now().timestamp())
    
    # H4 candles
    ohlc_h4 = []
    price = 1950.0
    for i in range(200):
        candle_time = base_time - (200 - i) * 4 * 3600
        open_price = price
        close_price = price + random.uniform(-3, 5)
        high_price = max(open_price, close_price) + random.uniform(0, 3)
        low_price = min(open_price, close_price) - random.uniform(0, 3)
        
        ohlc_h4.append(CandleData(
            time=candle_time,
            open=open_price,
            high=high_price,
            low=low_price,
            close=close_price,
            volume=random.uniform(1000, 5000)
        ))
        
        price = close_price
    
    # M15 candles
    ohlc_m15 = []
    price = ohlc_h4[-1].close
    for i in range(50):
        candle_time = base_time - (50 - i) * 15 * 60
        open_price = price
        close_price = price + random.uniform(-1, 2)
        high_price = max(open_price, close_price) + random.uniform(0, 1)
        low_price = min(open_price, close_price) - random.uniform(0, 1)
        
        ohlc_m15.append(CandleData(
            time=candle_time,
            open=open_price,
            high=high_price,
            low=low_price,
            close=close_price,
            volume=random.uniform(100, 500)
        ))
        
        price = close_price
    
    current_price = ohlc_m15[-1].close
    
    # Zones (price in demand zone for this test)
    zones = [
        ZoneData(
            type='demand',
            status='fresh',
            high=current_price + 3,
            low=current_price - 3,
            strength=85,
            created_at=base_time - 3600,
            tested_count=0
        )
    ]
    
    # Create request
    request = SMCAnalysisRequest(
        ohlc_h4=ohlc_h4,
        ohlc_m15=ohlc_m15,
        supply_demand_zones=zones,
        market_structure=MarketStructureData(trend='bullish'),
        current_volume=300.0,
        symbol='XAUUSD'
    )
    
    print(f"\n📊 Current Price: {current_price:.2f}")
    print(f"📈 H4 Candles: {len(ohlc_h4)}")
    print(f"📉 M15 Candles: {len(ohlc_m15)}")
    print(f"🎯 Zones: {len(zones)}")
    
    # Run analysis
    result = service.analyze(request)
    
    print(f"\n{'=' * 50}")
    print("📋 ANALYSIS RESULT:")
    print(f"{'=' * 50}")
    print(f"\n🎯 Decision: {result.decision}")
    print(f"📊 Confidence: {result.confidence_score}%")
    print(f"💡 Logic: {result.logic}")
    
    if result.setup:
        print(f"\n📈 Setup:")
        print(f"   Entry: {result.setup.entry}")
        print(f"   SL: {result.setup.sl}")
        print(f"   TP1: {result.setup.tp1} (RRR {result.setup.rrr_tp1})")
        print(f"   TP2: {result.setup.tp2} (RRR {result.setup.rrr_tp2})")
    
    if result.analysis:
        print(f"\n📊 Analysis Details:")
        print(f"   Trend H4: {result.analysis.trend_h4}")
        print(f"   Confirmation: {result.analysis.confirmation}")
        print(f"   Market Structure: {result.analysis.market_structure}")
    
    # Status
    print(f"\n📊 Service Status:")
    status = service.get_status()
    for key, value in status.items():
        print(f"   {key}: {value}")
    
    print(f"\n✅ SMC Service test completed!")
    print(f"\nTo run as server: uvicorn smc_service:create_app --reload --port 8001")
