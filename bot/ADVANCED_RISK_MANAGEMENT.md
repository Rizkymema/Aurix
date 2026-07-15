# Trading Bot Optimization - Advanced Risk & Position Management

## 🎯 Fitur Baru yang Diimplementasikan

### 1. **Strict Risk-Per-Trade (1% Maximum)**
File: `risk_manager.py`

#### Fungsi Utama: `calculate_position_size()`
```python
position = risk_mgr.calculate_position_size(
    symbol='XAUUSD',
    entry_price=2050.00,
    stop_loss=2040.00,
    take_profit=2080.00,  # RRR 1:3
    risk_percent=1.0  # STRICT: Max 1%
)
```

**Cara Kerja:**
- Risk per trade **WAJIB maksimal 1%** dari equity
- Lot size dihitung otomatis: `Lot = (Equity × 1%) / (SL_Pips × Pip_Value)`
- Validasi margin requirement sebelum trade
- Warning jika lot size terlalu kecil

**Output:**
```python
{
    'lot_size': 0.1,  # Otomatis calculated
    'risk_amount': 100.0,  # $100 (1% dari $10,000)
    'risk_percent': 1.0,
    'potential_loss': 100.0,
    'potential_profit': 300.0,  # RRR 1:3
    'is_valid': True
}
```

---

### 2. **Smart Entry Validation**
File: `risk_manager.py`

#### Fungsi: `validate_trade()` (async)
```python
validation = await risk_mgr.validate_trade(
    symbol='XAUUSD',
    entry_price=2050.00,
    stop_loss=2040.00,
    take_profit=2080.00,
    lot_size=0.1,
    current_bid=2049.95,
    current_ask=2050.05
)
```

**Validasi yang Dilakukan:**

#### ✅ 1. Risk/Reward Ratio (RRR) Check
- **Minimum RRR: 2.0** (wajib 1:2 atau lebih baik)
- Trade DITOLAK jika RRR < 2.0
- Warning jika RRR < 2.5

```python
if rrr < 2.0:
    errors.append("❌ RRR terlalu rendah: 1.5 < 2.0 (MINIMUM)")
```

#### ✅ 2. Spread Check
- **Maximum Spread: 10%** dari jarak SL
- Mencegah trade dengan spread terlalu besar
- Contoh: SL 10 pips, spread max 1 pip

```python
spread_pips = (current_ask - current_bid) / pip_size
spread_percent = (spread_pips / sl_pips) * 100

if spread_percent > 10.0:
    errors.append("❌ Spread terlalu besar: 15% dari SL")
```

#### ✅ 3. High Impact News Filter
File: `news_filter.py`

```python
news_filter = NewsFilter(buffer_minutes=30)
news_check = await news_filter.should_block_trade('EURUSD')

if news_check['should_block']:
    errors.append("❌ High Impact News detected: NFP in 25 minutes")
```

**High Impact News yang di-filter:**
- NFP (Non-Farm Payrolls)
- CPI (Consumer Price Index)
- FOMC (Federal Reserve Statement)
- Interest Rate Decisions
- GDP Reports
- Unemployment Rate
- Central Bank Announcements (ECB, BOE, BOJ)

**Buffer Time:** 30 menit sebelum berita (dapat dikustomisasi)

---

### 3. **Auto Breakeven Management**
File: `position_manager.py`

#### Fungsi: Otomatis geser SL ke Entry saat profit 1:1

```python
pos_mgr = PositionManager(
    executor=executor,
    risk_manager=risk_mgr,
    breakeven_rrr=1.0  # Trigger saat RRR 1:1
)

# Add position untuk di-manage
position = pos_mgr.add_position(
    position_id="POS_001",
    symbol="XAUUSD",
    side="BUY",
    entry_price=2050.00,
    quantity=0.1,
    stop_loss=2040.00,
    take_profit=2080.00
)

# Monitor position (background task)
await pos_mgr.monitor_position(position, current_price=2060)
```

