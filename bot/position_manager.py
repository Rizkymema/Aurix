"""
PositionManager - Active Position Management
============================================
Mengelola posisi aktif dengan:
- Auto Breakeven (geser SL ke entry saat profit 1:1)
- Partial Close (50% di TP1, sisanya ke TP2)
- Trailing Stop otomatis
- Position monitoring real-time

Features:
- Auto move SL to entry saat RRR 1:1 tercapai
- Partial close 50% di TP1 (RRR 1:1.5)
- Trailing stop untuk sisa 50% menuju TP2 (RRR 1:3)
"""

from dataclasses import dataclass, field
from typing import Dict, Any, Optional, List
from datetime import datetime
from enum import Enum
import logging
import asyncio

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class PositionState(Enum):
    """Status posisi"""
    ACTIVE = "active"
    BREAKEVEN = "breakeven"  # SL sudah di entry
    PARTIAL_CLOSED = "partial_closed"  # 50% sudah close di TP1
    TRAILING = "trailing"  # Trailing stop active
    CLOSED = "closed"


@dataclass
class ManagedPosition:
    """Position dengan active management"""
    position_id: str
    symbol: str
    side: str  # 'BUY' or 'SELL'
    entry_price: float
    quantity: float
    original_quantity: float
    stop_loss: float
    tp1: float  # TP1 at RRR 1:1.5
    tp2: float  # TP2 at RRR 1:3
    opened_at: datetime
    state: PositionState = PositionState.ACTIVE
    breakeven_triggered: bool = False
    partial_close_done: bool = False
    trailing_stop: Optional[float] = None
    trailing_distance_pips: float = 20.0  # Trailing stop distance
    highest_profit_price: Optional[float] = None
    pnl: float = 0.0
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def calculate_pnl(self, current_price: float) -> float:
        """Calculate current P&L"""
        if self.side == 'BUY':
            self.pnl = (current_price - self.entry_price) * self.quantity
        else:
            self.pnl = (self.entry_price - current_price) * self.quantity
        return self.pnl
    
    def calculate_rrr_achieved(self, current_price: float) -> float:
        """Calculate RRR yang sudah tercapai"""
        profit_pips = abs(current_price - self.entry_price)
        risk_pips = abs(self.entry_price - self.stop_loss)
        
        if risk_pips == 0:
            return 0.0
        
        return profit_pips / risk_pips
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'position_id': self.position_id,
            'symbol': self.symbol,
            'side': self.side,
            'entry_price': self.entry_price,
            'quantity': self.quantity,
            'original_quantity': self.original_quantity,
            'stop_loss': self.stop_loss,
            'tp1': self.tp1,
            'tp2': self.tp2,
            'state': self.state.value,
            'breakeven_triggered': self.breakeven_triggered,
            'partial_close_done': self.partial_close_done,
            'trailing_stop': self.trailing_stop,
            'pnl': round(self.pnl, 2),
            'opened_at': self.opened_at.isoformat()
        }


