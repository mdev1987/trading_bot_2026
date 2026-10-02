import { afterEach, describe, expect, test } from "bun:test";
import { DexScreenerPriceTracker, formatScreenerContext, type PriceUpdate } from "./dexscreener";
import type { DexScreenerPair } from "../dexscreener";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubPrice(priceUsd: string): void {
  const pair: DexScreenerPair = {
    chainId: "solana",
    dexId: "raydium",
    pairAddress: "p",
    baseToken: { address: "MINT", name: "T", symbol: "T" },
    quoteToken: { address: "SOL", name: "SOL", symbol: "SOL" },
    priceUsd,
    liquidity: { usd: 100 },
    fdv: 1_000,
    marketCap: 500,
  };
  globalThis.fetch = (async () =>
    new Response(JSON.stringify([pair]), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

describe("DexScreenerPriceTracker", () => {
  test("emits snapshots and computes poll-to-poll change", async () => {
    stubPrice("2.0");
    const tracker = new DexScreenerPriceTracker({ intervalMs: 20, maxTokens: 30 });
    const seen: PriceUpdate[][] = [];
    tracker.start(["MINT"], async (u) => {
      seen.push(u);
      if (seen.length === 1) stubPrice("2.2");
      if (seen.length >= 2) tracker.stop();
    });
    const deadline = Date.now() + 2_000;
    while (tracker.isRunning && Date.now() < deadline) await Bun.sleep(10);
    tracker.stop();
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen[0]![0]!.priceUsd).toBe(2.0);
    expect(seen[0]![0]!.changePct).toBeNull();
    expect(seen[1]![0]!.priceUsd).toBe(2.2);
    expect(seen[1]![0]!.changePct).toBeCloseTo(10, 5);
  });

  test("formats the multi-window context line", () => {
    const line = formatScreenerContext({
      tokenAddress: "MINT",
      priceUsd: 1,
      marketCapUsd: null,
      fdvUsd: null,
      liquidityUsd: null,
      volume24hUsd: null,
      txns24h: null,
      priceChangeM5Pct: 0.5,
      priceChangeH1Pct: -1.25,
      priceChangeH6Pct: null,
      priceChangeH24Pct: 3.456,
      pairAddress: null,
      dexId: "raydium",
      pairCreatedAt: null,
      quoteSymbol: "SOL",
      observedAt: Date.now(),
      previousPriceUsd: null,
      changePct: null,
    });
    expect(line).toBe("MTF m5:+0.50% h1:-1.25% h6:n/a h24:+3.46% (DEX Screener, raydium)");
  });

  test("caps tracked tokens at maxTokens", () => {
    const tracker = new DexScreenerPriceTracker({ maxTokens: 2 });
    tracker.start(["a", "b", "c"], () => {});
    expect(tracker.tracked).toEqual(["a", "b"]);
    tracker.updateTokens(["x"]);
    expect(tracker.tracked).toEqual(["x"]);
    tracker.stop();
  });
});
