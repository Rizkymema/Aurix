"""
INSTITUTIONAL-GRADE TRADING ENGINE (Python Bot Integration)
===========================================================

Mirrors the TypeScript institutionalEngine.ts for the Python trading bot.
11-step scoring & gating system that behaves like a senior fund trader.

Core principle:
    If the setup is not clear, structured, and statistically favorable → NO TRADE.

Scoring matrix (total 100):
    Trend clarity .............. 25
    Structure validity ......... 20
    Zone quality ............... 20
    Entry candle ............... 15
    Sentiment alignment ........ 10
    RRR ≥ 3 bonus .............. 10

Grading:
    A+  ≥ 90  (rare, institutional-grade)
    A   80–89
    B   70–79
    < 70  → NO TRADE
"""

import numpy as np
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any, Literal
from datetime import datetime
import logging
import time

logger = logging.getLogger(__name__)

# ─── Constants ────────────────────────────────────────────────────────

MIN_CANDLES = 200
EMA_FLAT_THRESHOLD = 0.0015        # ±0.15 % slope → flat
MIN_RRR = 2.0
MAX_RISK_PCT = 1.0
COOLDOWN_CANDLES_AFTER_2_LOSSES = 3
COOLDOWN_CANDLES_AFTER_APLUS_LOSS = 4
NEWS_BLOCK_MINUTES = 30

# ─── Types ────────────────────────────────────────────────────────────

InstitutionalGrade = Literal['A+', 'A', 'B', 'NO_TRADE']
InstitutionalDecision = Literal['TRADE', 'NO_TRADE']
TradeDirection = Literal['BUY', 'SELL', 'NONE']
MarketCondition = Literal['TRENDING', 'RANGING', 'CHOPPY']
VolatilityQuality = Literal['CLEAN', 'RANDOM']


@dataclass
class ScoreBreakdown:
    trend_clarity: int = 0       # 0-25
    structure_validity: int = 0  # 0-20
    zone_quality: int = 0        # 0-20
    entry_candle: int = 0        # 0-15
    sentiment_alignment: int = 0 # 0-10
    rrr_bonus: int = 0           # 0-10

    @property
    def total(self) -> int:
        return (self.trend_clarity + self.structure_validity +
                self.zone_quality + self.entry_candle +
                self.sentiment_alignment + self.rrr_bonus)

    def to_dict(self) -> Dict[str, int]:
        return {
            'trend_clarity': self.trend_clarity,
            'structure_validity': self.structure_validity,
            'zone_quality': self.zone_quality,
            'entry_candle': self.entry_candle,
            'sentiment_alignment': self.sentiment_alignment,
            'rrr_bonus': self.rrr_bonus,
            'total': self.total,
        }


@dataclass
class StepResult:
    step: int
    name: str
    passed: bool
    score: int
    reason: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            'step': self.step,
            'name': self.name,
            'passed': self.passed,
            'score': self.score,
            'reason': self.reason,
        }


@dataclass
class DisciplineState:
    consecutive_losses: int = 0
    cooldown_active: bool = False
    cooldown_until: float = 0.0    # Unix timestamp
    cooldown_reason: str = ''
    locked_candles_remaining: int = 0
    last_loss_grade: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            'consecutive_losses': self.consecutive_losses,
            'cooldown_active': self.cooldown_active,
            'cooldown_until': self.cooldown_until,
            'cooldown_reason': self.cooldown_reason,
            'locked_candles_remaining': self.locked_candles_remaining,
            'last_loss_grade': self.last_loss_grade,
        }


