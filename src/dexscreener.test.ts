import { afterEach, describe, expect, test } from "bun:test";
import { DexScreenerData, type DexScreenerPair } from "./dexscreener";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(pairs: DexScreenerPair[] | null, status = 200): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(pairs), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

const solPair = (over: Partial<DexScreenerPair> = {}): DexScreenerPair => ({
  chainId: "solana",
  dexId: "raydium",
  pairAddress: "pair-sol",
  baseToken: { address: "MINT", name: "T", symbol: "T" },
  quoteToken: { address: "So11111111111111111111111111111111111111112", name: "SOL", symbol: "SOL" },
  priceUsd: "2.5",
  liquidity: { usd: 100_000 },
  fdv: 5_000_000,
  marketCap: 1_500_000,
  ...over,
});

describe("DexScreenerData pair selection", () => {
  test("prefers SOL quote over USDC and reports real market cap", async () => {
    stubFetch([
      { ...solPair(), pairAddress: "pair-usdc", dexId: "orca", quoteToken: { address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", name: "USD Coin", symbol: "USDC" }, liquidity: { usd: 999_999 }, marketCap: 9_999_999 },
      solPair(),
    ]);
    const snaps = await new DexScreenerData().getTokenSnapshots(["MINT"]);
    const s = snaps.get("MINT")!;
    expect(s.pairAddress).toBe("pair-sol");
    expect(s.priceUsd).toBe(2.5);
    expect(s.marketCapUsd).toBe(1_500_000);
    expect(s.fdvUsd).toBe(5_000_000);
  });

  test("breaks same-quote ties by liquidity", async () => {
    stubFetch([solPair({ pairAddress: "thin", liquidity: { usd: 10 } }), solPair({ pairAddress: "deep", liquidity: { usd: 500 } })]);
    const snaps = await new DexScreenerData().getTokenSnapshots(["MINT"]);
    expect(snaps.get("MINT")!.pairAddress).toBe("deep");
  });

  test("derives quote-side token price from base price", async () => {
    stubFetch([
      {
        chainId: "solana",
        dexId: "raydium",
        pairAddress: "p",
        baseToken: { address: "OTHER", name: "O", symbol: "O" },
        quoteToken: { address: "MINT", name: "T", symbol: "T" },
        priceNative: "4",
        priceUsd: "8",
        liquidity: { usd: 50 },
        fdv: null,
        marketCap: null,
      },
    ]);
    const snaps = await new DexScreenerData().getTokenSnapshots(["MINT"]);
    const s = snaps.get("MINT")!;
    expect(s.priceUsd).toBe(2);
    expect(s.marketCapUsd).toBeNull();
  });

  test("unknown token yields an empty snapshot, never an FDV fill", async () => {
    stubFetch([]);
    const snaps = await new DexScreenerData().getTokenSnapshots(["MINT"]);
    const s = snaps.get("MINT")!;
    expect(s.priceUsd).toBeNull();
    expect(s.marketCapUsd).toBeNull();
    expect(s.fdvUsd).toBeNull();
  });

  test("HTTP failure yields empty snapshots", async () => {
    stubFetch(null, 429);
    const snaps = await new DexScreenerData().getTokenSnapshots(["MINT"]);
    expect(snaps.get("MINT")!.marketCapUsd).toBeNull();
  });

  test("maps volume, txns and multi-window changes", async () => {
    stubFetch([
      {
        ...solPair(),
        volume: { h24: 77_000 },
        txns: { h24: { buys: 600, sells: 400 } },
        priceChange: { m5: 0.5, h1: 1.5, h6: 2.5, h24: -3.5 },
      },
    ]);
    const s = (await new DexScreenerData().getTokenSnapshots(["MINT"])).get("MINT")!;
    expect(s.volume24hUsd).toBe(77_000);
    expect(s.txns24h).toBe(1_000);
    expect(s.priceChangeM5Pct).toBe(0.5);
    expect(s.priceChangeH24Pct).toBe(-3.5);
  });
});
