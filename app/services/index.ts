/**
 * Services Index
 * ==============
 * Barrel exports for all services
 */

export { default as TradingApi, BotApi, AnalysisApi, MarketApi } from './tradingApi';
export type {
  ApiResponse,
  BotConfig,
  BotStatus,
  Position,
  TradeRecord,
  BotLog,
} from './tradingApi';

export { WebSocketService, botWebSocket, binanceWebSocket } from './websocketService';

// AI Trading System Core
export { 
  aiTradingService,
  parseSignalForDisplay,
  getGradeColor,
  getDirectionColor,
  formatSignalLog
} from './aiTradingService';
export type {
  AISignalRequest,
  AITradingSignal,
  AISignalResponse,
  AISystemStatus,
  QuickCheckResult
} from './aiTradingService';
