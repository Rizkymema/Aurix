/**
 * SMC Analysis API Route
 * =======================
 * Next.js API endpoint untuk Smart Money Concept analysis
 * Meneruskan request ke Python SMC Service
 */

import { NextRequest, NextResponse } from 'next/server';

// Python bot API URL
const BOT_API_URL = process.env.NEXT_PUBLIC_BOT_API_URL || 'http://localhost:8001';

interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

interface ZoneData {
  type: 'supply' | 'demand';
  status: 'fresh' | 'tested' | 'broken';
  high: number;
  low: number;
  strength: number;
  created_at?: number;
  tested_count?: number;
}

interface MarketStructure {
  trend?: string;
  last_swing_high?: number;
  last_swing_low?: number;
  structure?: string;
}

interface SMCAnalysisRequest {
  ohlc_h4: CandleData[];
  ohlc_m15: CandleData[];
  supply_demand_zones?: ZoneData[];
  market_structure?: MarketStructure;
  current_volume?: number;
  symbol?: string;
}

interface SMCSetup {
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  position_type: 'LONG' | 'SHORT';
  risk_pips: number;
  reward_pips_tp1: number;
  reward_pips_tp2: number;
  rrr_tp1: number;
  rrr_tp2: number;
}

interface SMCAnalysisResponse {
  decision: 'ENTRY' | 'NO_TRADE';
  confidence_score: number;
  logic: string;
  setup?: SMCSetup;
  analysis?: {
    trend_h4?: string;
    poi_zone?: ZoneData;
    confirmation?: string;
    market_structure?: string;
  };
  warnings?: string[];
  timestamp?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body: SMCAnalysisRequest = await request.json();

    // Validasi input
    if (!body.ohlc_h4 || body.ohlc_h4.length < 200) {
      return NextResponse.json(
        { 
          error: 'Insufficient H4 data', 
          message: 'Minimal 200 candle H4 diperlukan untuk EMA 200' 
        },
        { status: 400 }
      );
    }

    if (!body.ohlc_m15 || body.ohlc_m15.length < 20) {
      return NextResponse.json(
        { 
          error: 'Insufficient M15 data', 
          message: 'Minimal 20 candle M15 diperlukan untuk konfirmasi' 
        },
        { status: 400 }
      );
    }

