import { NextRequest, NextResponse } from 'next/server';
import { adjustSignalConfidence, isMarketConditionFavorable, getMarketAnalysis } from '@/app/lib/kolAPI';
import { checkRateLimit } from '@/app/lib/rateLimit';
import { getClientIp } from '@/app/lib/apiSecurity';
import { runProbabilityEngine } from '@/app/lib/probabilityEngine';

/**
 * AI Trading Decision Engine - Signal Generator API
 * 
 * Menghasilkan keputusan trading numerik untuk bot execution
 * FORMAT OUTPUT FINAL tidak boleh diubah
 */

// Types
interface CandlestickData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

interface TradingSignal {
  market: string;
  timeframe: string;
  signal: 'BUY' | 'SELL' | 'WAIT';
  entry: number | null;
  stop_loss: number | null;
  take_profit_1: number | null;
  take_profit_2: number | null;
  bot_mode: 'LIVE' | 'DRY_RUN';
  risk_reward: number | null;
  confidence: number;
  timestamp: string;
  reason: string;
}

// Calculate ATR (Average True Range) for volatility
function calculateATR(candles: CandlestickData[], period: number = 14): number {
  if (candles.length < period + 1) return 0;
  
  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trueRanges.push(tr);
  }
  
  // Calculate average of last 'period' true ranges
  const recentTRs = trueRanges.slice(-period);
  return recentTRs.reduce((sum, tr) => sum + tr, 0) / recentTRs.length;
}

// Calculate EMA
function calculateEMA(prices: number[], period: number): number[] {
  if (prices.length < period) return [];
  
  const multiplier = 2 / (period + 1);
  const ema: number[] = [];
  
  // SMA for initial value
  const sma = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  ema.push(sma);
  
  // Calculate EMA
  for (let i = period; i < prices.length; i++) {
    const value = (prices[i] * multiplier) + (ema[ema.length - 1] * (1 - multiplier));
    ema.push(value);
  }
  
  return ema;
}

// Find swing high
function findSwingHigh(candles: CandlestickData[], lookback: number = 10): number {
  if (candles.length < lookback * 2) {
    return Math.max(...candles.slice(-lookback).map(c => c.high));
  }
  
  const highs = candles.map(c => c.high);
  for (let i = highs.length - lookback - 1; i >= lookback; i--) {
    const isSwingHigh = highs[i] === Math.max(...highs.slice(i - lookback, i + lookback + 1));
    if (isSwingHigh) return highs[i];
  }
  
  return Math.max(...highs.slice(-lookback));
}

// Find swing low
function findSwingLow(candles: CandlestickData[], lookback: number = 10): number {
  if (candles.length < lookback * 2) {
    return Math.min(...candles.slice(-lookback).map(c => c.low));
  }
  
  const lows = candles.map(c => c.low);
  for (let i = lows.length - lookback - 1; i >= lookback; i--) {
    const isSwingLow = lows[i] === Math.min(...lows.slice(i - lookback, i + lookback + 1));
    if (isSwingLow) return lows[i];
  }
  
  return Math.min(...lows.slice(-lookback));
}