class PositionManager:
    """
    Mengelola posisi dengan auto breakeven dan partial close
    
    Rules:
    1. RRR 1:1 = Auto Breakeven (SL → Entry)
    2. RRR 1:1.5 = Partial Close 50% di TP1
    3. RRR 1:3 = TP2 dengan Trailing Stop
    """
    
    def __init__(
        self,
        executor,  # TradeExecutor instance
        risk_manager,  # RiskManager instance
        breakeven_rrr: float = 1.0,
        partial_close_rrr: float = 1.5,
        partial_close_percent: float = 50.0,
        trailing_distance_pips: float = 20.0
    ):
        """
        Initialize Position Manager
        
        Args:
            executor: TradeExecutor untuk close positions
            risk_manager: RiskManager untuk pip calculations
            breakeven_rrr: RRR untuk trigger breakeven (default: 1.0)
            partial_close_rrr: RRR untuk partial close (default: 1.5)
            partial_close_percent: Persentase close di TP1 (default: 50%)
            trailing_distance_pips: Jarak trailing stop (default: 20 pips)
        """
        self.executor = executor
        self.risk_manager = risk_manager
        self.breakeven_rrr = breakeven_rrr
        self.partial_close_rrr = partial_close_rrr
        self.partial_close_percent = partial_close_percent
        self.trailing_distance_pips = trailing_distance_pips
        
        self.managed_positions: Dict[str, ManagedPosition] = {}
        self.is_monitoring = False
        
        logger.info(f"PositionManager initialized")
        logger.info(f"  Breakeven RRR: {breakeven_rrr}")
        logger.info(f"  Partial Close: {partial_close_percent}% @ RRR {partial_close_rrr}")
        logger.info(f"  Trailing Stop: {trailing_distance_pips} pips")
    
    def add_position(
        self,
        position_id: str,
        symbol: str,
        side: str,
        entry_price: float,
        quantity: float,
        stop_loss: float,
        take_profit: float
    ) -> ManagedPosition:
        """
        Tambah posisi untuk di-manage
        
        Args:
            position_id: ID posisi dari broker
            symbol: Trading pair
            side: 'BUY' or 'SELL'
            entry_price: Harga entry
            quantity: Lot size
            stop_loss: Stop loss price
            take_profit: Final take profit (TP2)
            
        Returns:
            ManagedPosition object
        """
        # Calculate TP levels
        sl_distance = abs(entry_price - stop_loss)
        
        if side == 'BUY':
            tp1 = entry_price + (sl_distance * self.partial_close_rrr)
            tp2 = take_profit  # Final TP (RRR 1:3)
        else:
            tp1 = entry_price - (sl_distance * self.partial_close_rrr)
            tp2 = take_profit
        
        position = ManagedPosition(
            position_id=position_id,
            symbol=symbol,
            side=side,
            entry_price=entry_price,
            quantity=quantity,
            original_quantity=quantity,
            stop_loss=stop_loss,
            tp1=tp1,
            tp2=tp2,
            opened_at=datetime.now(),
            trailing_distance_pips=self.trailing_distance_pips
        )
        
        self.managed_positions[position_id] = position
        
        logger.info(f"✅ Position added to management: {position_id}")
        logger.info(f"   {side} {quantity} {symbol} @ {entry_price}")
        logger.info(f"   TP1 @ {tp1} (RRR {self.partial_close_rrr})")
        logger.info(f"   TP2 @ {tp2}")
        
        return position
    
    async def check_breakeven(
        self,
        position: ManagedPosition,
        current_price: float
    ) -> bool:
        """
        Check dan trigger auto breakeven
        
        Returns:
            True jika breakeven triggered
        """
        if position.breakeven_triggered:
            return False
        
        rrr_achieved = position.calculate_rrr_achieved(current_price)
        
        if rrr_achieved >= self.breakeven_rrr:
            # Move SL to entry
            old_sl = position.stop_loss
            position.stop_loss = position.entry_price
            position.breakeven_triggered = True
            position.state = PositionState.BREAKEVEN
            
            logger.info(f"🎯 BREAKEVEN triggered for {position.position_id}!")
            logger.info(f"   SL moved: {old_sl} → {position.entry_price}")
            logger.info(f"   Current RRR: {rrr_achieved:.2f}")
            
            # Update SL di broker (jika executor support)
            try:
                # TODO: Implement modify_position in executor
                # await self.executor.modify_stop_loss(position.position_id, position.entry_price)
                pass
            except Exception as e:
                logger.error(f"Failed to modify SL: {e}")
            
            return True
        
        return False
    
    async def check_partial_close(
        self,
        position: ManagedPosition,
        current_price: float
    ) -> bool:
        """
        Check dan eksekusi partial close di TP1
        
        Returns:
            True jika partial close executed
        """
        if position.partial_close_done:
            return False
        
        # Check if price reached TP1
        tp1_reached = False
        if position.side == 'BUY':
            tp1_reached = current_price >= position.tp1
        else:
            tp1_reached = current_price <= position.tp1
        
        if tp1_reached:
            # Close 50% position
            close_quantity = position.original_quantity * (self.partial_close_percent / 100)
            
            logger.info(f"💰 PARTIAL CLOSE triggered for {position.position_id}!")
            logger.info(f"   Closing {self.partial_close_percent}% ({close_quantity} lots) @ {current_price}")
            
            try:
                # Execute partial close
                # TODO: Implement partial close in executor
                # result = await self.executor.close_partial(position.position_id, close_quantity, current_price)
                
                # Update position
                position.quantity = position.original_quantity - close_quantity
                position.partial_close_done = True
                position.state = PositionState.PARTIAL_CLOSED
                
                # Calculate P&L for closed portion
                if position.side == 'BUY':
                    partial_pnl = (current_price - position.entry_price) * close_quantity
                else:
                    partial_pnl = (position.entry_price - current_price) * close_quantity
                
                logger.info(f"   ✅ Partial close done. P&L: ${partial_pnl:.2f}")
                logger.info(f"   Remaining: {position.quantity} lots running to TP2")
                
                # Activate trailing stop for remaining
                position.state = PositionState.TRAILING
                position.highest_profit_price = current_price
                
                return True
                
            except Exception as e:
                logger.error(f"Failed to execute partial close: {e}")
                return False
        
        return False
    
    async def update_trailing_stop(
        self,
        position: ManagedPosition,
        current_price: float
    ) -> bool:
        """
        Update trailing stop untuk sisa posisi
        
        Returns:
            True jika trailing stop updated
        """
        if not position.partial_close_done:
            return False
        
        # Update highest profit price
        if position.side == 'BUY':
            if position.highest_profit_price is None or current_price > position.highest_profit_price:
                position.highest_profit_price = current_price
        else:
            if position.highest_profit_price is None or current_price < position.highest_profit_price:
                position.highest_profit_price = current_price
        
        # Calculate trailing stop
        symbol_upper = position.symbol.upper()
        if 'JPY' in symbol_upper:
            pip_size = 0.01
        elif 'BTC' in symbol_upper or 'ETH' in symbol_upper:
            pip_size = 1.0
        elif 'XAU' in symbol_upper:
            pip_size = 0.1
        else:
            pip_size = 0.0001
        
        trailing_distance = self.trailing_distance_pips * pip_size
        
        if position.side == 'BUY':
            new_trailing_sl = position.highest_profit_price - trailing_distance
            
            # Only update if new SL is better
            if new_trailing_sl > position.stop_loss:
                old_sl = position.stop_loss
                position.stop_loss = new_trailing_sl
                position.trailing_stop = new_trailing_sl
                
                logger.info(f"📈 TRAILING STOP updated for {position.position_id}")
                logger.info(f"   SL moved: {old_sl:.4f} → {new_trailing_sl:.4f}")
                
                return True
        else:
            new_trailing_sl = position.highest_profit_price + trailing_distance
            
            if new_trailing_sl < position.stop_loss:
                old_sl = position.stop_loss
                position.stop_loss = new_trailing_sl
                position.trailing_stop = new_trailing_sl
                
                logger.info(f"📉 TRAILING STOP updated for {position.position_id}")
                logger.info(f"   SL moved: {old_sl:.4f} → {new_trailing_sl:.4f}")
                
                return True
        
        return False
    
    async def monitor_position(
        self,
        position: ManagedPosition,
        current_price: float
    ):
        """
        Monitor dan manage satu posisi
        
        Sequence:
        1. Check auto breakeven (RRR 1:1)
        2. Check partial close (RRR 1:1.5)
        3. Update trailing stop (after partial close)
        """
        # Calculate current P&L
        position.calculate_pnl(current_price)
        
        # Check breakeven first
        if not position.breakeven_triggered:
            await self.check_breakeven(position, current_price)
        
        # Check partial close
        if not position.partial_close_done:
            await self.check_partial_close(position, current_price)
        
        # Update trailing stop (if partial close done)
        if position.partial_close_done:
            await self.update_trailing_stop(position, current_price)
    
    async def monitor_all_positions(self):
        """
        Monitor semua posisi aktif (continuous loop)
        
        USAGE: Jalankan di background task
        """
        self.is_monitoring = True
        logger.info("🔄 Position monitoring started")
        
        while self.is_monitoring:
            try:
                for position_id, position in list(self.managed_positions.items()):
                    if position.state == PositionState.CLOSED:
                        continue
                    
                    # Get current price (TODO: implement get_current_price)
                    # current_price = await self.executor.get_current_price(position.symbol)
                    # await self.monitor_position(position, current_price)
                    
                    pass
                
                # Sleep 1 second before next check
                await asyncio.sleep(1)
                
            except Exception as e:
                logger.error(f"Error in position monitoring: {e}")
                await asyncio.sleep(5)
    
    def stop_monitoring(self):
        """Stop position monitoring"""
        self.is_monitoring = False
        logger.info("🛑 Position monitoring stopped")
    
    def get_position(self, position_id: str) -> Optional[ManagedPosition]:
        """Get managed position by ID"""
        return self.managed_positions.get(position_id)
    
    def get_all_positions(self) -> List[ManagedPosition]:
        """Get all managed positions"""
        return list(self.managed_positions.values())
    
    def get_active_positions(self) -> List[ManagedPosition]:
        """Get only active positions"""
        return [p for p in self.managed_positions.values() if p.state != PositionState.CLOSED]
    
    def close_position(self, position_id: str):
        """Mark position as closed"""
        if position_id in self.managed_positions:
            self.managed_positions[position_id].state = PositionState.CLOSED
            logger.info(f"Position {position_id} marked as CLOSED")
    
    def get_statistics(self) -> Dict[str, Any]:
        """Get position management statistics"""
        all_pos = self.get_all_positions()
        active_pos = self.get_active_positions()
        
        breakeven_count = sum(1 for p in all_pos if p.breakeven_triggered)
        partial_close_count = sum(1 for p in all_pos if p.partial_close_done)
        
        total_pnl = sum(p.pnl for p in all_pos)
        
        return {
            'total_positions': len(all_pos),
            'active_positions': len(active_pos),
            'breakeven_triggered': breakeven_count,
            'partial_closes': partial_close_count,
            'total_pnl': round(total_pnl, 2),
            'is_monitoring': self.is_monitoring
        }