@dataclass
class InstitutionalOutput:
    decision: InstitutionalDecision = 'NO_TRADE'
    direction: TradeDirection = 'NONE'
    grade: InstitutionalGrade = 'NO_TRADE'
    confidence: int = 0
    entry: Optional[float] = None
    stop_loss: Optional[float] = None
    take_profit: List[float] = field(default_factory=list)
    reason: List[str] = field(default_factory=list)
    invalid_if: List[str] = field(default_factory=list)
    cooldown: bool = False
    score_breakdown: ScoreBreakdown = field(default_factory=ScoreBreakdown)
    step_results: List[StepResult] = field(default_factory=list)
    discipline: DisciplineState = field(default_factory=DisciplineState)
    market_condition: MarketCondition = 'CHOPPY'
    volatility_quality: VolatilityQuality = 'RANDOM'

    def to_dict(self) -> Dict[str, Any]:
        return {
            'decision': self.decision,
            'direction': self.direction,
            'grade': self.grade,
            'confidence': self.confidence,
            'entry': self.entry,
            'stop_loss': self.stop_loss,
            'take_profit': self.take_profit,
            'reason': self.reason,
            'invalid_if': self.invalid_if,
            'cooldown': self.cooldown,
            'score_breakdown': self.score_breakdown.to_dict(),
            'step_results': [s.to_dict() for s in self.step_results],
            'discipline': self.discipline.to_dict(),
            'market_condition': self.market_condition,
            'volatility_quality': self.volatility_quality,
        }


# ─── Helper: EMA ──────────────────────────────────────────────────────

def _ema(data: np.ndarray, period: int) -> np.ndarray:
    """Calculate EMA for entire series."""
    if len(data) < period:
        return np.full(len(data), np.nan)
    result = np.zeros(len(data))
    k = 2 / (period + 1)
    result[period - 1] = np.mean(data[:period])
    for i in range(period, len(data)):
        result[i] = (data[i] - result[i - 1]) * k + result[i - 1]
    return result


def _atr(highs: np.ndarray, lows: np.ndarray, closes: np.ndarray, period: int = 14) -> float:
    """Calculate ATR (last value)."""
    if len(closes) < 2:
        return 0.0
    trs = []
    for i in range(1, len(closes)):
        tr = max(highs[i] - lows[i],
                 abs(highs[i] - closes[i - 1]),
                 abs(lows[i] - closes[i - 1]))
        trs.append(tr)
    if len(trs) < period:
        return float(np.mean(trs)) if trs else 0.0
    ema_vals = _ema(np.array(trs), period)
    return float(ema_vals[-1])


# ─── Step 1: Market Context ──────────────────────────────────────────

def _step_market_context(closes: np.ndarray, candles: List[Dict]) -> Dict:
    ema50 = _ema(closes, 50)
    last30 = closes[-30:]
    ema50_last30 = ema50[-30:]

    above = sum(1 for i in range(len(last30)) if last30[i] > ema50_last30[i])
    dominance = max(above, 30 - above) / 30

    # Body-to-range ratio
    recent = candles[-20:]
    clean_count = 0
    for c in recent:
        body = abs(c['close'] - c['open'])
        rng = c['high'] - c['low']
        if rng > 0 and body / rng > 0.45:
            clean_count += 1
    clean_ratio = clean_count / len(recent) if recent else 0

    if dominance >= 0.65 and clean_ratio >= 0.5:
        condition, vol_q = 'TRENDING', 'CLEAN'
    elif dominance >= 0.50:
        condition = 'RANGING'
        vol_q = 'CLEAN' if clean_ratio >= 0.4 else 'RANDOM'
    else:
        condition, vol_q = 'CHOPPY', 'RANDOM'

    passed = condition != 'CHOPPY' and vol_q != 'RANDOM'
    return {
        'condition': condition,
        'volatility_quality': vol_q,
        'result': StepResult(1, 'Market Context', passed, 0,
                             f'{condition} / {vol_q}' + ('' if passed else ' → NO TRADE')),
    }


# ─── Step 2: Trend Bias (EMA 200) ────────────────────────────────────