// Detect trend using EMA - RELAXED for faster signal generation
function detectTrend(candles: CandlestickData[]): {
  direction: 'BULLISH' | 'BEARISH' | 'SIDEWAYS';
  strength: number;
  ema9: number;
  ema21: number;
  ema200: number;
} {
  const closes = candles.map(c => c.close);
  
  const ema9 = calculateEMA(closes, 9);
  const ema21 = calculateEMA(closes, 21);
  // Use EMA50 if not enough data for EMA200
  const ema200 = candles.length >= 200 ? calculateEMA(closes, 200) : calculateEMA(closes, 50);
  
  if (ema9.length === 0 || ema21.length === 0) {
    return { direction: 'SIDEWAYS', strength: 0, ema9: 0, ema21: 0, ema200: 0 };
  }
  
  const currentEma9 = ema9[ema9.length - 1];
  const currentEma21 = ema21[ema21.length - 1];
  const currentEma200 = ema200.length > 0 ? ema200[ema200.length - 1] : currentEma21;
  const currentPrice = closes[closes.length - 1];
  
  // Trend determination - RELAXED: only need EMA9 vs EMA21 alignment
  let direction: 'BULLISH' | 'BEARISH' | 'SIDEWAYS' = 'SIDEWAYS';
  let strength = 0;
  
  // Primary: EMA9 > EMA21 = BULLISH
  if (currentEma9 > currentEma21) {
    direction = 'BULLISH';
    // Bonus strength if also above EMA200
    if (currentPrice > currentEma200) {
      strength = Math.min(100, 50 + ((currentPrice - currentEma200) / currentEma200) * 500);
    } else {
      strength = 40; // Still bullish but weaker
    }
  } 
  // EMA9 < EMA21 = BEARISH
  else if (currentEma9 < currentEma21) {
    direction = 'BEARISH';
    // Bonus strength if also below EMA200
    if (currentPrice < currentEma200) {
      strength = Math.min(100, 50 + ((currentEma200 - currentPrice) / currentEma200) * 500);
    } else {
      strength = 40; // Still bearish but weaker
    }
  } else {
    // Check for EMA crossover
    const prevEma9 = ema9.length > 1 ? ema9[ema9.length - 2] : currentEma9;
    const prevEma21 = ema21.length > 1 ? ema21[ema21.length - 2] : currentEma21;
    
    // Golden cross (EMA9 crosses above EMA21)
    if (prevEma9 <= prevEma21 && currentEma9 > currentEma21) {
      direction = 'BULLISH';
      strength = 60;
    }
    // Death cross (EMA9 crosses below EMA21)
    else if (prevEma9 >= prevEma21 && currentEma9 < currentEma21) {
      direction = 'BEARISH';
      strength = 60;
    }
  }
  
  return { direction, strength, ema9: currentEma9, ema21: currentEma21, ema200: currentEma200 };
}

// Check volume validity
function isVolumeValid(candles: CandlestickData[]): boolean {
  if (candles.length < 20) return false;
  
  const volumes = candles.slice(-20).map(c => c.volume || 0);
  const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
  const currentVolume = candles[candles.length - 1].volume || 0;
  
  // Volume should be at least 30% of average
  return currentVolume >= avgVolume * 0.3;
}

