"""
Risk Management Service
=======================
Centralized risk management for position sizing and trade validation.
Refactored from bot/risk_manager.py with proper logging.
"""

from dataclasses import dataclass, asdict
from typing import Dict, Any, Optional, Tuple
from datetime import datetime

from backend.core import logger


@dataclass
class PositionSize:
    """Result of position size calculation."""
    lot_size: float
    units: int
    risk_amount: float
    risk_percent: float
    stop_loss_pips: float
    potential_loss: float
    potential_profit: float
    margin_required: float
    is_valid: bool
    warning: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'lot_size': round(self.lot_size, 4),
            'units': self.units,
            'risk_amount': round(self.risk_amount, 2),
            'risk_percent': round(self.risk_percent, 2),
            'stop_loss_pips': round(self.stop_loss_pips, 1),
            'potential_loss': round(self.potential_loss, 2),
            'potential_profit': round(self.potential_profit, 2),
            'margin_required': round(self.margin_required, 2),
            'is_valid': self.is_valid,
            'warning': self.warning
        }


class RiskService:
    """
    Risk Management Service
    
    Features:
    - Position size calculation based on % risk
    - Margin requirement validation
    - Maximum lot size checks
    - Support for Standard, Mini, Micro accounts
    
    Rules:
    - Risk per Trade: Maximum 1% of total equity
    - Formula: Volume = (Equity * Risk%) / SL_Distance_in_Money
    """
    
    # Lot size multipliers
    LOT_SIZES = {
        'standard': 100000,
        'mini': 10000,
        'micro': 1000,
    }
    
    # Pip values for common pairs (per standard lot in USD)
    PIP_VALUES = {
        'EURUSD': 10.0,
        'GBPUSD': 10.0,
        'AUDUSD': 10.0,
        'NZDUSD': 10.0,
        'USDCHF': 10.0,
        'USDCAD': 10.0,
        'USDJPY': 9.1,
        'EURJPY': 9.1,
        'GBPJPY': 9.1,
        'XAUUSD': 10.0,
        'BTCUSD': 1.0,
        'BTCUSDT': 1.0,
        'ETHUSD': 1.0,
        'ETHUSDT': 1.0,
    }
    
    MAX_SPREAD_PERCENT = 10.0
    
    def __init__(
        self,
        equity: float,
        leverage: int = 100,
        account_type: str = 'standard',
        max_risk_percent: float = 1.0,
        default_risk_percent: float = 1.0,
        min_rrr: float = 2.0,
        account_currency: str = 'USD'
    ):
        """
        Initialize Risk Service.
        
        Args:
            equity: Account equity in account currency
            leverage: Account leverage (default: 100)
            account_type: 'standard', 'mini', or 'micro'
            max_risk_percent: Maximum risk per trade (default: 1%)
            default_risk_percent: Default risk per trade (default: 1%)
            min_rrr: Minimum Risk/Reward Ratio (default: 2.0)
            account_currency: Account currency (default: 'USD')
        """
        self.equity = equity
        self.leverage = leverage
        self.account_type = account_type.lower()
        self.max_risk_percent = min(max_risk_percent, 2.0)  # Cap at 2%
        self.default_risk_percent = min(default_risk_percent, max_risk_percent)
        self.min_rrr = min_rrr
        self.account_currency = account_currency
        
        self.lot_multiplier = self.LOT_SIZES.get(self.account_type, 100000)
        
        logger.info(
            f"RiskService initialized: Equity=${equity:.2f}, "
            f"Leverage={leverage}x, Risk={self.default_risk_percent}%"
        )
    
    def calculate_position_size(
        self,
        symbol: str,
        entry_price: float,
        stop_loss: float,
        take_profit: Optional[float] = None,
        risk_percent: Optional[float] = None
    ) -> PositionSize:
        """
        Calculate optimal position size based on risk parameters.
        
        Args:
            symbol: Trading symbol (e.g., 'XAUUSD')
            entry_price: Entry price
            stop_loss: Stop loss price
            take_profit: Take profit price (optional)
            risk_percent: Risk percentage (uses default if not provided)
            
        Returns:
            PositionSize with calculated values
        """
        # Validate risk percent
        risk_pct = min(risk_percent or self.default_risk_percent, self.max_risk_percent)
        
        # Calculate SL distance in pips
        sl_distance = abs(entry_price - stop_loss)
        sl_pips = self._price_to_pips(symbol, sl_distance)
        
        if sl_pips <= 0:
            return PositionSize(
                lot_size=0, units=0, risk_amount=0, risk_percent=risk_pct,
                stop_loss_pips=0, potential_loss=0, potential_profit=0,
                margin_required=0, is_valid=False,
                warning="Invalid stop loss distance"
            )
        
        # Calculate risk amount
        risk_amount = self.equity * (risk_pct / 100)
        
        # Get pip value for symbol
        pip_value = self.PIP_VALUES.get(symbol.upper(), 10.0)
        
        # Calculate lot size: Risk Amount / (SL Pips * Pip Value)
        lot_size = risk_amount / (sl_pips * pip_value)
        
        # Round to reasonable precision
        lot_size = round(lot_size, 4)
        
        # Ensure minimum lot size
        min_lot = 0.01
        if lot_size < min_lot:
            lot_size = min_lot
            logger.warning(f"Lot size adjusted to minimum: {min_lot}")
        
        # Calculate units
        units = int(lot_size * self.lot_multiplier)
        
        # Calculate potential loss
        potential_loss = lot_size * sl_pips * pip_value
        
        # Calculate potential profit if TP provided
        potential_profit = 0.0
        if take_profit:
            tp_distance = abs(take_profit - entry_price)
            tp_pips = self._price_to_pips(symbol, tp_distance)
            potential_profit = lot_size * tp_pips * pip_value
        
        # Calculate margin required
        margin_required = (lot_size * self.lot_multiplier * entry_price) / self.leverage
        
        # Validate margin
        is_valid = margin_required <= self.equity * 0.5  # Max 50% margin usage
        warning = None if is_valid else "Insufficient margin"
        
        result = PositionSize(
            lot_size=lot_size,
            units=units,
            risk_amount=risk_amount,
            risk_percent=risk_pct,
            stop_loss_pips=sl_pips,
            potential_loss=potential_loss,
            potential_profit=potential_profit,
            margin_required=margin_required,
            is_valid=is_valid,
            warning=warning
        )
        
        logger.info(
            f"Position calculated for {symbol}: "
            f"Lot={lot_size:.4f}, Risk=${risk_amount:.2f} ({risk_pct}%), "
            f"SL={sl_pips:.1f}pips"
        )
        
        return result
    
    def validate_rrr(
        self,
        entry_price: float,
        stop_loss: float,
        take_profit: float
    ) -> Tuple[bool, float, str]:
        """
        Validate Risk/Reward Ratio.
        
        Returns:
            Tuple of (is_valid, rrr, reason)
        """
        risk_distance = abs(entry_price - stop_loss)
        reward_distance = abs(take_profit - entry_price)
        
        if risk_distance <= 0:
            return False, 0.0, "Invalid stop loss"
        
        rrr = reward_distance / risk_distance
        is_valid = rrr >= self.min_rrr
        
        reason = f"RRR {rrr:.2f} {'meets' if is_valid else 'below'} minimum {self.min_rrr}"
        
        return is_valid, rrr, reason
    
    def _price_to_pips(self, symbol: str, price_distance: float) -> float:
        """Convert price distance to pips based on symbol."""
        symbol_upper = symbol.upper()
        
        # JPY pairs have 2 decimal pips
        if 'JPY' in symbol_upper:
            return price_distance * 100
        
        # Gold/Metals
        if symbol_upper in ['XAUUSD', 'GOLD']:
            return price_distance * 10
        
        # Crypto (1 pip = $1)
        if symbol_upper in ['BTCUSD', 'BTCUSDT', 'ETHUSD', 'ETHUSDT']:
            return price_distance
        
        # Standard forex (4 decimal pips)
        return price_distance * 10000
    
    def update_equity(self, new_equity: float):
        """Update account equity."""
        old_equity = self.equity
        self.equity = new_equity
        logger.info(f"Equity updated: ${old_equity:.2f} -> ${new_equity:.2f}")
