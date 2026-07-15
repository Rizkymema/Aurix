"""
Logging Configuration
=====================
Centralized logging setup for the entire backend.
Replaces all print() statements with proper logging.
"""

import logging
import sys
from datetime import datetime
from typing import Optional
from pathlib import Path


# Create logs directory
LOGS_DIR = Path(__file__).parent.parent / "logs"
LOGS_DIR.mkdir(exist_ok=True)


class ColoredFormatter(logging.Formatter):
    """Custom formatter with colors for console output."""
    
    COLORS = {
        'DEBUG': '\033[36m',     # Cyan
        'INFO': '\033[32m',      # Green
        'WARNING': '\033[33m',   # Yellow
        'ERROR': '\033[31m',     # Red
        'CRITICAL': '\033[35m',  # Magenta
    }
    RESET = '\033[0m'
    
    def format(self, record):
        color = self.COLORS.get(record.levelname, self.RESET)
        record.levelname = f"{color}{record.levelname}{self.RESET}"
        return super().format(record)


def setup_logging(
    level: str = "INFO",
    log_file: Optional[str] = None,
    module_name: str = "trading_bot"
) -> logging.Logger:
    """
    Setup logging configuration.
    
    Args:
        level: Log level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        log_file: Optional log file name
        module_name: Logger name
        
    Returns:
        Configured logger instance
    """
    logger = logging.getLogger(module_name)
    logger.setLevel(getattr(logging, level.upper()))
    
    # Clear existing handlers
    logger.handlers.clear()
    
    # Console handler with colors
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.DEBUG)
    console_format = ColoredFormatter(
        '%(asctime)s | %(levelname)s | %(name)s | %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    console_handler.setFormatter(console_format)
    logger.addHandler(console_handler)
    
    # File handler (if specified)
    if log_file:
        file_path = LOGS_DIR / log_file
        file_handler = logging.FileHandler(file_path, encoding='utf-8')
        file_handler.setLevel(logging.DEBUG)
        file_format = logging.Formatter(
            '%(asctime)s | %(levelname)s | %(name)s | %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )
        file_handler.setFormatter(file_format)
        logger.addHandler(file_handler)
    
    return logger


# Default logger instance
logger = setup_logging(level="INFO", log_file="bot.log", module_name="trading_bot")


# Convenience functions
def log_trade(action: str, symbol: str, price: float, **kwargs):
    """Log trade action with structured data."""
    extra_info = " | ".join(f"{k}={v}" for k, v in kwargs.items())
    logger.info(f"TRADE | {action} | {symbol} @ {price:.5f} | {extra_info}")


def log_signal(signal_type: str, confidence: float, symbol: str, **kwargs):
    """Log signal generation."""
    extra_info = " | ".join(f"{k}={v}" for k, v in kwargs.items())
    logger.info(f"SIGNAL | {signal_type} | {symbol} | Confidence: {confidence:.1f}% | {extra_info}")


def log_error(message: str, exc: Optional[Exception] = None):
    """Log error with optional exception."""
    if exc:
        logger.error(f"{message}: {type(exc).__name__}: {exc}")
    else:
        logger.error(message)
