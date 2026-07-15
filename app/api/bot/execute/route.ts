import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/app/lib/rateLimit';
import { enforceApiKey, getClientIp } from '@/app/lib/apiSecurity';
import { validateForexExecutionReadiness } from '@/app/lib/forexExecutionGuard';

/**
 * POST /api/bot/execute
 * Execute a trade based on AI signal
 * 
 * INTEGRATION:
 * - Receives signal from frontend when price reaches entry
 * - Validates signal confidence and market conditions
 * - Executes trade in LIVE mode or simulates in DRY-RUN mode
 */

interface ExecuteTradeRequest {
  signal: {
    signal: 'BUY' | 'SELL' | 'WAIT';
    entry: number;
    stop_loss: number;
    take_profit_1: number;
    take_profit_2: number;
    confidence: number;
    risk_reward: number;
    reason: string;
  };
  currentPrice: number;
  symbol: string;
  timeframe: string;
  mode: 'live' | 'dry-run';
}

// Track executed trades to prevent duplicates
const executedTrades = new Map<string, number>();

export async function POST(request: NextRequest) {
  try {
    const apiKeyError = enforceApiKey(request, process.env.APP_API_KEY, 'x-app-api-key');
    if (apiKeyError) return apiKeyError;

    const ip = getClientIp(request);
    const rate = checkRateLimit(`bot:execute:${ip}`, 10, 60000);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', retryAfter: rate.retryAfterMs || 60000 },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((rate.retryAfterMs || 60000) / 1000)) } }
      );
    }

    const body: ExecuteTradeRequest = await request.json();
    const { signal, currentPrice, symbol, timeframe, mode } = body;

    // Validate request
    if (!signal || !currentPrice || !symbol) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Check for duplicate execution (within 60 seconds)
    const tradeKey = `${symbol}-${signal.signal}-${signal.entry}`;
    const idempotencyKey = request.headers.get('Idempotency-Key') || tradeKey;
    const lastExecution = executedTrades.get(idempotencyKey);
    if (lastExecution && Date.now() - lastExecution < 60000) {
      return NextResponse.json(
        { 
          success: false, 
          message: 'Trade already executed recently',
          duplicate: true 
        },
        { status: 200 }
      );
    }

    // Validate signal confidence
    if (signal.confidence < 60) {
      return NextResponse.json(
        { 
          success: false, 
          message: `Confidence too low: ${signal.confidence}%`,
          reason: 'confidence_low'
        },
        { status: 200 }
      );
    }

    if (mode === 'live') {
      const feedGuard = await validateForexExecutionReadiness(symbol);
      if (!feedGuard.allowed) {
        return NextResponse.json(
          {
            success: false,
            message: 'Live trade blocked by feed guard',
            reason: feedGuard.reason,
            feedStatus: feedGuard.feedStatus,
            source: feedGuard.source,
            marketStatus: feedGuard.marketStatus,
            traderMadeConfigured: feedGuard.traderMadeConfigured,
          },
          { status: 409 },
        );
      }
    }

    // Calculate position size (example: 1% risk)
    const riskPercent = 0.01;
    const accountBalance = 10000; // Demo balance
    const riskAmount = accountBalance * riskPercent;
    const stopLossPips = Math.abs(currentPrice - signal.stop_loss);
    const positionSize = stopLossPips > 0 ? riskAmount / stopLossPips : 0.01;

    // Build trade order
    const tradeOrder = {
      symbol,
      type: signal.signal,
      entry: currentPrice,
      stop_loss: signal.stop_loss,
      take_profit_1: signal.take_profit_1,
      take_profit_2: signal.take_profit_2,
      position_size: positionSize.toFixed(4),
      risk_amount: riskAmount.toFixed(2),
      confidence: signal.confidence,
      risk_reward: signal.risk_reward,
      timeframe,
      timestamp: new Date().toISOString(),
      mode,
      idempotency_key: idempotencyKey,
      feed_guard: mode === 'live' ? 'passed' : 'not-required',
    };

    // Execute based on mode
    if (mode === 'live') {
      // In LIVE mode, try to connect to Python bot backend
      try {
        const BOT_API_URL = process.env.BOT_API_URL || 'http://localhost:8000';
        const response = await fetch(`${BOT_API_URL}/api/bot/execute`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey,
            ...(process.env.BOT_API_KEY ? { 'x-bot-api-key': process.env.BOT_API_KEY } : {}),
          },
          body: JSON.stringify(tradeOrder),
        });

        if (response.ok) {
          const result = await response.json();
          executedTrades.set(idempotencyKey, Date.now());
          
          return NextResponse.json({
            success: true,
            message: `LIVE trade executed: ${signal.signal} ${symbol}`,
            order: tradeOrder,
            backend_response: result,
          });
        } else {
          return NextResponse.json({
            success: false,
            message: 'Bot backend execution failed',
            order: tradeOrder,
          });
        }
      } catch (err) {
        console.error('[Execute] Bot backend not available:', err);

        return NextResponse.json({
          success: false,
          message: 'Bot backend not connected',
          order: tradeOrder,
        }, { status: 503 });
      }
    } else {
      // DRY-RUN mode - simulate execution
      executedTrades.set(idempotencyKey, Date.now());
      
      return NextResponse.json({
        success: true,
        message: `DRY-RUN: ${signal.signal} ${symbol} @ ${currentPrice.toFixed(2)}`,
        order: tradeOrder,
        simulation: true,
      });
    }

  } catch (error: unknown) {
    console.error('[Execute API] Error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

// GET - Check execution status
export async function GET() {
  return NextResponse.json({
    status: 'ready',
    recent_trades: executedTrades.size,
    timestamp: new Date().toISOString(),
  });
}