    // Forward ke Python SMC Service
    const response = await fetch(`${BOT_API_URL}/api/smc/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ohlc_h4: body.ohlc_h4,
        ohlc_m15: body.ohlc_m15,
        supply_demand_zones: body.supply_demand_zones || [],
        market_structure: body.market_structure || {},
        current_volume: body.current_volume || 0,
        symbol: body.symbol || 'XAUUSD'
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('[SMC API] Python service error:', errorData);
      
      // Fallback: jika Python service tidak available, gunakan local analysis
      return await localAnalysis(body);
    }

    const result: SMCAnalysisResponse = await response.json();
    
    return NextResponse.json(result);

  } catch (error) {
    console.error('[SMC API] Error:', error);
    
    // Jika Python service down, coba local analysis
    try {
      const body = await request.json();
      return await localAnalysis(body);
    } catch {
      return NextResponse.json(
        { 
          error: 'Analysis failed', 
          message: error instanceof Error ? error.message : 'Unknown error' 
        },
        { status: 500 }
      );
    }
  }
}

/**
 * Local analysis fallback ketika Python service tidak available
 * Menggunakan logika SMC sederhana di TypeScript
 */
async function localAnalysis(body: SMCAnalysisRequest): Promise<NextResponse> {
  const { ohlc_h4, ohlc_m15, supply_demand_zones = [] } = body;

  // Calculate EMA 200
  const ema200 = calculateEMA(ohlc_h4.map(c => c.close), 200);
  const currentPrice = ohlc_m15[ohlc_m15.length - 1].close;
  const h4Price = ohlc_h4[ohlc_h4.length - 1].close;
  
  // Determine trend
  const trend = h4Price > ema200 ? 'bullish' : 'bearish';
  
  // Find POI zone
  const poi = findPOIZone(currentPrice, supply_demand_zones, trend);
  
  // Check confirmation (simplified CHOCH detection)
  const confirmation = detectConfirmation(ohlc_m15, trend);
  
  // Calculate confidence
  let confidence = 0;
  const warnings: string[] = [];
  
  // Trend alignment: +30
  if ((trend === 'bullish' && currentPrice > ema200) || 
      (trend === 'bearish' && currentPrice < ema200)) {
    confidence += 30;
  } else {
    warnings.push('Price vs EMA tidak sejalan dengan trend');
  }
  
  // POI zone: +30
  if (poi && poi.strength >= 60) {
    confidence += 30;
  } else if (poi) {
    confidence += 15;
    warnings.push('Zone strength rendah');
  } else {
    warnings.push('Tidak ada valid POI zone');
  }
  
  // Confirmation: +25
  if (confirmation) {
    confidence += 25;
  } else {
    warnings.push('Belum ada konfirmasi M15');
  }
  
  // Fresh zone bonus: +15
  if (poi?.status === 'fresh') {
    confidence += 15;
  }
  
  // Generate response
  const minConfidence = 60;
  const decision = confidence >= minConfidence ? 'ENTRY' : 'NO_TRADE';
  
  let setup: SMCSetup | undefined;
  let logic: string;
  
  if (decision === 'ENTRY' && poi) {
    // Calculate setup
    const isLong = trend === 'bullish';
    const sl = isLong ? poi.low - 2 : poi.high + 2; // 2 pip buffer
    const riskPips = Math.abs(currentPrice - sl);
    const tp1 = isLong ? currentPrice + (riskPips * 1.5) : currentPrice - (riskPips * 1.5);
    const tp2 = isLong ? currentPrice + (riskPips * 3) : currentPrice - (riskPips * 3);
    
    setup = {
      entry: currentPrice,
      sl,
      tp1,
      tp2,
      position_type: isLong ? 'LONG' : 'SHORT',
      risk_pips: riskPips,
      reward_pips_tp1: riskPips * 1.5,
      reward_pips_tp2: riskPips * 3,
      rrr_tp1: 1.5,
      rrr_tp2: 3.0
    };
    
    logic = `✅ ENTRY ${setup.position_type}: Trend ${trend.toUpperCase()} (EMA200), ` +
            `harga di ${poi.type.toUpperCase()} Zone (strength ${poi.strength}%), ` +
            `konfirmasi ${confirmation || 'pattern'} M15.`;
  } else {
    logic = poi 
      ? `⏳ Tunggu konfirmasi: Trend ${trend}, harga mendekati ${poi.type} zone.`
      : `⏳ NO_TRADE: Tidak ada valid POI zone. Tunggu harga pullback ke zone.`;
  }
  
  const response: SMCAnalysisResponse = {
    decision: decision as 'ENTRY' | 'NO_TRADE',
    confidence_score: confidence,
    logic,
    setup,
    analysis: {
      trend_h4: trend,
      poi_zone: poi || undefined,
      confirmation: confirmation || undefined,
      market_structure: trend
    },
    warnings,
    timestamp: new Date().toISOString()
  };
  
  return NextResponse.json(response);
}

/**
 * Calculate Exponential Moving Average
 */
function calculateEMA(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1];
  
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  
  return ema;
}

/**
 * Find Point of Interest zone
 */
function findPOIZone(
  currentPrice: number, 
  zones: ZoneData[], 
  trend: string
): ZoneData | null {
  // Filter zones by trend
  const relevantZones = zones.filter(z => {
    if (trend === 'bullish') return z.type === 'demand';
    if (trend === 'bearish') return z.type === 'supply';
    return true;
  });
  
  // Find zone containing price or nearest
  for (const zone of relevantZones) {
    if (currentPrice >= zone.low && currentPrice <= zone.high) {
      return zone;
    }
  }
  
  // Find nearest zone
  let nearestZone: ZoneData | null = null;
  let minDistance = Infinity;
  
  for (const zone of relevantZones) {
    const distance = trend === 'bullish' 
      ? currentPrice - zone.high 
      : zone.low - currentPrice;
    
    if (distance > 0 && distance < minDistance && distance < 10) { // Within 10 pips
      minDistance = distance;
      nearestZone = zone;
    }
  }
  
  return nearestZone;
}

/**
 * Detect confirmation pattern in M15
 */
function detectConfirmation(candles: CandleData[], trend: string): string | null {
  if (candles.length < 3) return null;
  
  const last3 = candles.slice(-3);
  
  // Bullish engulfing
  if (trend === 'bullish') {
    const prev = last3[1];
    const curr = last3[2];
    
    if (prev.close < prev.open && // Red candle
        curr.close > curr.open && // Green candle
        curr.open <= prev.close && // Opens at/below prev close
        curr.close > prev.open) { // Closes above prev open
      return 'bullish_engulfing';
    }
  }
  
  // Bearish engulfing
  if (trend === 'bearish') {
    const prev = last3[1];
    const curr = last3[2];
    
    if (prev.close > prev.open && // Green candle
        curr.close < curr.open && // Red candle
        curr.open >= prev.close && // Opens at/above prev close
        curr.close < prev.open) { // Closes below prev open
      return 'bearish_engulfing';
    }
  }
  
  // CHOCH detection (simplified)
  const highs = candles.slice(-10).map(c => c.high);
  const lows = candles.slice(-10).map(c => c.low);
  
  const recentHigh = Math.max(...highs.slice(-5));
  const recentLow = Math.min(...lows.slice(-5));
  const prevHigh = Math.max(...highs.slice(0, 5));
  const prevLow = Math.min(...lows.slice(0, 5));
  
  if (trend === 'bullish' && recentLow > prevLow) {
    return 'CHOCH_up';
  }
  
  if (trend === 'bearish' && recentHigh < prevHigh) {
    return 'CHOCH_down';
  }
  
  return null;
}

/**
 * GET endpoint for SMC status
 */
export async function GET(): Promise<NextResponse> {
  try {
    const response = await fetch(`${BOT_API_URL}/api/smc/status`);
    
    if (!response.ok) {
      return NextResponse.json({
        status: 'fallback_mode',
        message: 'Python SMC service unavailable, using local analysis',
        timestamp: new Date().toISOString()
      });
    }
    
    const status = await response.json();
    return NextResponse.json(status);
    
  } catch {
    return NextResponse.json({
      status: 'fallback_mode',
      message: 'Python SMC service unavailable, using local analysis',
      timestamp: new Date().toISOString()
    });
  }
}