def _step_trend_bias(closes: np.ndarray) -> Dict:
    e200 = _ema(closes, 200)
    current = float(closes[-1])
    ema200_val = float(e200[-1])

    # Slope over last 20 bars
    if len(e200) >= 20:
        slope20 = (e200[-1] - e200[-20]) / e200[-20] if e200[-20] != 0 else 0
    else:
        slope20 = 0
    is_flat = abs(slope20) < EMA_FLAT_THRESHOLD

    dist_pct = (current - ema200_val) / ema200_val if ema200_val != 0 else 0
    clearly_above = dist_pct > 0.002
    clearly_below = dist_pct < -0.002

    if is_flat or (not clearly_above and not clearly_below):
        direction, score = 'NONE', 0
    elif clearly_above:
        direction = 'BUY'
        score = min(25, round(abs(dist_pct) * 500 + abs(slope20) * 2000))
    else:
        direction = 'SELL'
        score = min(25, round(abs(dist_pct) * 500 + abs(slope20) * 2000))

    passed = direction != 'NONE'
    return {
        'direction': direction,
        'ema200': ema200_val,
        'trend_score': score,
        'result': StepResult(2, 'Trend Bias (EMA 200)', passed, score,
                             f'Price {"above" if direction == "BUY" else "below"} EMA200 ({ema200_val:.2f})'
                             if passed else f'EMA200 flat or price inside → NO TRADE'),
    }


# ─── Step 3: Market Structure ────────────────────────────────────────

def _detect_swings(candles: List[Dict], lookback: int = 5) -> List[Dict]:
    swings = []
    for i in range(lookback, len(candles) - lookback):
        c = candles[i]
        left = candles[i - lookback:i]
        right = candles[i + 1:i + lookback + 1]

        is_high = all(l['high'] <= c['high'] for l in left) and all(r['high'] <= c['high'] for r in right)
        is_low = all(l['low'] >= c['low'] for l in left) and all(r['low'] >= c['low'] for r in right)

        if is_high:
            prev_highs = [s for s in swings if s['type'] in ('HH', 'LH')]
            if prev_highs:
                stype = 'HH' if c['high'] > prev_highs[-1]['price'] else 'LH'
            else:
                stype = 'HH'
            swings.append({'type': stype, 'price': c['high'], 'time': c['time']})

        if is_low:
            prev_lows = [s for s in swings if s['type'] in ('HL', 'LL')]
            if prev_lows:
                stype = 'HL' if c['low'] > prev_lows[-1]['price'] else 'LL'
            else:
                stype = 'HL'
            swings.append({'type': stype, 'price': c['low'], 'time': c['time']})

    return swings[-8:]


def _step_structure(candles: List[Dict], direction: str) -> Dict:
    swings = _detect_swings(candles, 5)
    recent = swings[-4:]

    bullish = sum(1 for s in recent if s['type'] in ('HH', 'HL'))
    bearish = sum(1 for s in recent if s['type'] in ('LH', 'LL'))

    passed = False
    score = 0
    if direction == 'BUY' and bullish >= 2:
        passed, score = True, min(20, bullish * 7)
        reason = f'HH/HL structure confirmed ({bullish}/4 swings bullish)'
    elif direction == 'SELL' and bearish >= 2:
        passed, score = True, min(20, bearish * 7)
        reason = f'LH/LL structure confirmed ({bearish}/4 swings bearish)'
    else:
        reason = f'No clear structure for {direction} → NO TRADE'

    return {
        'score': score,
        'swings': swings,
        'result': StepResult(3, 'Market Structure', passed, score, reason),
    }


# ─── Step 4: Zone Quality ────────────────────────────────────────────

def _step_zone_quality(zones: List[Dict], direction: str, price: float, current_atr: float) -> Dict:
    relevant = 'demand' if direction == 'BUY' else 'supply'
    candidates = [z for z in zones if z.get('type') == relevant and z.get('status') != 'broken']

    if not candidates:
        return {
            'score': 0,
            'best_zone': None,
            'result': StepResult(4, 'Supply / Demand Zone', False, 0, f'No {relevant} zones → NO TRADE'),
        }

    best_zone = None
    best_score = 0

    for z in candidates:
        zs = 0
        if z.get('status') == 'fresh':
            zs += 10
        elif z.get('test_count', 0) <= 1:
            zs += 5
        if z.get('origin_impulse', False):
            zs += 5
        zs += min(5, z.get('strength', 0) / 20)

        center = (z['high'] + z['low']) / 2
        dist = abs(price - center)
        if current_atr > 0 and dist <= current_atr * 2:
            prox = max(0, 1 - dist / (current_atr * 2))
            zs *= (0.5 + prox * 0.5)
        else:
            zs *= 0.2

        if zs > best_score:
            best_score = zs
            best_zone = z

    final_score = min(20, round(best_score))
    passed = final_score >= 8 and best_zone is not None and best_zone.get('status') == 'fresh'

    return {
        'score': final_score,
        'best_zone': best_zone,
        'result': StepResult(4, 'Supply / Demand Zone', passed, final_score,
                             f'Fresh {relevant} zone (strength {best_zone.get("strength", 0)})' if passed
                             else f'Zone weak or late (score {final_score}/20) → NO TRADE'),
    }


