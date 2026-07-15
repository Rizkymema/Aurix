"""
Trading Bot Backend
===================
Refactored FastAPI backend with clean architecture.

Structure:
- backend/core/      - Configuration, logging, utilities
- backend/models/    - Pydantic schemas and data models
- backend/services/  - Business logic services
- backend/api/       - API routes and endpoints
"""

from backend.core import Settings, get_settings, logger, setup_logging
from backend.models import *
from backend.services import *
from backend.api import router, health_router

__version__ = "2.0.0"

__all__ = [
    # Core
    'Settings',
    'get_settings',
    'logger',
    'setup_logging',
    
    # API
    'router',
    'health_router',
    
    # Version
    '__version__',
]
