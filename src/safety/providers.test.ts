import { afterEach, describe, expect, test } from "bun:test";
import {
  fetchSafetyInput,
  getDexPaidStatus,
  getHolderConcentration,
  getMintAuthorities,
  getOwnerHoldingsPct,
} from "./providers";
import { entryPolicy } from "./policy";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubRpc(largest: unknown, supply: unknown): void {
  globalThis.fetch = (async (_url: unknown, init: unknown) => {
    const body = String((init as { body?: unknown }).body ?? "");
    const payload = body.includes("getTokenSupply") ? supply : largest;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: payload }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

describe("getHolderConcentration (Shyft/RPC JSON-RPC)", () => {
  test("computes top-10 and largest percentages", async () => {
    stubRpc(
      { value: [{ uiAmount: 30 }, { uiAmount: 20 }, { uiAmount: 10 }] },
      { value: { uiAmountString: "100" } },
    );
    const h = await getHolderConcentration("https://rpc.test", "MINT");
    expect(h.top10Pct).toBeCloseTo(60, 8);
    expect(h.largestPct).toBeCloseTo(30, 8);
  });

  test("RPC failure yields nulls, never throws", async () => {
    globalThis.fetch = (() => Promise.reject(new Error("down"))) as unknown as typeof fetch;
    const h = await getHolderConcentration("https://rpc.test", "MINT");
    expect(h).toEqual({ top10Pct: null, largestPct: null });
  });

  test("zero supply yields nulls", async () => {
    stubRpc({ value: [{ uiAmount: 5 }] }, { value: { uiAmountString: "0" } });
    const h = await getHolderConcentration("https://rpc.test", "MINT");
    expect(h).toEqual({ top10Pct: null, largestPct: null });
  });
});

describe("getDexPaidStatus (DEX Screener orders)", () => {
  test("listed orders mean paid", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ orders: [{ type: "tokenProfile" }], boosts: [] }), { status: 200 })) as unknown as typeof fetch;
    await expect(getDexPaidStatus("MINT")).resolves.toBe(true);
  });

  test("bare array shape also accepted", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify([{ type: "tokenProfile" }]), { status: 200 })) as unknown as typeof fetch;
    await expect(getDexPaidStatus("MINT")).resolves.toBe(true);
  });

  test("empty orders mean not paid", async () => {
    globalThis.fetch = (async () => new Response("[]", { status: 200 })) as unknown as typeof fetch;
    await expect(getDexPaidStatus("MINT")).resolves.toBe(false);
  });

  test("HTTP failure yields null", async () => {
    globalThis.fetch = (async () => new Response("x", { status: 429 })) as unknown as typeof fetch;
    await expect(getDexPaidStatus("MINT")).resolves.toBeNull();
  });
});

describe("getMintAuthorities (Helius DAS getAsset)", () => {
  test("revoked authorities come back null with known=true", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: {
            token_info: { mint_authority: null, freeze_authority: null },
            creators: [{ address: "DEV" }],
          },
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const a = await getMintAuthorities("https://rpc.test", "MINT");
    expect(a).toEqual({ mintAuthority: null, freezeAuthority: null, creatorAddress: "DEV", known: true });
  });

  test("active authority preserved; failure means unknown, never revoked", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { token_info: { mint_authority: "MINTAUTH", freeze_authority: null }, creators: [] },
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const a = await getMintAuthorities("https://rpc.test", "MINT");
    expect(a.mintAuthority).toBe("MINTAUTH");
    expect(a.freezeAuthority).toBeNull();
    expect(a.known).toBe(true);

    globalThis.fetch = (() => Promise.reject(new Error("down"))) as unknown as typeof fetch;
    const failed = await getMintAuthorities("https://rpc.test", "MINT");
    expect(failed.known).toBe(false);
  });
});

describe("getOwnerHoldingsPct", () => {
  test("sums owner accounts over supply", async () => {
    globalThis.fetch = (async (_url: unknown, init: unknown) => {
      const body = String((init as { body?: unknown }).body ?? "");
      const payload = body.includes("getTokenSupply")
        ? { value: { uiAmountString: "200" } }
        : {
            value: [
              { account: { data: { parsed: { info: { tokenAmount: { uiAmount: 30 } } } } } },
              { account: { data: { parsed: { info: { tokenAmount: { uiAmount: 10 } } } } } },
            ],
          };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: payload }), { status: 200 });
    }) as unknown as typeof fetch;
    await expect(getOwnerHoldingsPct("https://rpc.test", "DEV", "MINT")).resolves.toBeCloseTo(20, 8);
  });
});

describe("fetchSafetyInput", () => {
  test("fills holders + dexPaid, leaves the rest unknown", async () => {
    stubRpc(
      { value: [{ uiAmount: 40 }, { uiAmount: 10 }] },
      { value: { uiAmountString: "100" } },
    );
    const withOrders = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init: unknown) => {
      if (String(_url).includes("dexscreener")) {
        return new Response("[]", { status: 200 });
      }
      return (withOrders as typeof fetch)(_url as string, init as RequestInit);
    }) as unknown as typeof fetch;
    const input = await fetchSafetyInput("https://rpc.test", "MINT");
    expect(input.top10HolderConcentrationPct).toBeCloseTo(50, 8);
    expect(input.largestHolderPct).toBeCloseTo(40, 8);
    expect(input.dexPaid).toBe(false);
    expect(input.insiderPct).toBeNull();
    expect(input.bundledPct).toBeNull();
  });
});

describe("entryPolicy (paper-only)", () => {
  test("reject never trades", () => {
    expect(entryPolicy("reject")).toEqual({ allowed: false, sizeFraction: 0, label: expect.any(String) });
  });

  test("watch trades paper at half size", () => {
    const p = entryPolicy("watch");
    expect(p.allowed).toBe(true);
    expect(p.sizeFraction).toBe(0.5);
  });

  test("pass trades full size", () => {
    const p = entryPolicy("pass");
    expect(p.allowed).toBe(true);
    expect(p.sizeFraction).toBe(1);
  });
});
