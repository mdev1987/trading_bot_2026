import { describe, expect, test } from "bun:test";
import {
  meanTrueRangePct,
  stopClearsNoise,
} from "./momentum";
import type { Candle } from "../market/ohlcv";

const candle = (close: number, high?: number, low?: number): Candle => ({
  timeOpen: "t",
  timeClose: "t",
  open: close,
  high: high ?? close * 1.01,
  low: low ?? close * 0.99,
  close,
  volume: 1,
});

describe("meanTrueRangePct", () => {
  test("flat 2% ranges average exactly 2%", () => {
    const cs = Array.from({ length: 20 }, () => candle(100, 101, 99));
    expect(meanTrueRangePct(cs, 14)).toBeCloseTo(2, 8);
  });

  test("gaps widen the range beyond high-low", () => {
    const cs = Array.from({ length: 20 }, () => candle(100, 101, 99));
    cs.push(candle(110, 111, 109));
    expect(meanTrueRangePct(cs, 14)!).toBeGreaterThan(2);
  });

  test("needs period+1 candles", () => {
    expect(meanTrueRangePct([candle(1)], 14)).toBeNull();
  });
});

describe("stopClearsNoise", () => {
  test("0.3% stop against 2% ATR is inside noise", () => {
    expect(stopClearsNoise(0.3, 2, 1)).toBe(false);
    expect(stopClearsNoise(2.5, 2, 1)).toBe(true);
    expect(stopClearsNoise(4, 2, 2)).toBe(true);
  });

  test("multiplier off disables; unknown ATR fails closed", () => {
    expect(stopClearsNoise(0.01, 2, 0)).toBe(true);
    expect(stopClearsNoise(5, null, 1)).toBe(false);
  });
});
