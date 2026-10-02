import { describe, expect, test } from "bun:test";
import { detectSetup } from "./setup";
import type { StructureAnalysis } from "./structure";

const swing = (price: number, type: "high" | "low") => ({ index: 0, time: "t", price, type });

function sidewaysAnalysis(price: number): StructureAnalysis {
  return {
    market: {
      trend: "sideways",
      swingHighs: [swing(9, "high"), swing(10, "high")],
      swingLows: [swing(5, "low"), swing(4.8, "low")],
      lastHigh: swing(10, "high"),
      previousHigh: swing(9, "high"),
      lastLow: swing(4.8, "low"),
      previousLow: swing(5, "low"),
    },
    currentPrice: price,
    levels: [],
    supports: [{ price: 5, touches: 3, firstIndex: 0, lastIndex: 10 }],
    resistances: [{ price: 10, touches: 3, firstIndex: 1, lastIndex: 11 }],
  };
}

describe("range-break setup (sideways markets)", () => {
  test("close above resistance + breakout confirms", () => {
    const s = detectSetup(sidewaysAnalysis(10.05), { breakoutPct: 0.25 });
    expect(s.type).toBe("range-break");
    expect(s.status).toBe("confirmed");
    expect(s.triggerPrice).toBeCloseTo(10.025, 8);
    expect(s.invalidationPrice).toBe(5);
    expect(s.reason).toContain("range-high-broken");
  });

  test("below trigger stays watch", () => {
    const s = detectSetup(sidewaysAnalysis(10.01), { breakoutPct: 0.25 });
    expect(s.type).toBe("range-break");
    expect(s.status).toBe("watch");
    expect(s.reason).toContain("waiting-for-range-break");
  });

  test("no resistance level means no setup", () => {
    const a = sidewaysAnalysis(9);
    const s = detectSetup({ ...a, resistances: [] });
    expect(s.status).toBe("none");
    expect(s.reason).toContain("no-long-setup");
  });

  test("stop must sit below price (no inverted range)", () => {
    const a = sidewaysAnalysis(4);
    const s = detectSetup({
      ...a,
      supports: [{ price: 5, touches: 2, firstIndex: 0, lastIndex: 10 }],
    });
    expect(s.status).toBe("none");
  });

  test("reversal still wins over range-break when both match", () => {
    const a: StructureAnalysis = {
      market: {
        trend: "downtrend",
        swingHighs: [swing(10, "high"), swing(9, "high")],
        swingLows: [swing(4, "low"), swing(5, "low")],
        lastHigh: swing(9, "high"),
        previousHigh: swing(10, "high"),
        lastLow: swing(5, "low"),
        previousLow: swing(4, "low"),
      },
      currentPrice: 9.05,
      levels: [],
      supports: [{ price: 5, touches: 2, firstIndex: 0, lastIndex: 10 }],
      resistances: [{ price: 9, touches: 4, firstIndex: 1, lastIndex: 11 }],
    };
    const s = detectSetup(a, { breakoutPct: 0.25 });
    expect(s.type).toBe("bullish-reversal");
  });
});
