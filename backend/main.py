"""
Main Application Entry Point
============================
FastAPI application initialization - minimal, clean entry point.
All logic is delegated to modules.
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend import router, health_router, get_settings, logger, __version__


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    settings = get_settings()
    logger.info(f"🚀 Trading Bot API v{__version__} starting...")
    logger.info(f"   Mode: {'DRY-RUN' if settings.dry_run else 'LIVE'}")
    logger.info(f"   Default Symbol: {settings.default_symbol}")
    logger.info(f"   Risk Limit: {settings.max_risk_percent}%")
    
    yield
    
    logger.info("👋 Trading Bot API shutting down...")


def create_app() -> FastAPI:
    """Create and configure FastAPI application."""
    settings = get_settings()
    
    app = FastAPI(
        title="Forex Trading Bot API",
        description="Professional trading bot with SMC strategy",
        version=__version__,
        lifespan=lifespan
    )
    
    # CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    
    # Include routers
    app.include_router(health_router)
    app.include_router(router)
    
    return app


# Create app instance
app = create_app()


if __name__ == "__main__":
    import uvicorn
    
    settings = get_settings()
    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=True
    )
