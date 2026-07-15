/**
 * Gemini AI Engine for Trading Analysis
 * 
 * Menggunakan Google Gemini API sebagai otak analisis trading.
 * AI HANYA menganalisis data yang dikirim dari frontend (chart realtime).
 */

import 'server-only';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
// Using gemini-2.0-flash-exp model (confirmed working, has free tier)
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent';

// Types for AI Analysis
export interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface MarketStructure {
  swings: Array<{
    type: 'HH' | 'HL' | 'LH' | 'LL';
    price: number;
    time: number;
  }>;
  breaks: Array<{
    type: 'BOS' | 'CHOCH';
    direction: 'bullish' | 'bearish';
    price: number;
    time: number;
  }>;
  trend: 'bullish' | 'bearish' | 'neutral';
}

export interface ZoneData {
  type: 'supply' | 'demand';
  top: number;
  bottom: number;
  strength: number;
  status: 'fresh' | 'tested' | 'mitigated';
}

export interface PatternData {
  name: string;
  type: 'bullish' | 'bearish';
  reliability: 'HIGH' | 'MEDIUM' | 'LOW';
  time: number;
}

export interface AIAnalysisRequest {
  symbol: string;
  timeframe: string;
  candles: CandleData[];
  currentPrice: number;
  structure?: MarketStructure;
  zones?: ZoneData[];
  patterns?: PatternData[];
}

export interface AIAnalysisResponse {
  signal: 'BUY' | 'SELL' | 'WAIT';
  validity_score: number;
  trend: 'Bullish' | 'Bearish' | 'Neutral';
  entry: number;
  stop_loss: number;
  take_profit_1: number;
  take_profit_2: number;
  rrr: string;
  reason: string[];
  risk_warning: string;
  structure_valid: boolean;
  zone_quality: 'Weak' | 'Moderate' | 'Strong' | 'Extreme';
  pattern_reliability: 'HIGH' | 'MEDIUM' | 'LOW';
  analysis: {
    trend: string;
    support_resistance: string;
    pattern: string;
    momentum: string;
    volume: string;
    confluence: string;
  };
}

/**
 * Build the PROFESSIONAL TRADING RULES ENGINE prompt for Gemini AI
 * 
 * Bertindak seperti DESK ANALISIS INSTITUSIONAL.
 * Bukan trader emosional, bukan spekulan, dan bukan penasihat keuangan.
 */
