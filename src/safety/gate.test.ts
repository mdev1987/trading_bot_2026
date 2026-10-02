import { describe, expect, test } from "bun:test";
import { assessSafety, type SafetyInput } from "./gate";

const allNull: SafetyInput = {
  tokenAddress: "TEST",
  globalFees: null,
  top10HolderConcentrationPct: null,
  largestHolderPct: null,
  insiderPct: null,
  bundledPct: null,
  devPct: null,
  mintAuthorityRevoked: null,
  freezeAuthorityRevoked: null,
  sniperPct: null,
  walletClusterDetected: null,
  dexPaid: null,
  suspiciousChart: null,
};

describe("safety gate (course thresholds, never a score)", () => {
  test("unknown data cannot produce a BUY signal (WATCH, not PASS)", () => {
    expect(assessSafety(allNull).decision).toBe("watch");
  });

  test("fully clean inputs PASS", () => {
    const a = assessSafety({
      ...allNull,
      globalFees: 100,
      top10HolderConcentrationPct: 21,
      largestHolderPct: 4,
      insiderPct: 20,
      bundledPct: 0,
      devPct: 2,
      mintAuthorityRevoked: true,
      freezeAuthorityRevoked: true,
      sniperPct: 1,
      walletClusterDetected: false,
      dexPaid: true,
      suspiciousChart: false,
    });
    expect(a.decision).toBe("pass");
    expect(a.reasons).toEqual([]);
  });

  test("revoked authorities pass dev; active mint authority warns", () => {
    const revoked = assessSafety({ ...allNull, mintAuthorityRevoked: true, freezeAuthorityRevoked: true, devPct: 2 });
    expect(revoked.dev.status).toBe("pass");
    const active = assessSafety({ ...allNull, mintAuthorityRevoked: false, freezeAuthorityRevoked: true, devPct: 2 });
    expect(active.dev.status).toBe("warn");
    expect(active.decision).toBe("watch");
  });

  test("suspicious chart FAIL rejects even when everything else passes", () => {
    const a = assessSafety({
      ...allNull,
      globalFees: 100,
      top10HolderConcentrationPct: 21,
      largestHolderPct: 4,
      insiderPct: 20,
      bundledPct: 0,
      devPct: 2,
      sniperPct: 1,
      walletClusterDetected: false,
      dexPaid: true,
      suspiciousChart: true,
    });
    expect(a.decision).toBe("reject");
    expect(a.chartBehavior.status).toBe("fail");
  });

  test("course warning levels warn without rejecting", () => {
    const a = assessSafety({
      ...allNull,
      top10HolderConcentrationPct: 42,
      largestHolderPct: 15,
      insiderPct: 47,
      bundledPct: 25,
    });
    expect(a.decision).toBe("watch");
    expect(a.top10HolderConcentration.status).toBe("warn");
    expect(a.insiders.status).toBe("warn");
    expect(a.bundles.status).toBe("warn");
  });
});
