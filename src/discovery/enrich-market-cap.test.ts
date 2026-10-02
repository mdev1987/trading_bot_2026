import { describe, expect, test } from "bun:test";
import { enrichFromScreener } from "./enrich-market-cap";
import type { MarketCapProvider } from "../market-cap/provider";
import { DexScreenerData } from "../dexscreener";
import type { CandidateToken } from "../models";

const realFetch = globalThis.fetch;

const base: CandidateToken = {
  network: "solana",
  poolAddress: "pool1",
  dexId: "dex",
  dexName: "Meteora",
  tokenAddress: "mint1",
  tokenName: "T",
  tokenSymbol: "T",
  tokenAddedAt: null,
  priceUsd: null,
  marketCapUsd: null,
  fdvUsd: null,
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

const provider: MarketCapProvider = {
  getMarketCaps: async () =>
    new Map([
      ["mint1", { marketCapUsd: 250_000, fdvUsd: 9_000_000, source: "dexscreener", pairAddress: "p", dexId: "raydium", verified: true }],
    ]),
};

function stubSnapshots(pairs: unknown[]): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(pairs), { status: 200 })) as unknown as typeof fetch;
}

const snapPair = {
  chainId: "solana",
  dexId: "raydium",
  pairAddress: "p",
  baseToken: { address: "mint1", name: "T", symbol: "T" },
  quoteToken: { address: "SOL", name: "SOL", symbol: "SOL" },
  priceUsd: "1.5",
  liquidity: { usd: 42_000 },
  fdv: 9_000_000,
  marketCap: 250_000,
  volume: { h24: 77_000 },
  txns: { h24: { buys: 600, sells: 400 } },
  priceChange: { m5: 0.5, h1: 1.5, h6: 2.5, h24: 3.5 },
};

describe("enrichFromScreener (one batch fills every gap, mcap never FDV)", () => {
  test("real mcap + gap fills, DexPaprika values win", async () => {
    stubSnapshots([snapPair]);
    try {
      const [c] = await enrichFromScreener(provider, new DexScreenerData(), [{ ...base }]);
      expect(c!.marketCapUsd).toBe(250_000);
      expect(c!.fdvUsd).toBe(9_000_000);
      expect(c!.priceUsd).toBe(1.5);
      expect(c!.liquidityUsd).toBe(42_000);
      expect(c!.transactions24h).toBe(1_000);
      expect(c!.volume24hUsd).toBe(100_000);
      expect(c!.priceChange24h).toBe(3.5);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("null mcap stays null even with FDV present", async () => {
    stubSnapshots([]);
    const emptyProvider: MarketCapProvider = { getMarketCaps: async () => new Map() };
    try {
      const [c] = await enrichFromScreener(emptyProvider, new DexScreenerData(), [{ ...base, fdvUsd: null }]);
      expect(c!.marketCapUsd).toBeNull();
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("empty input short-circuits without network", async () => {
    let called = false;
    const counting: MarketCapProvider = {
      getMarketCaps: async () => {
        called = true;
        return new Map();
      },
    };
    await enrichFromScreener(counting, new DexScreenerData(), []);
    expect(called).toBe(false);
  });
});