function buildAnalysisPrompt(data: AIAnalysisRequest): string {
  const lastCandles = data.candles.slice(-50);
  const currentCandle = lastCandles[lastCandles.length - 1];
  
  // Calculate basic indicators for context
  const closes = data.candles.map(c => c.close);
  const ema200 = calculateSimpleEMA(closes, 200);
  const ema21 = calculateSimpleEMA(closes, 21);
  const ema9 = calculateSimpleEMA(closes, 9);
  const atr = calculateSimpleATR(data.candles, 14);
  
  // Format candle data (last 30 for analysis)
  const candleText = lastCandles.slice(-30).map((c, i) => 
    `[${i + 1}] O:${c.open.toFixed(2)} H:${c.high.toFixed(2)} L:${c.low.toFixed(2)} C:${c.close.toFixed(2)} V:${c.volume?.toFixed(0) || 'N/A'}`
  ).join('\n');

  // Format structure
  const structureText = data.structure ? `
Swing Points: ${data.structure.swings.map(s => `${s.type}@${s.price.toFixed(2)}`).join(', ')}
Breaks: ${data.structure.breaks.map(b => `${b.type} ${b.direction}@${b.price.toFixed(2)}`).join(', ')}
Current Trend: ${data.structure.trend}
` : 'No structure data provided';

  // Format zones
  const zonesText = data.zones && data.zones.length > 0 ? data.zones.map(z => 
    `${z.type.toUpperCase()}: ${z.bottom.toFixed(2)}-${z.top.toFixed(2)} (${z.status}, strength:${z.strength})`
  ).join('\n') : 'No zones detected';

  // Determine mode based on symbol
  const isGold = data.symbol === 'XAUUSD';
  const symbolRules = isGold ? `
=== RULES KHUSUS XAUUSD (GOLD) ===
- Gold jarang confidence > 0.75
- RR disarankan ≥ 1:2.5
- Perhatikan level psikologis (kelipatan 10/50/100)
- False breakout sering → wajib rejection candle
- SL tidak boleh terlalu sempit
- Ragu sedikit saja → WAIT
` : '';

  return `Kamu adalah PROFESSIONAL TRADING RULES ENGINE.
Bertindak seperti DESK ANALISIS INSTITUSIONAL.
Output hanya: BUY | SELL | WAIT. WAIT adalah keputusan profesional.

=== INPUT DATA ===
Symbol: ${data.symbol}
Timeframe: ${data.timeframe}
Current Price: ${data.currentPrice.toFixed(2)}
Total Candles: ${data.candles.length}

=== INDICATORS ===
EMA9: ${ema9.toFixed(2)}
EMA21: ${ema21.toFixed(2)}
EMA200: ${ema200.toFixed(2)}
ATR(14): ${atr.toFixed(2)}
Price vs EMA200: ${currentCandle.close > ema200 ? 'ABOVE' : 'BELOW'}

=== LAST 30 CANDLES (OHLCV) ===
${candleText}

=== MARKET STRUCTURE ===
${structureText}

=== SUPPLY & DEMAND ZONES ===
${zonesText}
${symbolRules}
==================================================
RULES GATE (WAJIB BERURUTAN)
==================================================

GATE 1 — DATA RELIABILITY
- WAJIB WAIT jika: totalCandles < 200 atau data tidak konsisten

GATE 2 — TREND DETERMINATION (Gunakan EMA200 + struktur)
- Bullish: Harga dominan di atas EMA200 + struktur HH & HL
- Bearish: Harga dominan di bawah EMA200 + struktur LH & LL
- Sideways: Cross EMA200 / range sempit
- HARD RULE: Bullish → DILARANG SELL, Bearish → DILARANG BUY

GATE 3 — VOLATILITY (ATR)
- ATR terlalu kecil → market lesu → WAIT
- ATR terlalu besar → market liar → WAIT

GATE 4 — SUPPORT & RESISTANCE
- Tentukan S1, S2, R1, R2 dari swing points
- mid_range → WAIT

GATE 5 — SETUP (TREND + PULLBACK)
- BUY valid: Trend bullish + Pullback ke support/EMA21 + Rejection bullish
- SELL valid: Trend bearish + Pullback ke resistance/EMA21 + Rejection bearish
- Tidak lengkap → WAIT

GATE 6 — RISK : REWARD
- WAJIB RR ≥ 1:2 (Gold/LIVE mode: ≥ 1:2.5)
- RR < 2 → WAIT

GATE 7 — SENTIMENT (MODIFIER ONLY)
- Sentiment tidak boleh override struktur

==================================================
REQUIRED OUTPUT FORMAT (JSON ONLY)
==================================================
{
  "signal": "BUY" | "SELL" | "WAIT",
  "validity_score": <number 0-100, gold max 75>,
  "trend": "Bullish" | "Bearish" | "Neutral",
  "entry": <number - exact price>,
  "stop_loss": <number - exact price>,
  "take_profit_1": <number - exact price>,
  "take_profit_2": <number - exact price>,
  "rrr": "<string like '1:2.5'>",
  "reason": [
    "<string - reason 1 based on gates>",
    "<string - reason 2>",
    "<string - reason 3>"
  ],
  "risk_warning": "Analisis probabilitas. Stop loss wajib. Risiko maksimal 1% per trade.",
  "structure_valid": <boolean>,
  "zone_quality": "Weak" | "Moderate" | "Strong" | "Extreme",
  "pattern_reliability": "HIGH" | "MEDIUM" | "LOW",
  "gates_passed": {
    "data": <boolean>,
    "trend": <boolean>,
    "volatility": <boolean>,
    "setup": <boolean>,
    "riskRR": <boolean>
  },
  "analysis": {
    "trend": "<EMA200 position + swing structure>",
    "support_resistance": "<S1, S2, R1, R2 levels>",
    "pattern": "<rejection candle analysis>",
    "momentum": "<price action momentum>",
    "volume": "<volume analysis>",
    "confluence": "<total gates passed, confluence score>"
  }
}

RULES KETAT:
1. Jika salah satu gate FAIL → signal = "WAIT", validity_score = 0
2. Jangan menambah field baru
3. Jangan mengubah struktur output
4. RESPOND WITH VALID JSON ONLY. NO MARKDOWN, NO EXPLANATION.`;
}

/**
 * Simple EMA calculation for prompt context
 */
function calculateSimpleEMA(data: number[], period: number): number {
  if (data.length < period) return data[data.length - 1] || 0;
  
  const multiplier = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  
  for (let i = period; i < data.length; i++) {
    ema = (data[i] - ema) * multiplier + ema;
  }
  
  return ema;
}

