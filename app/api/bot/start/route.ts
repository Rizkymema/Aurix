import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/app/lib/rateLimit';
import { enforceApiKey, getClientIp } from '@/app/lib/apiSecurity';
import { validateForexExecutionReadiness } from '@/app/lib/forexExecutionGuard';

const BOT_API_URL = process.env.BOT_API_URL || 'http://localhost:8000';
const BOT_API_KEY = process.env.BOT_API_KEY;
const APP_API_KEY = process.env.APP_API_KEY;

export async function POST(request: NextRequest) {
  try {
    const apiKeyError = enforceApiKey(request, APP_API_KEY, 'x-app-api-key');
    if (apiKeyError) return apiKeyError;

    const ip = getClientIp(request);
    const rate = checkRateLimit(`bot:start:${ip}`, 5, 60000);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', retryAfter: rate.retryAfterMs || 60000 },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((rate.retryAfterMs || 60000) / 1000)) } }
      );
    }

    const body = await request.json();
    const symbol = String(body?.symbol || '').toUpperCase();
    const isDryRun = Boolean(body?.dry_run);

    if (!isDryRun && symbol) {
      const feedGuard = await validateForexExecutionReadiness(symbol);
      if (!feedGuard.allowed) {
        return NextResponse.json(
          {
            error: 'Bot start blocked by feed guard',
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
    
    const response = await fetch(`${BOT_API_URL}/api/bot/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(BOT_API_KEY ? { 'x-bot-api-key': BOT_API_KEY } : {}),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json();
      return NextResponse.json(error, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Bot start error:', error);
    return NextResponse.json(
      { error: 'Failed to connect to bot server', details: (error as Error).message },
      { status: 503 }
    );
  }
}