// Main signal generation
function generateSignal(
  candles: CandlestickData[],
  symbol: string,
  timeframe: string,
  botMode: 'LIVE' | 'DRY_RUN',
  aiEnabled: boolean
): TradingSignal {
  const timestamp = new Date().toISOString();
  
  // Base WAIT signal
  const waitSignal: TradingSignal = {
    market: symbol,
    timeframe,
    signal: 'WAIT',
    entry: null,
    stop_loss: null,
    take_profit_1: null,
    take_profit_2: null,
    bot_mode: botMode,
    risk_reward: null,
    confidence: 0,
    timestamp,
    reason: 'No valid setup'
  };
  
  // AI Toggle check
  if (!aiEnabled) {
    return { ...waitSignal, reason: 'AI Analysis is OFF' };
  }
  
  // Data validation - lowered for faster bot response
  if (!candles || candles.length < 50) {
    return { ...waitSignal, reason: 'Insufficient data (need 50+ candles)' };
  }
  
  // Volume check - skip for forex/gold which may not have volume
  const isForex = ['XAUUSD', 'XAGUSD', 'EURUSD', 'GBPUSD'].includes(symbol.toUpperCase());
  if (!isForex && !isVolumeValid(candles)) {
    return { ...waitSignal, reason: 'Volume too low' };
  }
  
  // Calculate indicators
  const atr = calculateATR(candles, 14);
  const trend = detectTrend(candles);
  const currentPrice = candles[candles.length - 1].close;
  const swingHigh = findSwingHigh(candles, 10);
  const swingLow = findSwingLow(candles, 10);
  
  // ATR validation
  if (atr === 0 || atr / currentPrice > 0.1) {
    return { ...waitSignal, reason: 'Volatility invalid' };
  }
  
  // SIDEWAYS = WAIT
  if (trend.direction === 'SIDEWAYS') {
    return { ...waitSignal, reason: 'Market sideways/choppy' };
  }
  
  let signal: 'BUY' | 'SELL' | 'WAIT' = 'WAIT';
  let entry = currentPrice;
  let stopLoss = 0;
  let takeProfit1 = 0;
  let takeProfit2 = 0;
  let riskReward = 0;
  const confidence = trend.strength;
  let reason = '';
  
  // BULLISH TREND = BUY
  if (trend.direction === 'BULLISH') {
    signal = 'BUY';
    
    // Entry near current price (within 0.1% for limit order logic)
    entry = currentPrice;
    
    // Stop Loss below swing low with ATR buffer
    stopLoss = Math.min(swingLow, currentPrice - atr * 1.5);
    stopLoss = Number((stopLoss - atr * 0.2).toFixed(getDecimals(currentPrice)));
    
    // Calculate risk
    const risk = entry - stopLoss;
    
    // TP1 = 2x risk, TP2 = 3x risk
    takeProfit1 = Number((entry + risk * 2).toFixed(getDecimals(currentPrice)));
    takeProfit2 = Number((entry + risk * 3).toFixed(getDecimals(currentPrice)));
    
    riskReward = 2;
    reason = `Bullish trend, EMA9>${Math.round(trend.ema9)} > EMA21>${Math.round(trend.ema21)} > EMA200>${Math.round(trend.ema200)}`;
  }
  
  // BEARISH TREND = SELL
  else if (trend.direction === 'BEARISH') {
    signal = 'SELL';
    
    // Entry near current price
    entry = currentPrice;
    
    // Stop Loss above swing high with ATR buffer
    stopLoss = Math.max(swingHigh, currentPrice + atr * 1.5);
    stopLoss = Number((stopLoss + atr * 0.2).toFixed(getDecimals(currentPrice)));
    
    // Calculate risk
    const risk = stopLoss - entry;
    
    // TP1 = 2x risk, TP2 = 3x risk
    takeProfit1 = Number((entry - risk * 2).toFixed(getDecimals(currentPrice)));
    takeProfit2 = Number((entry - risk * 3).toFixed(getDecimals(currentPrice)));
    
    riskReward = 2;
    reason = `Bearish trend, EMA9<${Math.round(trend.ema9)} < EMA21<${Math.round(trend.ema21)} < EMA200<${Math.round(trend.ema200)}`;
  }
  
  // Validate Risk:Reward >= 1:2
  if (riskReward < 2) {
    return { ...waitSignal, reason: 'RRR < 1:2' };
  }
  
  // Final confidence check - lowered for more responsive bot
  if (confidence < 30) {
    return { ...waitSignal, reason: 'Low confidence (<30%)' };
  }
  
  return {
    market: symbol,
    timeframe,
    signal,
    entry: Number(entry.toFixed(getDecimals(currentPrice))),
    stop_loss: stopLoss,
    take_profit_1: takeProfit1,
    take_profit_2: takeProfit2,
    bot_mode: botMode,
    risk_reward: riskReward,
    confidence: Math.round(confidence),
    timestamp,
    reason
  };
}

// Helper: get decimal places based on price
function getDecimals(price: number): number {
  if (price >= 10000) return 2;      // BTC
  if (price >= 100) return 2;        // ETH, XAU
  if (price >= 1) return 5;          // EUR/USD
  return 8;                          // Small altcoins
}

function generateProbabilitySignal(
  candles: CandlestickData[],
  symbol: string,
  timeframe: string,
  botMode: 'LIVE' | 'DRY_RUN'
): TradingSignal | null {
  if (!candles || candles.length < 200) return null;

  const result = runProbabilityEngine({
    symbol,
    timeframe,
    candles,
    accountBalance: 10000,
    riskPercent: 1,
  });

  if (result.signal === 'WAIT') {
    return {
      market: symbol,
      timeframe,
      signal: 'WAIT',
      entry: null,
      stop_loss: null,
      take_profit_1: null,
      take_profit_2: null,
      bot_mode: botMode,
      risk_reward: null,
      confidence: result.confidenceScore,
      timestamp: new Date().toISOString(),
      reason: result.technicalJustification || 'Probability engine selected WAIT',
    };
  }

  if (
    result.entryPrice === null ||
    result.stopLoss === null ||
    result.takeProfit1 === null ||
    result.takeProfit2 === null
  ) {
    return null;
  }

  const decimals = getDecimals(candles[candles.length - 1].close);

  return {
    market: symbol,
    timeframe,
    signal: result.signal,
    entry: Number(result.entryPrice.toFixed(decimals)),
    stop_loss: Number(result.stopLoss.toFixed(decimals)),
    take_profit_1: Number(result.takeProfit1.toFixed(decimals)),
    take_profit_2: Number(result.takeProfit2.toFixed(decimals)),
    bot_mode: botMode,
    risk_reward: Number(result.riskRewardRatio.toFixed(2)),
    confidence: result.confidenceScore,
    timestamp: new Date(result.timestamp).toISOString(),
    reason: result.technicalJustification,
  };
}

