# MT5 Price Bridge

The Vercel application cannot open the MetaTrader 5 terminal installed on this Windows computer. The bridge keeps MT5 on the local computer and lets the deployed Next.js server request price ticks and candles over an authenticated HTTPS connection.

## Local Setup

1. Open MetaTrader 5 and sign in to the account whose quotes you want to use.
2. Install the bridge dependencies once:

```powershell
pip install -r backend\requirements-mt5-bridge.txt
```

3. In PowerShell, set a long random bridge token for the current session:

```powershell
$env:MT5_BRIDGE_TOKEN = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
```

4. Start the bridge. It intentionally listens only on `127.0.0.1`.

```powershell
python backend\mt5_bridge_server.py
```

5. Publish `http://127.0.0.1:8765` through an HTTPS tunnel. A named Cloudflare Tunnel is recommended for a stable URL. Do not expose port `8765` directly to the internet.
6. Add the following variables in Vercel Production, Preview, and Development. `MT5_BRIDGE_TOKEN` must match the token used in PowerShell.

```text
MT5_BRIDGE_URL=https://your-stable-tunnel-domain.example.com
MT5_BRIDGE_TOKEN=the-same-long-random-token
```

## Verification

Use the deployed endpoint below after setting the Vercel variables:

```text
/api/forex/debug?symbol=XAUUSD&interval=1m
```

Expected result:

```json
{
  "mt5": { "bridgeConfigured": true, "connected": true },
  "spot": { "source": "MT5-bridge:...", "isRealtime": true },
  "executionGuard": { "allowed": true, "feedStatus": "realtime" }
}
```

The bridge reads prices only. It does not submit MT5 orders. Keep the MT5 terminal and the bridge computer online while the deployed dashboard is expected to receive MT5 quotes.