/**
 * Simple ATR calculation for prompt context
 */
function calculateSimpleATR(candles: CandleData[], period: number = 14): number {
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
  
  const recentTR = trueRanges.slice(-period);
  return recentTR.reduce((a, b) => a + b, 0) / recentTR.length;
}

/**
 * Call Gemini AI API
 */
export async function analyzeWithGemini(data: AIAnalysisRequest): Promise<AIAnalysisResponse> {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const prompt = buildAnalysisPrompt(data);

  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          temperature: 0.3,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 2048,
        },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini API error:', response.status, errorText);
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const result = await response.json();
    
    // Extract text from response
    const textContent = result.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!textContent) {
      throw new Error('No response from Gemini');
    }

    // Clean and parse JSON
    let cleanJson = textContent.trim();
    
    // Remove markdown code blocks if present
    if (cleanJson.startsWith('```json')) {
      cleanJson = cleanJson.slice(7);
    }
    if (cleanJson.startsWith('```')) {
      cleanJson = cleanJson.slice(3);
    }
    if (cleanJson.endsWith('```')) {
      cleanJson = cleanJson.slice(0, -3);
    }
    cleanJson = cleanJson.trim();

    const aiResponse: AIAnalysisResponse = JSON.parse(cleanJson);
    
    // Validate response
    if (!aiResponse.signal || !['BUY', 'SELL', 'WAIT'].includes(aiResponse.signal)) {
      throw new Error('Invalid signal in AI response');
    }

    return aiResponse;

  } catch (error) {
    console.error('Gemini analysis error:', error);
    
    // Return WAIT signal on error with explanation
    return {
      signal: 'WAIT',
      validity_score: 0,
      trend: 'Neutral',
      entry: data.currentPrice,
      stop_loss: data.currentPrice * 0.99,
      take_profit_1: data.currentPrice * 1.01,
      take_profit_2: data.currentPrice * 1.02,
      rrr: '1:1',
      reason: ['AI analysis temporarily unavailable', 'Using conservative WAIT signal'],
      risk_warning: 'Do not trade - AI analysis failed. Wait for next candle.',
      structure_valid: false,
      zone_quality: 'Weak',
      pattern_reliability: 'LOW',
      analysis: {
        trend: 'Unable to analyze - AI error',
        support_resistance: 'Unable to analyze',
        pattern: 'Unable to analyze',
        momentum: 'Unable to analyze',
        volume: 'Unable to analyze',
        confluence: 'Unable to analyze',
      },
    };
  }
}

/**
 * Quick validation of zones using AI
 */
export async function validateZonesWithAI(
  zones: ZoneData[],
  currentPrice: number,
  candles: CandleData[]
): Promise<{ validZones: ZoneData[]; analysis: string }> {
  const prompt = `Analyze these Supply/Demand zones for ${currentPrice.toFixed(2)}:
${zones.map(z => `${z.type}: ${z.bottom}-${z.top} (${z.status})`).join('\n')}

Last 5 candles: ${candles.slice(-5).map(c => `${c.close.toFixed(2)}`).join(', ')}

Rate each zone 1-10 and explain. Return JSON: { "ratings": [{"index": 0, "score": 8, "valid": true}], "analysis": "..." }`;

  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
      }),
    });

    const result = await response.json();
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());

    const validZones = zones.filter((_, i) => 
      parsed.ratings?.find((r: { index: number; valid: boolean }) => r.index === i)?.valid
    );

    return { validZones, analysis: parsed.analysis || 'No analysis' };
  } catch {
    return { validZones: zones, analysis: 'AI validation unavailable' };
  }
}

/**
 * Validate market structure with AI
 */
export async function validateStructureWithAI(
  structure: MarketStructure,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _candles: CandleData[]
): Promise<{ valid: boolean; confidence: number; analysis: string }> {
  const prompt = `Validate this market structure:
Trend: ${structure.trend}
Swings: ${structure.swings.map(s => `${s.type}@${s.price}`).join(', ')}
Breaks: ${structure.breaks.map(b => `${b.type}(${b.direction})`).join(', ')}

Is this structure valid for trading? Return JSON: { "valid": boolean, "confidence": 0-100, "analysis": "..." }`;

  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 512 },
      }),
    });

    const result = await response.json();
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch {
    return { valid: true, confidence: 50, analysis: 'AI validation unavailable' };
  }
}
