#!/usr/bin/env python3
import json
import sys
from datetime import datetime, timezone

import MetaTrader5 as mt5


TIMEFRAME_MAP = {
    "1m": mt5.TIMEFRAME_M1,
    "5m": mt5.TIMEFRAME_M5,
    "15m": mt5.TIMEFRAME_M15,
    "30m": mt5.TIMEFRAME_M30,
    "1h": mt5.TIMEFRAME_H1,
    "4h": mt5.TIMEFRAME_H4,
    "1d": mt5.TIMEFRAME_D1,
}


def fail(message: str, code: int = 1) -> None:
    print(json.dumps({"ok": False, "error": message}))
    sys.exit(code)


def emit(payload: dict) -> None:
    print(json.dumps({"ok": True, **payload}))


def ensure_initialized() -> None:
    if not mt5.initialize():
        fail(f"MT5 initialize failed: {mt5.last_error()}")


def ensure_symbol(symbol: str) -> None:
    info = mt5.symbol_info(symbol)
    if info is None:
        fail(f"Symbol not found: {symbol}")
    if not info.visible and not mt5.symbol_select(symbol, True):
        fail(f"Symbol not visible and could not be selected: {symbol}")


def get_account_info() -> dict:
    ensure_initialized()
    account = mt5.account_info()
    terminal = mt5.terminal_info()
    if account is None:
        raise RuntimeError("No MT5 account is currently connected")

    return {
        "account": {
            "login": account.login,
            "server": account.server,
            "broker": account.company,
            "name": account.name,
            "balance": account.balance,
            "equity": account.equity,
            "currency": account.currency,
            "leverage": account.leverage,
        },
        "terminal": {
            "name": getattr(terminal, "name", None),
            "company": getattr(terminal, "company", None),
            "connected": getattr(terminal, "connected", None),
            "trade_allowed": getattr(terminal, "trade_allowed", None),
            "path": getattr(terminal, "path", None),
        },
    }


def get_tick(symbol: str) -> dict:
    ensure_initialized()
    ensure_symbol(symbol)
    tick = mt5.symbol_info_tick(symbol)
    info = mt5.symbol_info(symbol)
    account = mt5.account_info()
    if tick is None or info is None:
        raise RuntimeError(f"No tick data for symbol: {symbol}")

    price = None
    if tick.bid and tick.ask:
        price = (tick.bid + tick.ask) / 2
    elif tick.last:
        price = tick.last

    if price is None:
        raise RuntimeError(f"No usable price for symbol: {symbol}")

    return {
        "symbol": symbol,
        "price": price,
        "bid": tick.bid,
        "ask": tick.ask,
        "last": tick.last,
        "spread": info.spread,
        "digits": info.digits,
        "time": tick.time,
        "time_iso": datetime.fromtimestamp(tick.time, tz=timezone.utc).isoformat(),
        "source": f"MT5-local:{account.server if account else 'unknown'}",
    }


def get_candles(symbol: str, interval: str, limit: int) -> dict:
    ensure_initialized()
    ensure_symbol(symbol)
    timeframe = TIMEFRAME_MAP.get(interval)
    if timeframe is None:
        raise ValueError(f"Unsupported timeframe: {interval}")

    rates = mt5.copy_rates_from_pos(symbol, timeframe, 0, limit)
    account = mt5.account_info()
    if rates is None:
        raise RuntimeError(f"No rates returned for {symbol} {interval}")

    candles = []
    for rate in rates:
        candles.append(
            {
                "time": int(rate["time"]),
                "open": float(rate["open"]),
                "high": float(rate["high"]),
                "low": float(rate["low"]),
                "close": float(rate["close"]),
                "tick_volume": int(rate["tick_volume"]),
            }
        )

    return {
        "symbol": symbol,
        "interval": interval,
        "count": len(candles),
        "candles": candles,
        "source": f"MT5-local:{account.server if account else 'unknown'}",
    }


def main() -> None:
    if len(sys.argv) < 2:
        fail("Usage: mt5_bridge.py <account-info|tick|candles> [args...]")

    command = sys.argv[1]
    try:
        if command == "account-info":
            emit(get_account_info())
        elif command == "tick":
            if len(sys.argv) < 3:
                fail("Usage: mt5_bridge.py tick <SYMBOL>")
            emit(get_tick(sys.argv[2].upper()))
        elif command == "candles":
            if len(sys.argv) < 5:
                fail("Usage: mt5_bridge.py candles <SYMBOL> <INTERVAL> <LIMIT>")
            emit(get_candles(sys.argv[2].upper(), sys.argv[3], int(sys.argv[4])))
        else:
            fail(f"Unknown command: {command}")
    finally:
        mt5.shutdown()


if __name__ == "__main__":
    main()