// POST handler - generate signal from provided candles
export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const limit = process.env.NODE_ENV === 'development' ? 60 : 10;
    const rate = checkRateLimit(`bot:signal:${ip}`, limit, 60000);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', retryAfter: rate.retryAfterMs || 60000 },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((rate.retryAfterMs || 60000) / 1000)) } }
      );
    }

    const body = await request.json();
    const {
      candles,
      symbol = 'BTCUSDT',
      timeframe = '1h',
      botMode = 'DRY_RUN',
      aiEnabled = true
    } = body;
    
    const normalizedSymbol = symbol.toUpperCase();
    const normalizedBotMode = botMode.toUpperCase() === 'LIVE' ? 'LIVE' : 'DRY_RUN';
    const probabilitySignal = aiEnabled
      ? generateProbabilitySignal(candles, normalizedSymbol, timeframe, normalizedBotMode)
      : null;

    if (probabilitySignal) {
      return NextResponse.json(probabilitySignal);
    }

    // Generate fallback signal when 200 candles are not available.
    const signal = generateSignal(
      candles,
      normalizedSymbol,
      timeframe,
      normalizedBotMode,
      aiEnabled
    );
    
    // Enhance signal with Kol market data if not WAIT
    if (aiEnabled && signal.signal !== 'WAIT') {
      try {
        const marketAnalysis = await getMarketAnalysis(symbol);
        
        const hasLiveMarketContext =
          marketAnalysis.sentiment?.source === 'api' ||
          marketAnalysis.trend?.source === 'api';

        // Adjust confidence only with live market context, never mock fallback data.
        if (hasLiveMarketContext && (marketAnalysis.sentiment || marketAnalysis.trend)) {
          signal.confidence = adjustSignalConfidence(
            signal.confidence,
            signal.signal as 'BUY' | 'SELL',
            marketAnalysis.sentiment,
            marketAnalysis.trend
          );
          
          // Add market context to reason
          if (marketAnalysis.sentiment) {
            signal.reason += ` | Market: ${marketAnalysis.sentiment.sentiment} (${marketAnalysis.sentiment.confidence}% conf)`;
          }
        }
        
        // Check if market conditions are favorable
        if (hasLiveMarketContext && !isMarketConditionFavorable(marketAnalysis.sentiment, marketAnalysis.trend)) {
          signal.confidence = Math.max(0, signal.confidence - 15);
          signal.reason += ' | ⚠️ Market conditions not ideal';
        }
      } catch (err) {
        // Kol API error - continue with base signal
        console.warn('[Signal API] Kol API error, using base signal:', err);
      }
    }
    
    return NextResponse.json(signal);
    
  } catch (error) {
    console.error('[Signal API] Error:', error);
    return NextResponse.json(
      {
        market: 'UNKNOWN',
        timeframe: '1h',
        signal: 'WAIT',
        entry: null,
        stop_loss: null,
        take_profit_1: null,
        take_profit_2: null,
        bot_mode: 'DRY_RUN',
        risk_reward: null,
        confidence: 0,
        timestamp: new Date().toISOString(),
        reason: 'API Error'
      },
      { status: 500 }
    );
  }
}

// GET handler - return current signal status (for polling)
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol') || 'BTCUSDT';
  const timeframe = searchParams.get('timeframe') || '1h';
  
  return NextResponse.json({
    market: symbol.toUpperCase(),
    timeframe,
    signal: 'WAIT',
    entry: null,
    stop_loss: null,
    take_profit_1: null,
    take_profit_2: null,
    bot_mode: 'DRY_RUN',
    risk_reward: null,
    confidence: 0,
    timestamp: new Date().toISOString(),
    reason: 'Use POST with candles data for signal generation'
  });
}
