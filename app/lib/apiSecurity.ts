import { NextRequest, NextResponse } from 'next/server';

export function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0]?.trim() || 'unknown';
  }
  return request.headers.get('x-real-ip') || 'unknown';
}

export function enforceApiKey(
  request: NextRequest,
  requiredKey: string | undefined,
  headerName: string
): NextResponse | null {
  if (!requiredKey) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        { error: `${headerName} is not configured on server` },
        { status: 503 }
      );
    }
    // Development fallback: allow requests but signal missing key
    return null;
  }
  const provided = request.headers.get(headerName);
  if (!provided || provided !== requiredKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}
