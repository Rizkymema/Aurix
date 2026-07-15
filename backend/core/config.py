"""
Configuration Management
========================
Centralized configuration using Pydantic Settings.
All environment variables are loaded from .env file.
"""

import os
from functools import lru_cache
from typing import Optional
from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""
    
    # App Config
    app_name: str = Field(default="Forex Trading Bot", env="APP_NAME")
    debug: bool = Field(default=False, env="DEBUG")
    
    # API Server
    host: str = Field(default="0.0.0.0", env="HOST")
    port: int = Field(default=8000, env="PORT")
    
    # CORS
    cors_origins: list[str] = Field(
        default=["http://localhost:3000", "http://127.0.0.1:3000"],
        env="CORS_ORIGINS"
    )
    
    # Trading Config
    default_symbol: str = Field(default="XAUUSD", env="DEFAULT_SYMBOL")
    default_timeframe: str = Field(default="15m", env="DEFAULT_TIMEFRAME")
    dry_run: bool = Field(default=True, env="DRY_RUN")
    
    # Risk Management
    default_equity: float = Field(default=10000.0, env="DEFAULT_EQUITY")
    risk_percent: float = Field(default=1.0, env="RISK_PERCENT")
    max_risk_percent: float = Field(default=2.0, env="MAX_RISK_PERCENT")
    leverage: int = Field(default=100, env="LEVERAGE")
    
    # Exchange API (sensitive - must be in .env)
    exchange_api_key: Optional[str] = Field(default=None, env="EXCHANGE_API_KEY")
    exchange_api_secret: Optional[str] = Field(default=None, env="EXCHANGE_API_SECRET")
    exchange_sandbox: bool = Field(default=True, env="EXCHANGE_SANDBOX")
    
    # External APIs
    twelve_data_api_key: str = Field(default="demo", env="TWELVE_DATA_API_KEY")
    alpha_vantage_api_key: str = Field(default="demo", env="ALPHA_VANTAGE_API_KEY")
    gemini_api_key: Optional[str] = Field(default=None, env="GEMINI_API_KEY")
    kol_api_key: str = Field(default="demo", env="KOL_API_KEY")

    # API Protection
    bot_api_key: Optional[str] = Field(default=None, env="BOT_API_KEY")
    
    # Strategy Parameters
    ema_fast: int = Field(default=9, env="EMA_FAST")
    ema_medium: int = Field(default=21, env="EMA_MEDIUM")
    ema_slow: int = Field(default=200, env="EMA_SLOW")
    min_confidence: float = Field(default=60.0, env="MIN_CONFIDENCE")
    min_rrr: float = Field(default=1.5, env="MIN_RRR")
    
    # Bot Loop Settings
    analysis_interval: int = Field(default=60, env="ANALYSIS_INTERVAL")
    max_open_positions: int = Field(default=1, env="MAX_OPEN_POSITIONS")
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