# =======================
# USAGE EXAMPLE
# =======================
if __name__ == "__main__":
    async def main():
        from trade_executor import TradeExecutor
        from risk_manager import RiskManager
        
        # Initialize components
        executor = TradeExecutor(dry_run=True)
        await executor.initialize()
        
        risk_mgr = RiskManager(equity=10000.0)
        
        # Initialize position manager
        pos_mgr = PositionManager(
            executor=executor,
            risk_manager=risk_mgr,
            breakeven_rrr=1.0,
            partial_close_rrr=1.5,
            partial_close_percent=50.0,
            trailing_distance_pips=20.0
        )
        
        # Add position
        position = pos_mgr.add_position(
            position_id="TEST_001",
            symbol="XAUUSD",
            side="BUY",
            entry_price=2050.00,
            quantity=0.1,
            stop_loss=2040.00,
            take_profit=2080.00  # TP2 (RRR 1:3)
        )
        
        print(f"\n📊 Position Added:")
        print(f"   Entry: {position.entry_price}")
        print(f"   TP1: {position.tp1} (RRR 1:1.5)")
        print(f"   TP2: {position.tp2}")
        
        # Simulate price movement
        test_prices = [2050, 2055, 2060, 2065, 2070]
        
        for price in test_prices:
            print(f"\n💹 Current Price: {price}")
            await pos_mgr.monitor_position(position, price)
            print(f"   State: {position.state.value}")
            print(f"   SL: {position.stop_loss}")
            print(f"   Quantity: {position.quantity}")
        
        # Get statistics
        stats = pos_mgr.get_statistics()
        print(f"\n📈 Statistics:")
        for key, value in stats.items():
            print(f"   {key}: {value}")
        
        await executor.shutdown()
    
    asyncio.run(main())
