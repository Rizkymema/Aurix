# SMC Strategy Engine Documentation

## Smart Money Concept & Institutional Order Flow

Sistem strategi trading profesional berbasis pergerakan institusional dengan metodologi Smart Money Concept (SMC).

---

## 📋 Daftar Isi

1. [Overview](#overview)
2. [Arsitektur](#arsitektur)
3. [Kriteria Entry](#kriteria-entry)
4. [API Reference](#api-reference)
5. [Penggunaan](#penggunaan)
6. [Testing](#testing)
7. [Troubleshooting](#troubleshooting)

---

## Overview

### Apa itu SMC Strategy?

SMC (Smart Money Concept) adalah metodologi trading yang menganalisis pergerakan harga berdasarkan aktivitas institusional. Strategi ini fokus pada:

- **Trend Alignment** - Mengikuti arah EMA 200 di H4
- **Point of Interest (POI)** - Supply/Demand zones berkualitas tinggi
- **Confirmation** - CHOCH/MSB di M15 sebagai trigger
- **Risk Management** - RRR minimal 2:1

### Komponen Sistem

```
┌─────────────────────────────────────────────────────────────┐
│                    SMC Strategy System                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │  Frontend   │────│  Next.js    │────│  Python     │     │
│  │  (React)    │    │  API Route  │    │  SMC Engine │     │
│  └─────────────┘    └─────────────┘    └─────────────┘     │
│        │                  │                   │             │
│        ▼                  ▼                   ▼             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │  SMCPanel   │    │  Fallback   │    │  Analysis   │     │
│  │  Component  │    │  Analysis   │    │  Engine     │     │
│  └─────────────┘    └─────────────┘    └─────────────┘     │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Arsitektur

### File Structure

```
bot/
├── smc_strategy.py      # Core SMC analysis engine
├── smc_service.py       # FastAPI service wrapper
├── risk_manager.py      # Risk validation integration
└── position_manager.py  # Position management

app/
├── api/smc/analyze/
│   └── route.ts         # Next.js API endpoint
└── components/smc/
    ├── index.ts         # Module exports
    ├── types.ts         # TypeScript definitions
    ├── useSMCStrategy.ts # React hook
    └── SMCPanel.tsx     # UI component
```

### Data Flow

```
1. Chart Data (H4, M15) + Zones
        │
        ▼
2. useSMCStrategy Hook
        │
        ▼
3. POST /api/smc/analyze
        │
        ├── Python SMC Service (primary)
        │           │
        │           ▼
        │   smc_strategy.py
        │   - get_trend_direction()
        │   - find_poi_zone()
        │   - detect_choch()
        │   - calculate_setup()
        │           │
        │           ▼
        └── Local Fallback (if Python offline)
                │
                ▼
4. SMCAnalysisResult
        │
        ▼
5. SMCPanel Display
```

---

## Kriteria Entry

### 1. Trend Alignment (H4)

```
Harga di ATAS EMA 200 H4 = BULLISH trend
  → Hanya cari posisi LONG
  → POI target: Demand Zone

Harga di BAWAH EMA 200 H4 = BEARISH trend
  → Hanya cari posisi SHORT
  → POI target: Supply Zone
```

**Confidence Score: +30 points**

### 2. Point of Interest (POI)

Zone berkualitas tinggi dengan kriteria:

| Kriteria | Fresh Zone | Tested Zone | Broken Zone |
|----------|------------|-------------|-------------|
| Status | untested | tested 1-2x | tested 3+x |
| Strength | 80-100% | 50-79% | <50% |
| Priority | Highest | Medium | Skip |

**Confidence Score:**
- Fresh + High Strength: +30 points
- Tested: +15 points
- Broken/Weak: Skip

### 3. Confirmation (M15)

| Pattern | Description | Confidence |
|---------|-------------|------------|
| CHOCH | Change of Character | +25 points |
| MSB | Market Structure Break | +20 points |
| Engulfing | Candlestick pattern | +15 points |
| None | No confirmation | +0 points |

### 4. Bonus Score

| Condition | Points |
|-----------|--------|
| Fresh zone (untested) | +15 |
| Volume confluence | +10 |

### Total Confidence Score

```
Minimum untuk ENTRY: 60/100

Calculation:
  Trend Alignment:  0-30 points
  POI Zone:         0-30 points  
  Confirmation:     0-25 points
  Bonus:            0-15 points
  ─────────────────────────────
  Maximum:          100 points
```

---

## API Reference

### Python Engine: `smc_strategy.py`

```python
from smc_strategy import SMCStrategyEngine

engine = SMCStrategyEngine(
    min_zone_strength=60,
    min_rrr=2.0,
    min_confidence=60
)

result = engine.analyze(
    ohlc_h4=h4_candles,       # List of dicts: {time, open, high, low, close, volume}
    ohlc_m15=m15_candles,     # List of dicts
    supply_demand_zones=zones, # List of zone dicts
    market_structure={},       # Optional structure info
    current_volume=0,          # Current volume
    symbol='XAUUSD'
)

print(result.to_dict())
```

### REST API: `POST /api/smc/analyze`

**Request:**
```json
{
  "ohlc_h4": [
    {"time": 1704067200, "open": 2050.0, "high": 2055.0, "low": 2048.0, "close": 2053.0, "volume": 1000}
  ],
  "ohlc_m15": [...],
  "supply_demand_zones": [
    {"type": "demand", "status": "fresh", "high": 2040.0, "low": 2035.0, "strength": 85}
  ],
  "market_structure": {"trend": "bullish"},
  "current_volume": 500,
  "symbol": "XAUUSD"
}
```

**Response:**
```json
{
  "decision": "ENTRY",
  "confidence_score": 75,
  "logic": "✅ ENTRY LONG: Trend BULLISH (EMA200), harga di DEMAND Zone (strength 85%), konfirmasi CHOCH M15.",
  "setup": {
    "entry": 2038.50,
    "sl": 2033.00,
    "tp1": 2046.75,
    "tp2": 2055.00,
    "position_type": "LONG",
    "risk_pips": 5.5,
    "reward_pips_tp1": 8.25,
    "reward_pips_tp2": 16.5,
    "rrr_tp1": 1.5,
    "rrr_tp2": 3.0
  },
  "analysis": {
    "trend_h4": "bullish",
    "poi_zone": {...},
    "confirmation": "CHOCH",
    "market_structure": "HH_HL"
  },
  "warnings": [],
  "timestamp": "2024-01-01T12:00:00Z"
}
```

### React Hook: `useSMCStrategy`

```typescript
import { useSMCStrategy } from '@/components/smc';

function TradingComponent() {
  const { 
    isAnalyzing,
    lastResult,
    error,
    serviceStatus,
    analyze,
    clearResult 
  } = useSMCStrategy();

  const handleAnalyze = async () => {
    const result = await analyze({
      ohlc_h4: h4Candles,
      ohlc_m15: m15Candles,
      supply_demand_zones: zones,
      symbol: 'XAUUSD'
    });
    console.log(result);
  };

  return (
    <SMCPanel 
      result={lastResult}
      isAnalyzing={isAnalyzing}
      onRefresh={handleAnalyze}
      serviceStatus={serviceStatus}
    />
  );
}
```

---

## Penggunaan

### 1. Start Python SMC Service

```bash
cd bot
python -m venv venv
.\venv\Scripts\activate  # Windows
pip install -r requirements.txt

# Run SMC service on port 8001
uvicorn smc_service:create_app --reload --port 8001
```

### 2. Configure Environment

```env
# .env.local
NEXT_PUBLIC_BOT_API_URL=http://localhost:8001
```

### 3. Start Next.js App

```bash
npm run dev
```

### 4. Test Endpoint

```bash
# Check status
curl http://localhost:3000/api/smc/analyze

# Run analysis (with sample data)
curl -X POST http://localhost:3000/api/smc/analyze \
  -H "Content-Type: application/json" \
  -d '{"ohlc_h4": [...], "ohlc_m15": [...]}'
```

---

## Testing

### Unit Test Python Engine

```bash
cd bot
python smc_strategy.py
```

### Test SMC Service

```bash
cd bot
python smc_service.py
```

### Test dengan Real Data

```python
import ccxt
from smc_strategy import SMCStrategyEngine

# Fetch real data
exchange = ccxt.binance()
h4_ohlcv = exchange.fetch_ohlcv('BTC/USDT', '4h', limit=200)
m15_ohlcv = exchange.fetch_ohlcv('BTC/USDT', '15m', limit=50)

# Convert to format
h4_candles = [
    {'time': int(c[0]/1000), 'open': c[1], 'high': c[2], 
     'low': c[3], 'close': c[4], 'volume': c[5]}
    for c in h4_ohlcv
]

m15_candles = [...]

# Analyze
engine = SMCStrategyEngine()
result = engine.analyze(
    ohlc_h4=h4_candles,
    ohlc_m15=m15_candles,
    supply_demand_zones=[],
    symbol='BTCUSDT'
)

print(result.to_json())
```

---

## Troubleshooting

### SMC Service Not Responding

```bash
# Check if service is running
curl http://localhost:8001/

# Restart service
cd bot
uvicorn smc_service:create_app --reload --port 8001
```

### Fallback Mode Active

Jika Python service tidak tersedia, sistem akan otomatis menggunakan local analysis di TypeScript. Periksa:

1. Python service running di port 8001
2. `NEXT_PUBLIC_BOT_API_URL` di `.env.local`
3. No firewall blocking

### "Insufficient H4 data" Error

Pastikan mengirim minimal 200 candle H4 untuk EMA 200 calculation.

### Low Confidence Score

Kemungkinan penyebab:
- Tidak ada valid POI zone di dekat harga
- Trend tidak jelas (price di sekitar EMA 200)
- Belum ada confirmation pattern di M15

---

## Changelog

### v1.0.0 (2024-01)
- Initial release
- SMC Strategy Engine dengan EMA 200, POI zones, CHOCH/MSB
- FastAPI service wrapper
- Next.js API integration
- React hook dan UI component

---

## License

MIT License - Free for commercial and personal use.
