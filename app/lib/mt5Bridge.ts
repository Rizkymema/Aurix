import { execFile } from 'node:child_process';
import path from 'node:path';

export interface Mt5AccountInfo {
  account: {
    login: number;
    server: string;
    broker: string;
    name: string;
    balance: number;
    equity: number;
    currency: string;
    leverage: number;
  };
  terminal: {
    name?: string | null;
    company?: string | null;
    connected?: boolean | null;
    trade_allowed?: boolean | null;
    path?: string | null;
  };
}

export interface Mt5Tick {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  last: number;
  spread: number;
  digits: number;
  time: number;
  time_iso: string;
  source: string;
}

export interface Mt5Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  tick_volume: number;
}

export interface Mt5CandleBatch {
  symbol: string;
  interval: string;
  count: number;
  candles: Mt5Candle[];
  source: string;
}

type BridgeResponse<T> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

const bridgeScript = path.join(process.cwd(), 'backend', 'mt5_bridge.py');
const pythonExecutable = process.env.MT5_BRIDGE_PYTHON || 'python';
const bridgeUrl = process.env.MT5_BRIDGE_URL?.replace(/\/$/, '');
const bridgeToken = process.env.MT5_BRIDGE_TOKEN;

function getRemoteBridgeUrl(): string | null {
  if (!bridgeUrl || !bridgeToken) return null;

  try {
    const url = new URL(bridgeUrl);
    const isLocalHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);

    // Vercel must never send an MT5 bridge token over an unencrypted connection.
    if (process.env.VERCEL === '1' && url.protocol !== 'https:') return null;
    if (url.protocol !== 'https:' && !isLocalHttp) return null;

    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function execFileAsync(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 15000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.trim() || error.message));
        return;
      }
      resolve(stdout);
    });
  });
}

async function callMt5Bridge<T>(args: string[]): Promise<T | null> {
  const remoteUrl = getRemoteBridgeUrl();

  if (remoteUrl) {
    try {
      const remoteArgs = args[0] === 'account-info' ? ['account'] : args;
      const response = await fetch(`${remoteUrl}/${remoteArgs.map(encodeURIComponent).join('/')}`, {
        headers: { Authorization: `Bearer ${bridgeToken}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) return null;
      const parsed = await response.json() as BridgeResponse<T>;
      return parsed.ok ? parsed as T : null;
    } catch {
      return null;
    }
  }

  // Serverless hosts cannot access the Windows MT5 terminal or execute MetaTrader5.
  if (process.env.VERCEL === '1') return null;

  try {
    const stdout = await execFileAsync(pythonExecutable, [bridgeScript, ...args]);
    const parsed = JSON.parse(stdout.trim()) as BridgeResponse<T>;
    if (!parsed.ok) return null;

    return parsed as T;
  } catch {
    return null;
  }
}

export async function getMt5AccountInfo(): Promise<Mt5AccountInfo | null> {
  return callMt5Bridge<Mt5AccountInfo>(['account-info']);
}

export async function getMt5Tick(symbol: string): Promise<Mt5Tick | null> {
  return callMt5Bridge<Mt5Tick>(['tick', symbol.toUpperCase()]);
}

export async function getMt5Candles(symbol: string, interval: string, limit: number): Promise<Mt5CandleBatch | null> {
  return callMt5Bridge<Mt5CandleBatch>(['candles', symbol.toUpperCase(), interval, String(limit)]);
}

export function isMt5BridgeConfigured(): boolean {
  return getRemoteBridgeUrl() !== null;
}
