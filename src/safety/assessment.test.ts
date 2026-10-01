import { describe, expect, test } from "bun:test";
import { assessSafety, gateDecision } from "./assessment";

describe("safety gate follows explicit rules, never a numeric score", () => {
  test("no wired sources means WATCH, not PASS", () => {
    const a = assessSafety();
    expect(a.decision).toBe("watch");
    expect(a.bundles.status).toBe("unknown");
    expect(a.globalFees.status).toBe("unknown");
  });

  test("any single fail rejects", () => {
    const a = assessSafety({
      dev: { status: "pass", value: 0, reason: "dev sold out", source: "test" },
      bundles: { status: "fail", value: 0.9, reason: "90% bundled", source: "test" },
    });
    expect(a.decision).toBe("reject");
    expect(gateDecision(a)).toBe("reject");
  });

  test("all pass passes", () => {
    const a = assessSafety({
      dev: { status: "pass", value: 0, reason: "ok", source: "test" },
      snipers: { status: "pass", value: 0, reason: "ok", source: "test" },
      insiders: { status: "pass", value: 0, reason: "ok", source: "test" },
      bundles: { status: "pass", value: 0, reason: "ok", source: "test" },
      holderConcentration: { status: "pass", value: 0, reason: "ok", source: "test" },
      globalFees: { status: "pass", value: 0, reason: "ok", source: "test" },
      dexPaid: { status: "pass", value: 0, reason: "ok", source: "test" },
      walletClusters: { status: "pass", value: 0, reason: "ok", source: "test" },
      chartBehavior: { status: "pass", value: 0, reason: "ok", source: "test" },
    });
    expect(a.decision).toBe("pass");
  });
});