# ─── Step 5: Entry Confirmation ──────────────────────────────────────

def _step_entry_confirmation(candles: List[Dict], direction: str, near_zone: bool) -> Dict:
    if not near_zone:
        return {'score': 0, 'pattern': 'none',
                'result': StepResult(5, 'Entry Confirmation', False, 0, 'Not near key level')}

    last = candles[-1]
    prev = candles[-2] if len(candles) >= 2 else None
    if not last or not prev:
        return {'score': 0, 'pattern': 'none',
                'result': StepResult(5, 'Entry Confirmation', False, 0, 'Insufficient data')}

    body = abs(last['close'] - last['open'])
    rng = last['high'] - last['low']
    lower_wick = min(last['open'], last['close']) - last['low']
    upper_wick = last['high'] - max(last['open'], last['close'])
    prev_body = abs(prev['close'] - prev['open'])

    score = 0
    pattern = 'none'

    if direction == 'BUY':
        if rng > 0 and lower_wick > body * 2 and lower_wick > rng * 0.55:
            score, pattern = 13, 'Bullish Pin Bar'
        elif (last['close'] > last['open'] and body > prev_body * 1.2
              and last['close'] > prev['high'] and last['open'] <= prev['close']):
            score, pattern = 15, 'Bullish Engulfing'
        elif last['close'] > last['open'] and rng > 0 and body / rng > 0.5:
            score, pattern = 8, 'Bullish Candle'
    elif direction == 'SELL':
        if rng > 0 and upper_wick > body * 2 and upper_wick > rng * 0.55:
            score, pattern = 13, 'Bearish Shooting Star'
        elif (last['close'] < last['open'] and body > prev_body * 1.2
              and last['close'] < prev['low'] and last['open'] >= prev['close']):
            score, pattern = 15, 'Bearish Engulfing'
        elif last['close'] < last['open'] and rng > 0 and body / rng > 0.5:
            score, pattern = 8, 'Bearish Candle'

    score = min(15, score)
    passed = score >= 8
    return {
        'score': score,
        'pattern': pattern,
        'result': StepResult(5, 'Entry Confirmation', passed, score,
                             f'{pattern} at key level ({score}/15)' if passed else 'No valid entry pattern'),
    }


# ─── Step 6: Risk Management ─────────────────────────────────────────

def _step_risk_management(direction: str, entry: float, swings: List[Dict], current_atr: float) -> Dict:
    if direction == 'BUY':
        lows = [s['price'] for s in swings if s['type'] in ('HL', 'LL')]
        sl = (min(lows) - current_atr * 0.3) if lows else (entry - current_atr * 2)
    else:
        highs = [s['price'] for s in swings if s['type'] in ('HH', 'LH')]
        sl = (max(highs) + current_atr * 0.3) if highs else (entry + current_atr * 2)

    risk = abs(entry - sl)
    if direction == 'BUY':
        tp1, tp2 = entry + risk * 2, entry + risk * 3
    else:
        tp1, tp2 = entry - risk * 2, entry - risk * 3

    rrr = abs(tp1 - entry) / risk if risk > 0 else 0

    if rrr >= 3:
        score = 10
    elif rrr >= 2.5:
        score = 7
    elif rrr >= 2:
        score = 4
    else:
        score = 0

    passed = rrr >= MIN_RRR
    return {
        'sl': sl, 'tp1': tp1, 'tp2': tp2, 'rrr': rrr, 'score': score,
        'result': StepResult(6, 'Risk Management', passed, score,
                             f'RRR 1:{rrr:.1f}, SL structure-based' if passed
                             else f'RRR 1:{rrr:.1f} < 1:{MIN_RRR} → NO TRADE'),
    }


