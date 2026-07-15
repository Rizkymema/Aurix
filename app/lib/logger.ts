/**
 * Frontend Logger Utility
 * =======================
 * Centralized logging with environment-aware output.
 * Replaces scattered console.log statements.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogConfig {
  enabled: boolean;
  level: LogLevel;
  prefix: string;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Check if we're in development mode
const isDev = process.env.NODE_ENV === 'development';

// Default config - only log in development
const defaultConfig: LogConfig = {
  enabled: isDev,
  level: isDev ? 'debug' : 'warn',
  prefix: '',
};

class Logger {
  private config: LogConfig;
  private name: string;

  constructor(name: string, config: Partial<LogConfig> = {}) {
    this.name = name;
    this.config = { ...defaultConfig, ...config };
  }

  private shouldLog(level: LogLevel): boolean {
    if (!this.config.enabled) return false;
    return LOG_LEVELS[level] >= LOG_LEVELS[this.config.level];
  }

  private formatMessage(level: LogLevel, message: string): string {
    const timestamp = new Date().toISOString().slice(11, 23);
    const prefix = this.config.prefix || this.name;
    return `[${timestamp}] [${prefix}] ${message}`;
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog('debug')) {
      console.debug(this.formatMessage('debug', message), ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      console.info(this.formatMessage('info', message), ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message), ...args);
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message), ...args);
    }
  }

  // Convenience methods for trading-specific logs
  signal(type: 'BUY' | 'SELL', symbol: string, price: number, confidence: number): void {
    this.info(`📊 SIGNAL: ${type} ${symbol} @ ${price.toFixed(5)} | Confidence: ${confidence}%`);
  }

  trade(action: string, symbol: string, details: Record<string, unknown>): void {
    const detailStr = Object.entries(details)
      .map(([k, v]) => `${k}=${v}`)
      .join(' | ');
    this.info(`💹 TRADE: ${action} ${symbol} | ${detailStr}`);
  }

  analysis(step: string, result: string): void {
    this.debug(`🔍 ${step}: ${result}`);
  }
}

// Pre-configured logger instances
export const signalLogger = new Logger('Signal', { prefix: 'Layer 1' });
export const sentimentLogger = new Logger('Sentiment', { prefix: 'Layer 2' });
export const aiLogger = new Logger('AI', { prefix: 'Layer 3' });
export const wsLogger = new Logger('WebSocket', { prefix: 'WS' });
export const chartLogger = new Logger('Chart', { prefix: 'Chart' });
export const botLogger = new Logger('Bot', { prefix: 'Bot' });

// Factory function for custom loggers
export function createLogger(name: string, config?: Partial<LogConfig>): Logger {
  return new Logger(name, config);
}

// Default export
export default Logger;
