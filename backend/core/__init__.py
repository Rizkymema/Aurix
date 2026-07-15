"""
Backend Core Module
====================
Configuration, logging, and core utilities for the trading bot.
"""

from .config import Settings, get_settings
from .logging import setup_logging, logger

__all__ = [
    'Settings',
    'get_settings',
    'setup_logging',
    'logger',
]
