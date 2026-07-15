# 🤖 AI Trading Bot

Automated trading bot dengan Strategy Engine, Risk Management, dan Live Dashboard.

## 📁 Struktur File

```
bot/
├── strategy_engine.py    # Otak analisis (EMA 200/9/21, Swing Detection)
├── risk_manager.py       # Pengaman modal (1% risk per trade)
├── trade_executor.py     # Eksekusi order (CCXT + Dry Run)
├── trading_bot.py        # Main bot controller
├── bot_api.py           # FastAPI server untuk Next.js
└── requirements.txt     # Python dependencies

app/
├── bot/
│   └── page.tsx         # Bot Dashboard page
└── components/
    └── botDashboard/
        ├── BotDashboard.tsx     # Main dashboard UI
        ├── useBotDashboard.ts   # React hook for bot control
        ├── types.ts             # TypeScript types
        └── index.ts             # Exports
```

## 🚀 Cara Menjalankan

### 1. Setup Python Backend

```bash
# Masuk ke folder bot
cd bot

# Buat virtual environment
python -m venv venv

# Aktivasi (Windows)
.\venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

### 2. Jalankan Bot API Server

```bash
# Di folder bot
python bot_api.py
```

Server akan berjalan di `http://localhost:8000`

### 3. Jalankan Next.js Frontend

```bash
# Di root folder
npm run dev
```

Buka `http://localhost:3000/bot` untuk dashboard

## 📊 Fitur

### Strategy Engine
- **Trend Filter**: EMA 200 untuk filter arah
- **Entry Trigger**: EMA 9 & EMA 21 crossover
- **Stop Loss**: Di Swing Low/High terakhir
- **Take Profit**: RRR minimal 1:1.5
- **Confidence Score**: 0-100%

### Risk Manager
- **Risiko per Trade**: Maksimal 1-2% equity
- **Auto Lot Size**: `Volume = (Equity × Risk%) / (SL Pips × Pip Value)`
- **Margin Check**: Validasi sebelum order
- **Account Types**: Standard, Mini, Micro

### Trade Executor
- **Dry Run Mode**: Simulasi tanpa uang asli
- **CCXT Integration**: Binance, Bybit, dll
- **Auto TP/SL**: Order bersamaan dengan entry
- **Error Handling**: Balance check, retry logic

### Live Dashboard
- **Bot Control**: START/STOP button
- **Active Positions**: Real-time PnL
- **Trade History**: Record semua trade
- **Log Terminal**: Live activity log
- **WebSocket**: Update tanpa refresh

## ⚙️ Konfigurasi

### Environment Variables (`.env.local`)

```env
NEXT_PUBLIC_BOT_API_URL=http://localhost:8000
NEXT_PUBLIC_BOT_WS_URL=ws://localhost:8000/ws

# Mandatory API protection (frontend -> Next.js API)
NEXT_PUBLIC_APP_API_KEY=change-me
APP_API_KEY=change-me

# Next.js -> Python bot backend
BOT_API_URL=http://localhost:8000
BOT_API_KEY=change-me
```

### Python Backend Environment (`backend/.env`)

```env
BOT_API_KEY=change-me
EXCHANGE_API_KEY=your-exchange-key
EXCHANGE_API_SECRET=your-exchange-secret
EXCHANGE_SANDBOX=true
```

### Bot Config (di Dashboard)

| Setting | Default | Deskripsi |
|---------|---------|-----------|
| Symbol | BTCUSDT | Trading pair |
| Timeframe | 1h | Candlestick interval |
| Dry Run | true | Simulasi atau real |
| Equity | 10000 | Balance akun |
| Risk % | 1 | Risiko per trade |
| Leverage | 100 | Leverage akun |

## 🔄 Alur Trading

```
┌─────────────────────────────────────────────────────────────────┐
│                        TRADING BOT FLOW                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────────┐      │
│  │  START   │───▶│ Fetch OHLCV  │───▶│ Strategy Engine  │      │
│  │   BOT    │    │   (Binance)  │    │  (EMA Analysis)  │      │
│  └──────────┘    └──────────────┘    └────────┬─────────┘      │
│                                               │                 │
│                                               ▼                 │
│                                     ┌──────────────────┐       │
│                                     │  Signal Valid?   │       │
│                                     └────────┬─────────┘       │
│                                              │                  │
│                      ┌───────────────────────┴───────┐         │
│                      │                               │         │
│                      ▼ YES                           ▼ NO      │
│            ┌──────────────────┐             ┌─────────────┐    │
│            │  Risk Manager    │             │    Wait     │    │
│            │  (Lot Size Calc) │             │  60 seconds │    │
│            └────────┬─────────┘             └──────┬──────┘    │
│                     │                              │           │
│                     ▼                              │           │
│            ┌──────────────────┐                    │           │
│            │ Trade Executor   │                    │           │
│            │ (Send Order)     │                    │           │
│            └────────┬─────────┘                    │           │
│                     │                              │           │
│                     ▼                              │           │
│            ┌──────────────────┐                    │           │
│            │ WebSocket Update │◀───────────────────┘           │
│            │ (Log + Position) │                                │
│            └──────────────────┘                                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 🛡️ Keamanan

### Dry Run Mode (WAJIB untuk testing)

```python
# Di bot_api.py, pastikan dry_run=True saat development
config = BotConfig(
    dry_run=True,  # ← PENTING!
    ...
)
```

### API Keys
- **JANGAN** commit API keys ke git
- Gunakan environment variables
- Set permissions "Enable Spot" only, disable withdrawal

## ⚠️ Disclaimer

> **PERINGATAN**: Trading cryptocurrency dan forex memiliki risiko tinggi.
> Bot ini disediakan untuk tujuan edukasi. Penulis tidak bertanggung jawab
> atas kerugian finansial yang mungkin terjadi. Selalu gunakan Dry Run Mode
> terlebih dahulu dan jangan invest lebih dari yang Anda sanggup kehilangan.

## 📝 API Endpoints

| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/` | Health check |
| GET | `/api/bot/status` | Get bot status |
| POST | `/api/bot/start` | Start trading |
| POST | `/api/bot/stop` | Stop trading |
| GET | `/api/bot/logs` | Get recent logs |
| GET | `/api/bot/positions` | Get open positions |
| GET | `/api/bot/history` | Get trade history |
| PATCH | `/api/bot/config` | Update config |
| WS | `/ws` | WebSocket untuk real-time |

## 🔧 Troubleshooting

### Bot tidak terkoneksi
- Pastikan Python server berjalan di port 8000
- Cek CORS settings
- Cek WebSocket URL

### Signal tidak muncul
- Pastikan ada cukup data (min 250 candles)
- Cek EMA settings
- Lihat log terminal untuk detail

### Order gagal
- Cek balance (harus > margin required)
- Cek API key permissions
- Lihat error message di log
