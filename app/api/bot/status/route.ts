import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/app/lib/rateLimit';
import { enforceApiKey, getClientIp } from '@/app/lib/apiSecurity';

const BOT_API_URL = process.env.BOT_API_URL || 'http://localhost:8000';
const BOT_API_KEY = process.env.BOT_API_KEY;
const APP_API_KEY = process.env.APP_API_KEY;

export async function GET(request: NextRequest) {
  try {
    const apiKeyError = enforceApiKey(request, APP_API_KEY, 'x-app-api-key');
    if (apiKeyError) return apiKeyError;

    const ip = getClientIp(request);
    const rate = checkRateLimit(`bot:status:${ip}`, 30, 60000);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', retryAfter: rate.retryAfterMs || 60000 },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((rate.retryAfterMs || 60000) / 1000)) } }
      );
    }

    const response = await fetch(`${BOT_API_URL}/api/bot/status`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        ...(BOT_API_KEY ? { 'x-bot-api-key': BOT_API_KEY } : {}),
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      const error = await response.json();
      return NextResponse.json(error, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Bot status error:', error);
    return NextResponse.json(
      { 
        state: 'OFFLINE',
        error: 'Bot server is not running',
        details: (error as Error).message 
      },
      { status: 200 } // Return 200 with offline status instead of error
    );
  }
}
