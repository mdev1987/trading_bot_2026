import type { Candle } from "../market/ohlcv";

/**
 * Mean true-range as a fraction of price over the last `period`
 * candles (Wilder-style TR with previous close, simple mean).
 * Structural stops tighter than ~1× this sit inside normal noise —
 * trade #4 died to a 0.3% wiggle against a ~2–4% hourly range.
 */
export function meanTrueRangePct(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 1 || period <= 0) return null;
  let sum = 0;
  let n = 0;
  const window = candles.slice(-period - 1);
  for (let i = 1; i < window.length; i++) {
    const c = window[i]!;
    const prev = window[i - 1]!;
    if (![c.high, c.low, c.close, prev.close].every(Number.isFinite) || c.close <= 0) return null;
    sum += Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close)) / c.close;
    n += 1;
  }
  return n > 0 ? (sum / n) * 100 : null;
}

/**
 * Structural stop must clear the noise floor: stopDistancePct >=
 * atrPct × multiplier. A tighter stop is a guaranteed wiggle-out,
 * not risk control — skip the trade instead of sizing into it.
 */
export function stopClearsNoise(stopDistancePct: number, atrPct: number | null, multiplier: number): boolean {
  if (!(multiplier > 0)) return true;
  if (atrPct === null || !Number.isFinite(atrPct) || atrPct <= 0) return false;
  return stopDistancePct >= atrPct * multiplier;
}
