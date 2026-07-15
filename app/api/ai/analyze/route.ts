/**
 * AI Analysis API Route
 * 
 * Endpoint untuk menganalisis data chart menggunakan Gemini AI.
 * Semua data HARUS berasal dari frontend (tidak mengambil data sendiri).
 */

import { NextRequest, NextResponse } from 'next/server';
import { analyzeWithGemini, AIAnalysisRequest, AIAnalysisResponse } from '@/app/lib/geminiAI';
import { checkRateLimit } from '@/app/lib/rateLimit';
import { enforceApiKey, getClientIp } from '@/app/lib/apiSecurity';

// Rate limiting - max 1 request per 60 seconds per symbol (to avoid quota exhaustion)
const lastRequestTime: Record<string, number> = {};
const MIN_REQUEST_INTERVAL = 60000; // 60 seconds

export async function POST(request: NextRequest) {
  try {
    const apiKeyError = enforceApiKey(request, process.env.APP_API_KEY, 'x-app-api-key');
    if (apiKeyError) return apiKeyError;

    const body = await request.json();
    
    // Validate required fields
    const { symbol, timeframe, candles, currentPrice, structure, zones, patterns } = body;
    
    if (!symbol || !timeframe || !candles || !currentPrice) {
      return NextResponse.json(
        { error: 'Missing required fields: symbol, timeframe, candles, currentPrice' },
        { status: 400 }
      );
    }

    if (!Array.isArray(candles) || candles.length < 20) {
      return NextResponse.json(
        { error: 'Minimum 20 candles required for analysis' },
        { status: 400 }
      );
    }

    // Rate limiting check
    const now = Date.now();
    const lastRequest = lastRequestTime[symbol] || 0;
    
    if (now - lastRequest < MIN_REQUEST_INTERVAL) {
      return NextResponse.json(
        { error: 'Rate limited. Please wait before requesting again.', retryAfter: MIN_REQUEST_INTERVAL - (now - lastRequest) },
        { status: 429 }
      );
    }
    
    lastRequestTime[symbol] = now;

    const ip = getClientIp(request);
    const rate = checkRateLimit(`ai:${ip}:${symbol.toUpperCase()}`, 2, 60000);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Rate limited. Please wait before requesting again.', retryAfter: rate.retryAfterMs || 60000 },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((rate.retryAfterMs || 60000) / 1000)) } }
      );
    }

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: 'AI analysis is not configured' },
        { status: 503 }
      );
    }

    // Prepare request for AI
    const analysisRequest: AIAnalysisRequest = {
      symbol,
      timeframe,
      candles: candles.map((c: { time: number; open: number; high: number; low: number; close: number; volume?: number }) => ({
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      })),
      currentPrice,
      structure: structure || undefined,
      zones: zones || undefined,
      patterns: patterns || undefined,
    };

    console.log(`[AI Analysis] Analyzing ${symbol} on ${timeframe} with Professional Trading Rules Engine...`);
    
    // Call Gemini AI with Professional Trading Rules Engine prompt
    const aiResponse: AIAnalysisResponse = await analyzeWithGemini(analysisRequest);
    
    console.log(`[AI Analysis] Signal: ${aiResponse.signal}, Score: ${aiResponse.validity_score}%, Engine: Rules-Based`);

    return NextResponse.json({
      success: true,
      data: aiResponse,
      timestamp: Date.now(),
      source: 'gemini-ai-rules-engine',
      engine: 'Professional Trading Rules Engine v1.0',
    }, {
      headers: {
        'Cache-Control': 'no-store',
        'X-AI-Engine': 'gemini-rules-engine',
      },
    });

  } catch (error) {
    console.error('[AI Analysis] Error:', error);
    
    return NextResponse.json(
      { 
        success: false,
        error: 'AI analysis failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

// GET endpoint for health check
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    engine: 'Professional Trading Rules Engine',
    aiModel: 'gemini-2.0-flash-exp',
    version: '1.0.0',
    rules: [
      'GATE 1: Data Reliability',
      'GATE 2: Trend Determination (EMA200 + Structure)',
      'GATE 3: Volatility (ATR)',
      'GATE 4: Support & Resistance',
      'GATE 5: Setup Validation (Trend + Pullback)',
      'GATE 6: Risk:Reward (min 1:2)',
      'GATE 7: Sentiment Modifier',
    ],
    capabilities: [
      'signal_generation',
      'trend_analysis',
      'structure_validation',
      'zone_analysis',
      'gates_validation',
      'risk_reward_check',
      'gold_special_rules',
      'live_mode_lock',
    ],
  });
}
