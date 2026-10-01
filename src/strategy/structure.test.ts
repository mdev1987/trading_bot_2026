import { describe, expect, test } from "bun:test";
import { analyzeMarket } from "./structure";
import type { Candle } from "../market/ohlcv";

const T0 = Date.parse("2026-01-01T00:00:00Z");
const iso = (i: number): string => new Date(T0 + i * 900_000).toISOString();

function candle(high: number, low: number, i: number): Candle {
  const close = (high + low) / 2;
  return { timeOpen: iso(i), timeClose: iso(i + 1), open: low, high, low, close, volume: 1 };
}

describe("supports/resistances are nearest-first", () => {
  test("most-touched far level does not shadow the nearest level", () => {
    const candles: Candle[] = [];
    // Heavy traffic around 90: many swing touches far from price.
    // Varying amplitudes keep pivots strict (ties never form swings).
    for (let i = 0; i < 30; i++) {
      const wobble = ((i * 37) % 10) / 10;
      candles.push(candle(90 + wobble * 0.3, 89.8 + wobble * 0.1, i));
    }
    // Then a move to ~99-100 with its own confirmed swing pair.
    // Period-3 oscillation => repeated STRICT swing lows near 99.0.
    const seq = [99.0, 99.5, 99.7, 99.0, 99.5, 99.7, 99.0, 99.5, 99.7, 99.0, 99.5, 99.7];
    seq.forEach((low, k) => candles.push(candle(low + 0.8, low, 30 + k)));

    const analysis = analyzeMarket(candles, 100, 2, 0.75);
    expect(analysis.supports.length).toBeGreaterThan(0);
    const nearest = analysis.supports[0]!;
    for (const s of analysis.supports) {
      expect(Math.abs(100 - nearest.price)).toBeLessThanOrEqual(Math.abs(100 - s.price) + 1e-9);
    }
    // The 90-cluster may have more touches, but must not be first.
    expect(nearest.price).toBeGreaterThan(95);
  });
});
