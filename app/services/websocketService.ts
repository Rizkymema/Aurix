/**
 * WebSocket Service
 * =================
 * Manages WebSocket connections for real-time updates
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
// Note: Using 'any' for WebSocket message handling as data varies by subscription type

type MessageHandler = (data: any) => void;
type ConnectionHandler = () => void;

interface WebSocketConfig {
  url: string;
  autoReconnect?: boolean;
  reconnectInterval?: number;
  maxRetries?: number;
  apiKey?: string;  // ✅ Add API key support
}

export class WebSocketService {
  private ws: WebSocket | null = null;
  private url: string;
  private autoReconnect: boolean;
  private reconnectInterval: number;
  private maxRetries: number;
  private retryCount = 0;
  private isConnecting = false;
  private messageHandlers: Map<string, Set<MessageHandler>> = new Map();
  private onConnectHandlers: Set<ConnectionHandler> = new Set();
  private onDisconnectHandlers: Set<ConnectionHandler> = new Set();
  private onErrorHandlers: Set<MessageHandler> = new Set();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private apiKey?: string;  // ✅ Store API key

  constructor(config: WebSocketConfig) {
    this.url = config.url;
    this.autoReconnect = config.autoReconnect ?? true;
    this.reconnectInterval = config.reconnectInterval ?? 3000;
    this.maxRetries = config.maxRetries ?? 10;
    this.apiKey = config.apiKey;  // ✅ Store API key from config
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN || this.isConnecting) {
      return;
    }

    this.isConnecting = true;
    
    try {
      // ✅ SECURITY: Append API key as query parameter if provided
      let wsUrl = this.url;
      if (this.apiKey) {
        const separator = this.url.includes('?') ? '&' : '?';
        wsUrl = `${this.url}${separator}token=${encodeURIComponent(this.apiKey)}`;
      }
      
      this.ws = new WebSocket(wsUrl);
      
      this.ws.onopen = () => {
        console.log('[WebSocket] Connected:', this.url);
        this.isConnecting = false;
        this.retryCount = 0;
        this.onConnectHandlers.forEach(handler => handler());
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const eventType = data.type || 'message';
          
          // Call specific handlers
          const handlers = this.messageHandlers.get(eventType);
          if (handlers) {
            handlers.forEach(handler => handler(data));
          }
          
          // Call wildcard handlers
          const wildcardHandlers = this.messageHandlers.get('*');
          if (wildcardHandlers) {
            wildcardHandlers.forEach(handler => handler(data));
          }
        } catch (error) {
          console.error('[WebSocket] Parse error:', error);
        }
      };

      this.ws.onclose = () => {
        console.log('[WebSocket] Disconnected');
        this.isConnecting = false;
        this.onDisconnectHandlers.forEach(handler => handler());
        
        if (this.autoReconnect && this.retryCount < this.maxRetries) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (error) => {
        console.error('[WebSocket] Error:', error);
        this.isConnecting = false;
        this.onErrorHandlers.forEach(handler => handler(error));
      };
    } catch (error) {
      console.error('[WebSocket] Connection failed:', error);
      this.isConnecting = false;
      
      if (this.autoReconnect && this.retryCount < this.maxRetries) {
        this.scheduleReconnect();
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    
    this.retryCount++;

    if (this.retryCount > this.maxRetries) {
      console.error(`[WebSocket] Max retries (${this.maxRetries}) exhausted. Call connect() manually.`);
      return;
    }

    // Exponential backoff with jitter: 3s → 6s → 12s → 24s → cap 30s
    const base = Math.min(this.reconnectInterval * Math.pow(2, this.retryCount - 1), 30000);
    const jitter = base * 0.2 * (Math.random() * 2 - 1);
    const delay = Math.round(base + jitter);
    
    console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${this.retryCount}/${this.maxRetries})`);
    
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  disconnect(): void {
    this.autoReconnect = false;
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  send(data: any): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      console.warn('[WebSocket] Not connected, cannot send message');
    }
  }

  on(event: string, handler: MessageHandler): void {
    if (!this.messageHandlers.has(event)) {
      this.messageHandlers.set(event, new Set());
    }
    this.messageHandlers.get(event)!.add(handler);
  }

  off(event: string, handler: MessageHandler): void {
    this.messageHandlers.get(event)?.delete(handler);
  }

  onConnect(handler: ConnectionHandler): void {
    this.onConnectHandlers.add(handler);
  }

  onDisconnect(handler: ConnectionHandler): void {
    this.onDisconnectHandlers.add(handler);
  }

  onError(handler: MessageHandler): void {
    this.onErrorHandlers.add(handler);
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  get connectionState(): 'connecting' | 'connected' | 'disconnected' | 'error' {
    if (this.isConnecting) return 'connecting';
    if (this.ws?.readyState === WebSocket.OPEN) return 'connected';
    return 'disconnected';
  }
}

// =======================
// Bot WebSocket Manager
// =======================

class BotWebSocketManager {
  private ws: WebSocketService | null = null;
  private listeners: Map<string, Set<(data: any) => void>> = new Map();

  connect(): void {
    // Use Python backend WebSocket directly
    // In production, you might want to proxy through Next.js API route
    const wsUrl = process.env.NEXT_PUBLIC_BOT_WS_URL || 'ws://localhost:8000/ws';
    
    this.ws = new WebSocketService({
      url: wsUrl,
      autoReconnect: true,
      reconnectInterval: 3000,
      maxRetries: 10,
    });

    // Register message handlers
    this.ws.on('status', (data) => this.emit('status', data));
    this.ws.on('log', (data) => this.emit('log', data));
    this.ws.on('signal', (data) => this.emit('signal', data));
    this.ws.on('position', (data) => this.emit('position', data));
    this.ws.on('trade', (data) => this.emit('trade', data));
    this.ws.on('error', (data) => this.emit('error', data));
    this.ws.on('*', (data) => this.emit('message', data));

    this.ws.connect();
  }

  disconnect(): void {
    this.ws?.disconnect();
    this.ws = null;
  }

  private emit(event: string, data: any): void {
    this.listeners.get(event)?.forEach(handler => handler(data));
  }

  subscribe(event: string, handler: (data: any) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);

    // Return unsubscribe function
    return () => {
      this.listeners.get(event)?.delete(handler);
    };
  }

  get isConnected(): boolean {
    return this.ws?.isConnected ?? false;
  }

  get connectionState(): string {
    return this.ws?.connectionState ?? 'disconnected';
  }
}

// =======================
// Binance WebSocket Manager
// =======================

class BinanceWebSocketManager {
  private connections: Map<string, WebSocket> = new Map();
  private listeners: Map<string, Set<(data: any) => void>> = new Map();
  private reconnectTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private retryCounts: Map<string, number> = new Map();
  private intentionallyClosed: Set<string> = new Set();

  private static MAX_RETRIES = 30;
  private static BACKOFF_BASE_MS = 1000;
  private static BACKOFF_MAX_MS = 30000;
  private static HEARTBEAT_MS = 25000; // Binance sends pings every ~20s
  private heartbeatTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  private _backoff(attempt: number): number {
    const base = Math.min(
      BinanceWebSocketManager.BACKOFF_BASE_MS * Math.pow(2, attempt),
      BinanceWebSocketManager.BACKOFF_MAX_MS,
    );
    return Math.round(base + base * 0.2 * (Math.random() * 2 - 1));
  }

  private _resetHeartbeat(streamId: string, ws: WebSocket): void {
    const existing = this.heartbeatTimers.get(streamId);
    if (existing) clearTimeout(existing);

    this.heartbeatTimers.set(streamId, setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN) {
        console.warn(`[Binance WS] Heartbeat timeout for ${streamId}, reconnecting`);
        ws.close();
      }
    }, BinanceWebSocketManager.HEARTBEAT_MS));
  }

  private _scheduleReconnect(streamId: string, key: string): void {
    if (this.intentionallyClosed.has(streamId)) return;

    const attempt = this.retryCounts.get(streamId) || 0;
    if (attempt >= BinanceWebSocketManager.MAX_RETRIES) {
      console.error(`[Binance WS] Max retries for ${streamId}`);
      return;
    }

    const delay = this._backoff(attempt);
    this.retryCounts.set(streamId, attempt + 1);

    console.log(`[Binance WS] Reconnecting ${streamId} in ${delay}ms (attempt ${attempt + 1})`);

    const timer = setTimeout(() => {
      this.reconnectTimers.delete(streamId);
      // Re-establish connection if listeners still exist
      if (this.listeners.has(key) && (this.listeners.get(key)?.size ?? 0) > 0) {
        this._createKlineConnection(streamId, key);
      }
    }, delay);

    this.reconnectTimers.set(streamId, timer);
  }

  private _createKlineConnection(streamId: string, key: string): void {
    // Close existing if any
    const existing = this.connections.get(streamId);
    if (existing) {
      try { existing.close(); } catch { /* ignore */ }
      this.connections.delete(streamId);
    }

    const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${streamId}`);

    ws.onopen = () => {
      console.log(`[Binance WS] Connected: ${streamId}`);
      this.retryCounts.set(streamId, 0);
      this._resetHeartbeat(streamId, ws);
    };

    ws.onmessage = (event) => {
      this._resetHeartbeat(streamId, ws);
      try {
        const data = JSON.parse(event.data);
        if (data.k) {
          const kline = {
            time: Math.floor(data.k.t / 1000),
            open: parseFloat(data.k.o),
            high: parseFloat(data.k.h),
            low: parseFloat(data.k.l),
            close: parseFloat(data.k.c),
            volume: parseFloat(data.k.v),
            isClosed: data.k.x,
          };
          this.listeners.get(key)?.forEach(h => h(kline));
        }
      } catch (error) {
        console.error('[Binance WS] Parse error:', error);
      }
    };

    ws.onerror = () => {
      console.error(`[Binance WS] Error on ${streamId}`);
    };

    ws.onclose = () => {
      console.log(`[Binance WS] Closed: ${streamId}`);
      this.connections.delete(streamId);

      const hb = this.heartbeatTimers.get(streamId);
      if (hb) { clearTimeout(hb); this.heartbeatTimers.delete(streamId); }

      this._scheduleReconnect(streamId, key);
    };

    this.connections.set(streamId, ws);
  }

  subscribeKline(symbol: string, interval: string, handler: (data: any) => void): () => void {
    const streamId = `${symbol.toLowerCase()}@kline_${interval}`;
    const key = `kline:${streamId}`;
    
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key)!.add(handler);

    this.intentionallyClosed.delete(streamId);

    if (!this.connections.has(streamId)) {
      this._createKlineConnection(streamId, key);
    }

    return () => {
      this.listeners.get(key)?.delete(handler);
      
      if (this.listeners.get(key)?.size === 0) {
        this.intentionallyClosed.add(streamId);
        const ws = this.connections.get(streamId);
        if (ws) { try { ws.close(); } catch { /* ignore */ } }
        this.connections.delete(streamId);

        const timer = this.reconnectTimers.get(streamId);
        if (timer) { clearTimeout(timer); this.reconnectTimers.delete(streamId); }

        const hb = this.heartbeatTimers.get(streamId);
        if (hb) { clearTimeout(hb); this.heartbeatTimers.delete(streamId); }
      }
    };
  }

  subscribeTicker(symbol: string, handler: (data: any) => void): () => void {
    const streamId = `${symbol.toLowerCase()}@miniTicker`;
    const key = `ticker:${streamId}`;
    
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key)!.add(handler);

    this.intentionallyClosed.delete(streamId);

    if (!this.connections.has(streamId)) {
      const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${streamId}`);
      
      ws.onopen = () => {
        console.log(`[Binance WS] Ticker connected: ${streamId}`);
        this.retryCounts.set(streamId, 0);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const ticker = {
            symbol: data.s,
            price: parseFloat(data.c),
            high: parseFloat(data.h),
            low: parseFloat(data.l),
            volume: parseFloat(data.v),
            quoteVolume: parseFloat(data.q),
          };
          this.listeners.get(key)?.forEach(h => h(ticker));
        } catch (error) {
          console.error('[Binance WS] Parse error:', error);
        }
      };

      ws.onerror = () => {
        console.error(`[Binance WS] Ticker error: ${streamId}`);
      };

      ws.onclose = () => {
        console.log(`[Binance WS] Ticker closed: ${streamId}`);
        this.connections.delete(streamId);
        this._scheduleReconnect(streamId, key);
      };

      this.connections.set(streamId, ws);
    }

    return () => {
      this.listeners.get(key)?.delete(handler);
      if (this.listeners.get(key)?.size === 0) {
        this.intentionallyClosed.add(streamId);
        this.connections.get(streamId)?.close();
        this.connections.delete(streamId);

        const timer = this.reconnectTimers.get(streamId);
        if (timer) { clearTimeout(timer); this.reconnectTimers.delete(streamId); }
      }
    };
  }

  disconnectAll(): void {
    // Mark all as intentionally closed to prevent reconnects
    for (const streamId of this.connections.keys()) {
      this.intentionallyClosed.add(streamId);
    }

    this.connections.forEach(ws => { try { ws.close(); } catch { /* ignore */ } });
    this.connections.clear();
    this.listeners.clear();

    this.reconnectTimers.forEach(t => clearTimeout(t));
    this.reconnectTimers.clear();

    this.heartbeatTimers.forEach(t => clearTimeout(t));
    this.heartbeatTimers.clear();

    this.retryCounts.clear();
    this.intentionallyClosed.clear();
  }
}

// Singleton instances
export const botWebSocket = new BotWebSocketManager();
export const binanceWebSocket = new BinanceWebSocketManager();

const websocketServices = {
  WebSocketService,
  botWebSocket,
  binanceWebSocket,
};

export default websocketServices;
