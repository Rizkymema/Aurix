import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/app/lib/rateLimit';
import { enforceApiKey, getClientIp } from '@/app/lib/apiSecurity';

const BOT_API_URL = process.env.BOT_API_URL || 'http://localhost:8000';
const BOT_API_KEY = process.env.BOT_API_KEY;

export async function PATCH(request: NextRequest) {
  try {
    const apiKeyError = enforceApiKey(request, process.env.APP_API_KEY, 'x-app-api-key');
    if (apiKeyError) return apiKeyError;

    const ip = getClientIp(request);
    const rate = checkRateLimit(`bot:config:${ip}`, 10, 60000);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', retryAfter: rate.retryAfterMs || 60000 },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((rate.retryAfterMs || 60000) / 1000)) } }
      );
    }

    const body = await request.json();
    
    const response = await fetch(`${BOT_API_URL}/api/bot/config`, {
      method: 'PATCH',
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
    console.error('Bot config error:', error);
    return NextResponse.json(
      { error: 'Failed to update config', details: (error as Error).message },
      { status: 503 }
    );
  }
}