**Cara Kerja:**
1. Entry: 2050, SL: 2040 (10 pips risk)
2. Price naik ke 2060 (10 pips profit) → **RRR 1:1 tercapai**
3. **Auto Breakeven:** SL digeser dari 2040 → 2050 (Entry)
4. Trade sekarang **risk-free**

```
🎯 BREAKEVEN triggered for POS_001!
   SL moved: 2040 → 2050
   Current RRR: 1.0
```

---

### 4. **Partial Close Strategy**
File: `position_manager.py`

#### Exit Strategy: 50% di TP1, 50% di TP2

```python
pos_mgr = PositionManager(
    partial_close_rrr=1.5,  # TP1 at RRR 1:1.5
    partial_close_percent=50.0,  # Close 50% di TP1
    trailing_distance_pips=20.0  # Trailing stop 20 pips
)
```

**Cara Kerja:**

| Event | Price | Action | Result |
|-------|-------|--------|--------|
| Entry | 2050 | Open 0.1 lot BUY | Position opened |
| RRR 1:1 | 2060 | Auto Breakeven | SL → 2050 |
| **RRR 1:1.5** | **2065** | **Partial Close 50%** | **Close 0.05 lot** |
| Trailing | 2070 | Trailing Stop active | SL → 2050 |
| RRR 1:3 | 2080 | TP2 hit | Close remaining 0.05 lot |

**Benefit:**
- **Lock profit** di TP1 (RRR 1:1.5)
- **Sisanya run** ke TP2 (RRR 1:3) dengan trailing stop
- **Risk-free** setelah breakeven

```python
💰 PARTIAL CLOSE triggered for POS_001!
   Closing 50% (0.05 lots) @ 2065
   ✅ Partial close done. P&L: $75
   Remaining: 0.05 lots running to TP2
```

---

### 5. **Trailing Stop**
File: `position_manager.py`

#### Otomatis trailing stop setelah partial close

```python
pos_mgr = PositionManager(
    trailing_distance_pips=20.0  # Jarak trailing 20 pips
)
```

**Cara Kerja:**
1. Setelah partial close di TP1 (2065)
2. Trailing stop **20 pips** di belakang highest price
3. Price naik ke 2070 → Trailing SL = 2050 (20 pips behind)
4. Price naik ke 2075 → Trailing SL = 2055
5. Price reverse → Close di trailing SL

```
📈 TRAILING STOP updated for POS_001
   SL moved: 2050 → 2055
   Highest price: 2075
```

---

## 📋 Integrasi Lengkap

### Complete Trading Flow:

