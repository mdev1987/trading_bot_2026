import { describe, expect, test } from "bun:test";
import {
  createPosition,
  managePosition,
  type Position,
  type MonitorBar,
} from "./position";
import type { StructureAnalysis, SwingPoint } from "./structure";

const T0 = Date.parse("2026-01-01T00:00:00Z");
const iso = (mins: number): string => new Date(T0 + mins * 60_000).toISOString();
const swing = (price: number, index: number, type: "high" | "low", mins: number): SwingPoint => ({
  index,
  time: iso(mins),
  price,
  type,
});

function analysis(opts: {
  lastLow: number;
  prevLow: number;
  lastHigh: number;
  prevHigh: number;
  price: number;
}): StructureAnalysis {
  const prevHigh = swing(opts.prevHigh, 1, "high", 10);
  const lastHigh = swing(opts.lastHigh, 3, "high", 30);
  const prevLow = swing(opts.prevLow, 2, "low", 20);
  const lastLow = swing(opts.lastLow, 4, "low", 40);
  return {
    market: {
      trend: "uptrend",
      swingHighs: [prevHigh, lastHigh],
      swingLows: [prevLow, lastLow],
      lastHigh,
      previousHigh: prevHigh,
      lastLow,
      previousLow: prevLow,
    },
    currentPrice: opts.price,
    levels: [],
    supports: [],
    resistances: [],
  };
}

const base = (over: Partial<Position> = {}): Position =>
  createPosition({
    tokenAddress: "T",
    poolAddress: "P",
    entryPrice: 0.26,
    positionSol: 0.1,
    stopPrice: 0.24,
    targets: [{ id: "tp1", triggerPrice: 0.32, sellFraction: 0.25 }],
    openedAt: iso(0),
    ...over,
  });

const bar = (price: number, high?: number, low?: number): MonitorBar => ({
  price,
  high: high ?? price,
  low: low ?? price,
});

describe("managePosition is pure", () => {
  test("frozen input is not mutated", () => {
    const pos = Object.freeze(base());
    const a = analysis({ lastLow: 0.25, prevLow: 0.24, lastHigh: 0.27, prevHigh: 0.26, price: 0.28 });
    const update = managePosition(pos, bar(0.28), a);
    expect(pos.remainingSizeSol).toBe(0.1);
    expect(pos.status).toBe("open");
    expect(update.position).not.toBe(pos);
  });
});

describe("intrabar handling", () => {
  test("wick below stop exits even when close is above stop", () => {
    const pos = base();
    const a = analysis({ lastLow: 0.25, prevLow: 0.24, lastHigh: 0.27, prevHigh: 0.26, price: 0.28 });
    // Stop is 0.24; low wicks to 0.23 but close holds 0.28.
    const update = managePosition(pos, bar(0.28, 0.29, 0.23), a);
    expect(update.position.status).toBe("closed");
    expect(update.actions.at(-1)?.reason).toBe("stop-loss-hit");
  });

  test("wick through target fills at the target (limit assumption)", () => {
    const pos = base();
    const a = analysis({ lastLow: 0.25, prevLow: 0.24, lastHigh: 0.33, prevHigh: 0.32, price: 0.3 });
    // TP trigger 0.32; high touches 0.325 but close falls back to 0.30.
    const update = managePosition(pos, bar(0.3, 0.325, 0.29), a);
    const tp = update.actions.find((x) => x.type === "partial-take-profit");
    expect(tp?.price).toBe(0.32);
    expect(update.position.status).toBe("partially-closed");
  });

  test("bar touching both stop and target exits at stop first", () => {
    const pos = base();
    const a = analysis({ lastLow: 0.25, prevLow: 0.24, lastHigh: 0.33, prevHigh: 0.32, price: 0.3 });
    const update = managePosition(pos, bar(0.3, 0.35, 0.23), a);
    expect(update.position.status).toBe("closed");
    expect(update.actions).toHaveLength(1);
    expect(update.actions[0]?.reason).toBe("stop-loss-hit");
  });
});

describe("structural failure", () => {
  test("failure exits without a contradictory stop-move", () => {
    const pos = base({ targets: [] });
    const a = analysis({ lastLow: 0.245, prevLow: 0.25, lastHigh: 0.26, prevHigh: 0.27, price: 0.25 });
    const update = managePosition(pos, bar(0.25), a);
    expect(update.actions.some((x) => x.type === "stop-moved")).toBe(false);
    expect(update.actions.at(-1)?.reason).toBe("market-structure-failure");
  });

  test("pre-entry swings cannot trigger failure", () => {
    const pos = base({ targets: [], openedAt: iso(100) });
    const a = analysis({ lastLow: 0.245, prevLow: 0.25, lastHigh: 0.26, prevHigh: 0.27, price: 0.25 });
    const update = managePosition(pos, bar(0.25), a);
    expect(update.actions.some((x) => x.type === "full-exit")).toBe(false);
  });

  test("stop never moves downward", () => {
    const pos = base();
    const a = analysis({ lastLow: 0.23, prevLow: 0.22, lastHigh: 0.27, prevHigh: 0.26, price: 0.28 });
    const update = managePosition(pos, bar(0.28), a);
    expect(update.position.currentStopPrice).toBe(0.24);
  });
});
