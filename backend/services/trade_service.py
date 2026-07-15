"""
Trade Execution Service
=======================
Centralized trade execution and order management.
Refactored from bot/trade_executor.py with proper logging.
"""

from typing import Dict, Any, Optional, List
from datetime import datetime
from dataclasses import dataclass
import time

from backend.core import logger
from backend.models import OrderResult, OrderStatus, Position, TradeRecord, SignalType


class TradeService:
    """
    Trade Execution Service
    
    Features:
    - Order execution (dry-run and live)
    - Position tracking
    - Trade history management
    - Stop Loss / Take Profit monitoring
    """
    
    def __init__(
        self,
        dry_run: bool = True,
        exchange_client: Optional[Any] = None
    ):
        """
        Initialize Trade Service.
        
        Args:
            dry_run: If True, simulate trades without execution
            exchange_client: Exchange client for live trading (e.g., CCXT)
        """
        self.dry_run = dry_run
        self.exchange = exchange_client
        
        self._positions: Dict[str, Position] = {}
        self._trade_history: List[TradeRecord] = []
        self._order_counter = 0
        self._idempotency: Dict[str, float] = {}
        self._idempotency_ttl = 60.0
        
        mode = "DRY-RUN" if dry_run else "LIVE"
        logger.info(f"TradeService initialized in {mode} mode")

    def is_duplicate(self, key: str) -> bool:
        """Check and record idempotency key for duplicate order protection."""
        if not key:
            return False

        now = time.time()

        # Clean expired entries
        expired = [k for k, ts in self._idempotency.items() if now - ts > self._idempotency_ttl]
        for k in expired:
            del self._idempotency[k]

        if key in self._idempotency:
            return True

        self._idempotency[key] = now
        return False
    
    def execute_order(
        self,
        symbol: str,
        order_type: SignalType,
        quantity: float,
        entry_price: float,
        stop_loss: float,
        take_profit: float
    ) -> OrderResult:
        """
        Execute a trade order.
        
        Args:
            symbol: Trading symbol
            order_type: BUY or SELL
            quantity: Position size (lot size)
            entry_price: Entry price
            stop_loss: Stop loss price
            take_profit: Take profit price
            
        Returns:
            OrderResult with execution status
        """
        self._order_counter += 1
        order_id = f"ORD-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}-{self._order_counter:04d}"
        
        if self.dry_run:
            return self._execute_dry_run(
                order_id, symbol, order_type, quantity,
                entry_price, stop_loss, take_profit
            )
        else:
            return self._execute_live(
                order_id, symbol, order_type, quantity,
                entry_price, stop_loss, take_profit
            )
    
    def _execute_dry_run(
        self,
        order_id: str,
        symbol: str,
        order_type: SignalType,
        quantity: float,
        entry_price: float,
        stop_loss: float,
        take_profit: float
    ) -> OrderResult:
        """Execute order in dry-run mode (simulation)."""
        
        # Simulate successful fill
        position = Position(
            id=order_id,
            symbol=symbol,
            type=order_type,
            entry_price=entry_price,
            current_price=entry_price,
            stop_loss=stop_loss,
            take_profit=take_profit,
            lot_size=quantity,
            pnl=0.0,
            pnl_percent=0.0,
            opened_at=datetime.utcnow()
        )
        
        self._positions[order_id] = position
        
        logger.info(
            f"[DRY-RUN] Order executed: {order_type.value} {symbol} "
            f"Qty={quantity:.4f} @ {entry_price:.5f}, "
            f"SL={stop_loss:.5f}, TP={take_profit:.5f}"
        )
        
        return OrderResult(
            success=True,
            order_id=order_id,
            status=OrderStatus.FILLED,
            filled_price=entry_price,
            filled_quantity=quantity,
            message="Order filled (dry-run)",
            timestamp=datetime.utcnow()
        )
    
    def _execute_live(
        self,
        order_id: str,
        symbol: str,
        order_type: SignalType,
        quantity: float,
        entry_price: float,
        stop_loss: float,
        take_profit: float
    ) -> OrderResult:
        """Execute order on live exchange."""
        
        if not self.exchange:
            logger.error("No exchange client configured for live trading")
            return OrderResult(
                success=False,
                order_id=order_id,
                status=OrderStatus.REJECTED,
                message="No exchange client configured",
                timestamp=datetime.utcnow()
            )
        
        try:
            # Execute via exchange client
            side = 'buy' if order_type == SignalType.BUY else 'sell'
            
            order = self.exchange.create_order(
                symbol=symbol,
                type='market',
                side=side,
                amount=quantity,
                params={
                    'stopLoss': {'triggerPrice': stop_loss},
                    'takeProfit': {'triggerPrice': take_profit}
                }
            )
            
            filled_price = order.get('average', entry_price)
            filled_qty = order.get('filled', quantity)
            
            # Track position
            position = Position(
                id=order['id'],
                symbol=symbol,
                type=order_type,
                entry_price=filled_price,
                current_price=filled_price,
                stop_loss=stop_loss,
                take_profit=take_profit,
                lot_size=filled_qty,
                pnl=0.0,
                pnl_percent=0.0,
                opened_at=datetime.utcnow()
            )
            
            self._positions[order['id']] = position
            
            logger.info(
                f"[LIVE] Order executed: {order_type.value} {symbol} "
                f"Qty={filled_qty:.4f} @ {filled_price:.5f}"
            )
            
            return OrderResult(
                success=True,
                order_id=order['id'],
                status=OrderStatus.FILLED,
                filled_price=filled_price,
                filled_quantity=filled_qty,
                message="Order filled",
                timestamp=datetime.utcnow()
            )
            
        except Exception as e:
            logger.error(f"Order execution failed: {e}")
            return OrderResult(
                success=False,
                order_id=order_id,
                status=OrderStatus.REJECTED,
                message=str(e),
                timestamp=datetime.utcnow()
            )
    
    def close_position(
        self,
        position_id: str,
        exit_price: float,
        reason: str = "manual"
    ) -> Optional[TradeRecord]:
        """Close an open position."""
        
        if position_id not in self._positions:
            logger.warning(f"Position not found: {position_id}")
            return None
        
        position = self._positions[position_id]
        
        # Calculate P&L
        if position.type == SignalType.BUY:
            pnl = (exit_price - position.entry_price) * position.lot_size * 100000
        else:
            pnl = (position.entry_price - exit_price) * position.lot_size * 100000
        
        # Create trade record
        record = TradeRecord(
            id=position_id,
            symbol=position.symbol,
            side=position.type,
            entry_price=position.entry_price,
            exit_price=exit_price,
            quantity=position.lot_size,
            stop_loss=position.stop_loss,
            take_profit=position.take_profit,
            status=reason,
            pnl=pnl,
            opened_at=position.opened_at,
            closed_at=datetime.utcnow()
        )
        
        self._trade_history.append(record)
        del self._positions[position_id]
        
        logger.info(
            f"Position closed: {position.symbol} "
            f"Entry={position.entry_price:.5f}, Exit={exit_price:.5f}, "
            f"P&L=${pnl:.2f}, Reason={reason}"
        )
        
        return record
    
    def get_positions(self) -> List[Position]:
        """Get all open positions."""
        return list(self._positions.values())
    
    def get_trade_history(self, limit: int = 50) -> List[TradeRecord]:
        """Get trade history."""
        return self._trade_history[-limit:]
    
    def update_position_price(self, position_id: str, current_price: float):
        """Update current price for a position and calculate P&L."""
        
        if position_id not in self._positions:
            return
        
        position = self._positions[position_id]
        position.current_price = current_price
        
        # Calculate unrealized P&L
        if position.type == SignalType.BUY:
            position.pnl = (current_price - position.entry_price) * position.lot_size * 100000
        else:
            position.pnl = (position.entry_price - current_price) * position.lot_size * 100000
        
        position.pnl_percent = (position.pnl / (position.entry_price * position.lot_size * 100000)) * 100
    
    def check_sl_tp(self, current_prices: Dict[str, float]) -> List[TradeRecord]:
        """Check if any position hit SL or TP."""
        
        closed_trades = []
        
        for pos_id, position in list(self._positions.items()):
            price = current_prices.get(position.symbol)
            if not price:
                continue
            
            # Update price
            self.update_position_price(pos_id, price)
            
            # Check stop loss
            if position.type == SignalType.BUY and price <= position.stop_loss:
                record = self.close_position(pos_id, price, "stopped_out")
                if record:
                    closed_trades.append(record)
                    
            elif position.type == SignalType.SELL and price >= position.stop_loss:
                record = self.close_position(pos_id, price, "stopped_out")
                if record:
                    closed_trades.append(record)
            
            # Check take profit
            elif position.type == SignalType.BUY and price >= position.take_profit:
                record = self.close_position(pos_id, price, "take_profit")
                if record:
                    closed_trades.append(record)
                    
            elif position.type == SignalType.SELL and price <= position.take_profit:
                record = self.close_position(pos_id, price, "take_profit")
                if record:
                    closed_trades.append(record)
        
        return closed_trades
    
    def get_statistics(self) -> Dict[str, Any]:
        """Get trading statistics."""
        
        if not self._trade_history:
            return {
                'total_trades': 0,
                'winning_trades': 0,
                'losing_trades': 0,
                'win_rate': 0.0,
                'total_pnl': 0.0,
                'average_pnl': 0.0,
                'best_trade': 0.0,
                'worst_trade': 0.0
            }
        
        pnls = [t.pnl for t in self._trade_history]
        winning = [p for p in pnls if p > 0]
        losing = [p for p in pnls if p < 0]
        
        return {
            'total_trades': len(self._trade_history),
            'winning_trades': len(winning),
            'losing_trades': len(losing),
            'win_rate': len(winning) / len(self._trade_history) * 100,
            'total_pnl': sum(pnls),
            'average_pnl': sum(pnls) / len(pnls),
            'best_trade': max(pnls) if pnls else 0.0,
            'worst_trade': min(pnls) if pnls else 0.0
        }