```python
import asyncio
from risk_manager import RiskManager
from news_filter import NewsFilter
from trade_executor import TradeExecutor
from position_manager import PositionManager

async def complete_trading_flow():
    # 1. Initialize components
    news_filter = NewsFilter(buffer_minutes=30)
    
    risk_mgr = RiskManager(
        equity=10000.0,
        leverage=100,
        max_risk_percent=1.0,  # STRICT 1%
        min_rrr=2.0,  # Minimum RRR 2:1
        news_filter=news_filter
    )
    
    executor = TradeExecutor(dry_run=False)  # Live mode
    await executor.initialize()
    
    pos_mgr = PositionManager(
        executor=executor,
        risk_manager=risk_mgr,
        breakeven_rrr=1.0,
        partial_close_rrr=1.5,
        trailing_distance_pips=20.0
    )
    
    # 2. Calculate position size
    signal = {
        'symbol': 'XAUUSD',
        'action': 'BUY',
        'entry_price': 2050.00,
        'stop_loss': 2040.00,
        'take_profit': 2080.00  # RRR 1:3
    }
    
    position_size = risk_mgr.calculate_position_size(
        symbol=signal['symbol'],
        entry_price=signal['entry_price'],
        stop_loss=signal['stop_loss'],
        take_profit=signal['take_profit'],
        risk_percent=1.0
    )
    
    print(f"📊 Position Size: {position_size.lot_size} lots")
    print(f"   Risk: ${position_size.risk_amount} ({position_size.risk_percent}%)")
    
    # 3. Smart Entry Validation
    validation = await risk_mgr.validate_trade(
        symbol=signal['symbol'],
        entry_price=signal['entry_price'],
        stop_loss=signal['stop_loss'],
        take_profit=signal['take_profit'],
        lot_size=position_size.lot_size,
        current_bid=2049.95,
        current_ask=2050.05
    )
    
    if not validation['is_valid']:
        print("❌ Trade REJECTED:")
        for error in validation['errors']:
            print(f"   {error}")
        return
    
    print("✅ Trade validation PASSED")
    print(f"   RRR: {validation['rrr']:.2f}")
    
    # 4. Execute trade
    result = await executor.execute_trade(
        symbol=signal['symbol'],
        side=signal['action'],
        quantity=position_size.lot_size,
        entry_price=signal['entry_price'],
        stop_loss=signal['stop_loss'],
        take_profit=signal['take_profit']
    )
    
    if result.status.value == 'filled':
        print(f"✅ Order executed: {result.order_id}")
        
        # 5. Add to position manager
        managed_pos = pos_mgr.add_position(
            position_id=result.order_id,
            symbol=signal['symbol'],
            side=signal['action'],
            entry_price=result.filled_price,
            quantity=position_size.lot_size,
            stop_loss=signal['stop_loss'],
            take_profit=signal['take_profit']
        )
        
        # 6. Start monitoring (background task)
        # asyncio.create_task(pos_mgr.monitor_all_positions())
        
        print("🔄 Position management active")
        print(f"   Breakeven @ RRR 1:1")
        print(f"   Partial close 50% @ RRR 1:1.5")
        print(f"   Trailing stop: 20 pips")
    
    await executor.shutdown()

# Run
asyncio.run(complete_trading_flow())
```

---

## 🧪 Testing

### Test Risk Manager:
```bash
cd bot
python risk_manager.py
```

### Test News Filter:
```bash
python news_filter.py
```

### Test Position Manager:
```bash
python position_manager.py
```

### Test Complete Flow:
```bash
python trading_bot.py
```

---

## 📊 Expected Results

### Entry Phase:
```
📊 Position Size: 0.1 lots
   Risk: $100 (1%)
   RRR: 3.0
✅ Trade validation PASSED
   No high impact news
   Spread OK: 0.5 pips (5% of SL)
✅ Order executed: POS_001
```

### During Trade:
```
🎯 BREAKEVEN triggered at 2060!
   SL moved: 2040 → 2050
   Position now risk-free

💰 PARTIAL CLOSE at 2065 (RRR 1:1.5)
   Closed 0.05 lots. P&L: $75
   Remaining: 0.05 lots to TP2

📈 TRAILING STOP active
   Distance: 20 pips
```

### Final Result:
```
✅ Position closed completely
   Partial close P&L: $75
   Final close P&L: $75
   Total P&L: $150
   Total Risk: $100
   Realized RRR: 1:1.5 (average)
```

---

## ⚙️ Configuration

### Customize settings dalam `trading_bot.py`:

```python
# Risk Settings
MAX_RISK_PERCENT = 1.0  # Strict 1%
MIN_RRR = 2.0  # Minimum 1:2

# Position Management
BREAKEVEN_RRR = 1.0  # Auto breakeven at 1:1
PARTIAL_CLOSE_RRR = 1.5  # Close 50% at 1:1.5
FINAL_TP_RRR = 3.0  # Final target 1:3
TRAILING_PIPS = 20.0  # Trailing stop distance

# News Filter
NEWS_BUFFER_MINUTES = 30  # Avoid news 30 min before
```

---

## 🚀 Next Steps

1. ✅ Test dengan dry-run mode
2. ✅ Integrasi ke `trading_bot.py` main loop
3. ✅ Connect ke real broker API (CCXT/MetaAPI)
4. ✅ Deploy dengan proper logging
5. ✅ Monitor performance metrics

---

## 📞 Support

Untuk pertanyaan atau bug report, check:
- `bot/README.md`
- `FEATURES.md`
- GitHub Issues

Happy Trading! 🎯📈