# ─── Step 7: News & Sentiment ────────────────────────────────────────

def _step_news_sentiment(news: List[Dict], sentiment: Optional[Dict], direction: str) -> Dict:
    now = time.time() * 1000  # ms
    block_window = NEWS_BLOCK_MINUTES * 60 * 1000

    upcoming = [n for n in news
                if n.get('impact') == 'HIGH' and now < n.get('time', 0) < now + block_window]

    if upcoming:
        titles = ', '.join(n.get('title', '?') for n in upcoming)
        return {
            'sentiment_score': 0, 'blocked': True,
            'result': StepResult(7, 'News & Sentiment', False, 0,
                                 f'High-impact news in {NEWS_BLOCK_MINUTES}min: {titles} → BLOCK'),
        }

    sent_score = 5
    if sentiment:
        bias = sentiment.get('bias', 'neutral')
        strength = sentiment.get('strength', 50)
        aligned = ((direction == 'BUY' and bias == 'bullish') or
                   (direction == 'SELL' and bias == 'bearish'))
        conflicting = ((direction == 'BUY' and bias == 'bearish') or
                       (direction == 'SELL' and bias == 'bullish'))

        if aligned:
            sent_score = min(10, 5 + strength // 20)
        elif conflicting and strength >= 70:
            return {
                'sentiment_score': 0, 'blocked': False,
                'result': StepResult(7, 'News & Sentiment', False, 0,
                                     f'Strong {bias} sentiment ({strength}%) against {direction} → NO TRADE'),
            }
        elif conflicting:
            sent_score = max(0, 5 - strength // 20)

    return {
        'sentiment_score': sent_score, 'blocked': False,
        'result': StepResult(7, 'News & Sentiment', True, sent_score,
                             f'Sentiment OK (score {sent_score}/10), no blocking news'),
    }


# ─── Step 10: Discipline ─────────────────────────────────────────────

def _step_discipline(discipline: DisciplineState) -> Dict:
    now = time.time() * 1000
    if discipline.cooldown_active and now < discipline.cooldown_until:
        return {
            'allowed': False,
            'updated': discipline,
            'result': StepResult(10, 'Discipline', False, 0,
                                 f'Cooldown: {discipline.cooldown_reason}'),
        }
    # Clear expired cooldown
    updated = DisciplineState(
        consecutive_losses=discipline.consecutive_losses,
        cooldown_active=False,
        cooldown_until=0,
        cooldown_reason='',
        locked_candles_remaining=0,
        last_loss_grade=discipline.last_loss_grade,
    )
    return {
        'allowed': True,
        'updated': updated,
        'result': StepResult(10, 'Discipline', True, 0, 'No cooldown active'),
    }


# ─── Grading ──────────────────────────────────────────────────────────

def _grade(total: int) -> InstitutionalGrade:
    if total >= 90:
        return 'A+'
    if total >= 80:
        return 'A'
    if total >= 70:
        return 'B'
    return 'NO_TRADE'


# ─── Main Engine ──────────────────────────────────────────────────────

def run_institutional_engine(
    candles: List[Dict],
    zones: Optional[List[Dict]] = None,
    news: Optional[List[Dict]] = None,
    sentiment: Optional[Dict] = None,
    discipline: Optional[DisciplineState] = None,
) -> InstitutionalOutput:
    """
    Run the full 11-step institutional analysis pipeline.

    Args:
        candles: List of OHLCV dicts (time, open, high, low, close, volume)
        zones: Supply/Demand zone dicts
        news: Upcoming news event dicts
        sentiment: Sentiment dict (bias, strength)
        discipline: Current discipline state

    Returns:
        InstitutionalOutput with decision, grade, levels, and full breakdown
    """
    zones = zones or []
    news = news or []
    discipline = discipline or DisciplineState()
    steps: List[StepResult] = []
    zero = ScoreBreakdown()

    def no_trade(reason: List[str], scores: ScoreBreakdown = zero,
                 cond: MarketCondition = 'CHOPPY', vol: VolatilityQuality = 'RANDOM',
                 disc: DisciplineState = discipline) -> InstitutionalOutput:
        return InstitutionalOutput(
            decision='NO_TRADE', direction='NONE', grade='NO_TRADE',
            confidence=0, reason=reason, cooldown=disc.cooldown_active,
            score_breakdown=scores, step_results=list(steps),
            discipline=disc, market_condition=cond, volatility_quality=vol,
        )

    # Data check
    if len(candles) < MIN_CANDLES:
        r = StepResult(0, 'Data Check', False, 0, f'Need {MIN_CANDLES} candles, got {len(candles)}')
        steps.append(r)
        return no_trade([r.reason])

    closes = np.array([c['close'] for c in candles], dtype=float)
    highs = np.array([c['high'] for c in candles], dtype=float)
    lows = np.array([c['low'] for c in candles], dtype=float)

    # Step 1
    ctx = _step_market_context(closes, candles)
    steps.append(ctx['result'])
    if not ctx['result'].passed:
        return no_trade([ctx['result'].reason], cond=ctx['condition'], vol=ctx['volatility_quality'])

    # Step 2
    trend = _step_trend_bias(closes)
    steps.append(trend['result'])
    if not trend['result'].passed:
        return no_trade([trend['result'].reason], cond=ctx['condition'], vol=ctx['volatility_quality'])

    # Step 3
    structure = _step_structure(candles, trend['direction'])
    steps.append(structure['result'])
    if not structure['result'].passed:
        return no_trade([structure['result'].reason],
                        ScoreBreakdown(trend_clarity=trend['trend_score']),
                        ctx['condition'], ctx['volatility_quality'])

    # Step 4
    current_price = float(closes[-1])
    current_atr = _atr(highs, lows, closes)
    zone = _step_zone_quality(zones, trend['direction'], current_price, current_atr)
    steps.append(zone['result'])
    if not zone['result'].passed:
        return no_trade([zone['result'].reason],
                        ScoreBreakdown(trend_clarity=trend['trend_score'],
                                       structure_validity=structure['score']),
                        ctx['condition'], ctx['volatility_quality'])

    # Step 5
    near_zone = zone['best_zone'] is not None
    entry = _step_entry_confirmation(candles, trend['direction'], near_zone)
    steps.append(entry['result'])

    # Step 6
    risk = _step_risk_management(trend['direction'], current_price, structure['swings'], current_atr)
    steps.append(risk['result'])
    if not risk['result'].passed:
        return no_trade([risk['result'].reason],
                        ScoreBreakdown(trend_clarity=trend['trend_score'],
                                       structure_validity=structure['score'],
                                       zone_quality=zone['score'],
                                       entry_candle=entry['score']),
                        ctx['condition'], ctx['volatility_quality'])

    # Step 7
    ns = _step_news_sentiment(news, sentiment, trend['direction'])
    steps.append(ns['result'])
    if not ns['result'].passed:
        return no_trade([ns['result'].reason],
                        ScoreBreakdown(trend_clarity=trend['trend_score'],
                                       structure_validity=structure['score'],
                                       zone_quality=zone['score'],
                                       entry_candle=entry['score'],
                                       rrr_bonus=risk['score']),
                        ctx['condition'], ctx['volatility_quality'])

    # Step 8 — Scoring
    scores = ScoreBreakdown(
        trend_clarity=trend['trend_score'],
        structure_validity=structure['score'],
        zone_quality=zone['score'],
        entry_candle=entry['score'],
        sentiment_alignment=ns['sentiment_score'],
        rrr_bonus=risk['score'],
    )
    steps.append(StepResult(8, 'Objective Scoring', True, scores.total,
                            f'Total score: {scores.total}/100'))

    # Step 9 — Grading
    grade = _grade(scores.total)
    steps.append(StepResult(9, 'Grading', grade != 'NO_TRADE', scores.total,
                            f'Grade {grade} (score {scores.total})' if grade != 'NO_TRADE'
                            else f'Score {scores.total} < 70 → NO TRADE'))
    if grade == 'NO_TRADE':
        return no_trade([f'Score {scores.total} below minimum 70'], scores,
                        ctx['condition'], ctx['volatility_quality'])

    # Step 10 — Discipline
    disc = _step_discipline(discipline)
    steps.append(disc['result'])
    if not disc['allowed']:
        return no_trade([disc['result'].reason], scores,
                        ctx['condition'], ctx['volatility_quality'], disc['updated'])

    # Step 11 — AI Validation (placeholder; done externally in Python bot)
    steps.append(StepResult(11, 'AI Validation', True, 0, 'AI validation deferred to external service'))

    # Build reasons
    reasons = []
    ema200 = trend['ema200']
    if trend['direction'] == 'BUY':
        reasons.append(f'Clear trend above EMA 200 ({ema200:.2f})')
    else:
        reasons.append(f'Clear trend below EMA 200 ({ema200:.2f})')
    reasons.append(structure['result'].reason)
    bz = zone['best_zone']
    if bz:
        reasons.append(f'{"Fresh" if bz.get("status") == "fresh" else "Tested"} {bz["type"]} zone')
    if entry['pattern'] != 'none':
        reasons.append(f'{entry["pattern"]} at key level')
    reasons.append(f'RRR 1:{risk["rrr"]:.1f}')

    invalid_if = [
        f'Structure breaks — {"HH/HL" if trend["direction"] == "BUY" else "LH/LL"} violated',
        f'Zone fails — price breaks {bz["type"] if bz else "key"} zone',
        f'EMA 200 breaks — price crosses {ema200:.2f}',
    ]

    return InstitutionalOutput(
        decision='TRADE',
        direction=trend['direction'],
        grade=grade,
        confidence=scores.total,
        entry=round(current_price, 5),
        stop_loss=round(risk['sl'], 5),
        take_profit=[round(risk['tp1'], 5), round(risk['tp2'], 5)],
        reason=reasons,
        invalid_if=invalid_if,
        cooldown=disc['updated'].cooldown_active,
        score_breakdown=scores,
        step_results=steps,
        discipline=disc['updated'],
        market_condition=ctx['condition'],
        volatility_quality=ctx['volatility_quality'],
    )


# ─── Discipline Helpers ──────────────────────────────────────────────

def record_trade_result(
    discipline: DisciplineState,
    won: bool,
    grade: str,
    candle_duration_ms: float,
) -> DisciplineState:
    """Update discipline state after a trade closes."""
    if won:
        return DisciplineState()  # Reset on win

    new_losses = discipline.consecutive_losses + 1
    cooldown = False
    cooldown_until = 0.0
    cooldown_reason = ''
    locked = 0

    if new_losses >= 2:
        locked = COOLDOWN_CANDLES_AFTER_2_LOSSES
        cooldown = True
        cooldown_until = time.time() * 1000 + locked * candle_duration_ms
        cooldown_reason = f'{new_losses} consecutive losses → locked {locked} candles'

    if grade == 'A+':
        locked = COOLDOWN_CANDLES_AFTER_APLUS_LOSS
        cooldown = True
        cooldown_until = time.time() * 1000 + locked * candle_duration_ms
        cooldown_reason = f'A+ trade lost → mandatory cooldown ({locked} candles)'

    return DisciplineState(
        consecutive_losses=new_losses,
        cooldown_active=cooldown,
        cooldown_until=cooldown_until,
        cooldown_reason=cooldown_reason,
        locked_candles_remaining=locked,
        last_loss_grade=grade,
    )


def tick_cooldown(discipline: DisciplineState) -> DisciplineState:
    """Decrement candle lock on each candle close."""
    if not discipline.cooldown_active:
        return discipline
    remaining = max(0, discipline.locked_candles_remaining - 1)
    return DisciplineState(
        consecutive_losses=discipline.consecutive_losses,
        cooldown_active=remaining > 0,
        cooldown_until=discipline.cooldown_until if remaining > 0 else 0,
        cooldown_reason=discipline.cooldown_reason if remaining > 0 else '',
        locked_candles_remaining=remaining,
        last_loss_grade=discipline.last_loss_grade,
    )
