#!/usr/bin/env python3
"""Authenticated HTTP bridge from a local MT5 terminal to the dashboard backend."""

import hmac
import os
from threading import Lock
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, status
from pydantic import Field
import uvicorn

from mt5_bridge import TIMEFRAME_MAP, get_account_info, get_candles, get_tick


app = FastAPI(title="MT5 Local Bridge", docs_url=None, redoc_url=None)
MAX_CANDLES = 1_000
SUPPORTED_SYMBOLS = {"XAUUSD", "XAGUSD", "EURUSD", "GBPUSD", "USDJPY"}
mt5_lock = Lock()


def require_bearer_token(
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    token = os.environ.get("MT5_BRIDGE_TOKEN")
    if not token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="MT5 bridge token is not configured",
        )

    expected = f"Bearer {token}"
    if not authorization or not hmac.compare_digest(authorization, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")


def normalize_symbol(symbol: str) -> str:
    normalized = symbol.upper()
    if normalized not in SUPPORTED_SYMBOLS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported symbol")
    return normalized


@app.get("/health")
def health(_: None = Depends(require_bearer_token)) -> dict:
    with mt5_lock:
        account = get_account_info()
    return {"ok": True, "connected": bool(account["terminal"].get("connected"))}


@app.get("/account")
def account(_: None = Depends(require_bearer_token)) -> dict:
    with mt5_lock:
        return {"ok": True, **get_account_info()}


@app.get("/tick/{symbol}")
def tick(symbol: str, _: None = Depends(require_bearer_token)) -> dict:
    with mt5_lock:
        return {"ok": True, **get_tick(normalize_symbol(symbol))}


@app.get("/candles/{symbol}/{interval}/{limit}")
def candles(
    symbol: str,
    interval: str,
    limit: Annotated[int, Field(ge=1, le=MAX_CANDLES)],
    _: None = Depends(require_bearer_token),
) -> dict:
    if interval not in TIMEFRAME_MAP:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported interval")
    with mt5_lock:
        return {"ok": True, **get_candles(normalize_symbol(symbol), interval, limit)}


if __name__ == "__main__":
    host = os.environ.get("MT5_BRIDGE_HOST", "127.0.0.1")
    port = int(os.environ.get("MT5_BRIDGE_PORT", "8765"))
    uvicorn.run(app, host=host, port=port, log_level="info")
