import { describe, expect, test } from "bun:test";
import { enrichMarketCaps } from "./enrich-market-cap";
import type { MarketCapProvider } from "../market-cap/provider";
import type { CandidateToken } from "../models";

const base: CandidateToken = {
  network: "solana",
  poolAddress: "pool1",
  dexId: "dex",
  dexName: "Meteora",
  tokenAddress: "mint1",
  tokenName: "T",
  tokenSymbol: "T",
  tokenAddedAt: null,
  priceUsd: 1,
  marketCapUsd: null,
  fdvUsd: 9_000_000,
  totalSupply: null,
  liquidityUsd: null,
  poolCreatedAt: "2026-08-01T00:00:00Z",
  volume24hUsd: 100_000,
  transactions24h: 1_000,
  priceChange5m: null,
  priceChange1h: null,
  priceChange6h: null,
  priceChange24h: null,
};

const provider = (mcap: number | null, fdv: number | null): MarketCapProvider => ({
  getMarketCaps: async () =>
    new Map([
      ["mint1", { marketCapUsd: mcap, fdvUsd: fdv, source: mcap !== null ? "dexscreener" : "unknown", pairAddress: "p", dexId: "raydium", verified: mcap !== null }],
    ]),
});

describe("enrichMarketCaps (mcap only from DEX Screener, never FDV)", () => {
  test("takes real market cap, keeps existing FDV", async () => {
    const out = await enrichMarketCaps(provider(250_000, 250_000_000), [base]);
    expect(out).toHaveLength(1);
    expect(out[0]!.marketCapUsd).toBe(250_000);
    expect(out[0]!.fdvUsd).toBe(9_000_000);
  });

  test("null market cap stays null even with FDV present", async () => {
    const out = await enrichMarketCaps(provider(null, 250_000_000), [base]);
    expect(out).toHaveLength(1);
    expect(out[0]!.marketCapUsd).toBeNull();
    expect(out[0]!.fdvUsd).toBe(9_000_000);
  });

  test("fills missing FDV from DEX Screener without touching mcap rule", async () => {
    const out = await enrichMarketCaps(provider(null, 111), [{ ...base, fdvUsd: null }]);
    expect(out).toHaveLength(1);
    expect(out[0]!.marketCapUsd).toBeNull();
    expect(out[0]!.fdvUsd).toBe(111);
  });

  test("empty input short-circuits", async () => {
    await expect(enrichMarketCaps(provider(1, 1), [])).resolves.toEqual([]);
  });
});
