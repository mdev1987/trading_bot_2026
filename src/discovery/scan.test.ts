import { describe, expect, test } from "bun:test";
import {
  classifyEligibility,
  diffWatchlist,
  mergePinned,
  rankCandidates,
  type WatchCandidate,
} from "./scan";
import type { CandidateToken } from "../models";

const base: CandidateToken = {
  network: "solana",
  poolAddress: "pool1",
  dexId: "dex",
  dexName: "Meteora",
  tokenAddress: "mint1",
  tokenName: "Stonk",
  tokenSymbol: "STONK",
  tokenAddedAt: null,
  priceUsd: 0.23,
  marketCapUsd: null,
  fdvUsd: 2_000_000,
  totalSupply: 1_000_000_000,
  liquidityUsd: 500_000,
  poolCreatedAt: new Date(Date.now() - 200 * 3_600_000).toISOString(),
  volume24hUsd: 500_000,
  transactions24h: 5_000,
  priceChange5m: 1,
  priceChange1h: 2,
  priceChange6h: 3,
  priceChange24h: 4,
};

const watch = (poolAddress: string, volume24hUsd: number | null): WatchCandidate => ({
  phase: "phase2",
  network: "solana",
  poolAddress,
  tokenAddress: "mint",
  tokenName: "T",
  tokenSymbol: "T",
  dexId: "dex",
  dexName: "Meteora",
  pairAgeHours: 200,
  marketCapUsd: 2_000_000,
  fdvUsd: 2_000_000,
  liquidityUsd: 1_000,
  volume24hUsd,
  transactions24h: 100,
  priceChange5m: null,
  priceChange1h: null,
  priceChange6h: null,
  priceChange24h: null,
  marketCapSource: "reported",
  eligibility: "ready",
  eligibilityReason: "real market cap passes gates",
});

describe("classifyEligibility (FDV never satisfies market cap)", () => {
  test("null market cap is age-compatible but BLOCKED, FDV untouched", () => {
    const hit = classifyEligibility(base);
    expect(hit?.candidate.phase).toBe("phase2");
    expect(hit?.source).toBe("unknown");
    expect(hit?.eligibility).toBe("blocked");
    expect(hit?.reason).toBe("market cap unavailable");
    expect(hit?.candidate.marketCapUsd).toBeNull();
    expect(hit?.candidate.fdvUsd).toBe(2_000_000);
  });

  test("real market cap passing gates is READY", () => {
    const hit = classifyEligibility({ ...base, marketCapUsd: 1_500_000 });
    expect(hit?.candidate.phase).toBe("phase2");
    expect(hit?.source).toBe("reported");
    expect(hit?.eligibility).toBe("ready");
  });

  test("real market cap above the Phase 3 ceiling cannot go READY", () => {
    const ancient = {
      ...base,
      poolCreatedAt: new Date(Date.now() - 2000 * 3_600_000).toISOString(),
    };
    expect(classifyEligibility(ancient)?.eligibility).toBe("blocked");
    expect(classifyEligibility(ancient)?.candidate.phase).toBe("phase3");
    const rich = { ...ancient, marketCapUsd: 50_000_000 };
    // Strict Phase 3 rejects >$10M; only the age-compatible BLOCKED label remains.
    expect(classifyEligibility(rich)?.eligibility).toBe("blocked");
    expect(classifyEligibility(rich)?.candidate.phase).toBe("phase3");
  });

  test("fresh pool rejected entirely", () => {
    const fresh = { ...base, poolCreatedAt: new Date().toISOString() };
    expect(classifyEligibility(fresh)).toBeNull();
  });
});

describe("rankCandidates", () => {
  test("sorts by volume desc and caps at limit", () => {
    const ranked = rankCandidates(
      [watch("a", 10), watch("b", 300), watch("c", null), watch("d", 200)],
      2,
    );
    expect(ranked.map((c) => c.poolAddress)).toEqual(["b", "d"]);
  });
});

describe("diffWatchlist", () => {
  test("returns only unseen pools", () => {
    const next = diffWatchlist([watch("a", 1)], [watch("a", 1), watch("b", 2)]);
    expect(next.map((c) => c.poolAddress)).toEqual(["b"]);
  });
});

describe("mergePinned", () => {
  test("guarantees a pinned pool a slot past the limit", () => {
    const merged = mergePinned([watch("a", 300), watch("b", 200)], [watch("pinned", 10)], 2);
    expect(merged.map((c) => c.poolAddress)).toEqual(["pinned", "a"]);
  });

  test("dedupes a pinned pool already ranked", () => {
    const merged = mergePinned([watch("a", 300)], [watch("a", 300)], 5);
    expect(merged.map((c) => c.poolAddress)).toEqual(["a"]);
  });

  test("empty pinned changes nothing", () => {
    const merged = mergePinned([watch("a", 300)], [], 5);
    expect(merged.map((c) => c.poolAddress)).toEqual(["a"]);
  });
});
