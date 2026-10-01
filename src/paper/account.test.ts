import { describe, expect, test } from "bun:test";
import { PaperAccount } from "./account";
import type { JupiterPaperQuote } from "../execution/jupiter-paper";

const LAMPORTS = 1_000_000_000n;

function quoteFor(inAmount: bigint, outAmount: bigint): JupiterPaperQuote {
  return {
    inputMint: "IN",
    outputMint: "OUT",
    inAmount,
    outAmount,
    inUsdValue: null,
    outUsdValue: null,
    priceImpactPct: null,
    feeBps: null,
    signatureFeeLamports: 0,
    prioritizationFeeLamports: 0,
    rentFeeLamports: 0,
    router: "test",
    requestId: "req",
    transactionPresent: false,
  };
}

/** Fake broker: buy mints fixed tokens per SOL; sell returns proportional lamports. */
function fakeBroker(tokensPerSol: bigint, lamportsPerTokenUnit: number) {
  return {
    async quote(inputMint: string, _outputMint: string, amount: bigint): Promise<JupiterPaperQuote> {
      if (inputMint === "SOL") {
        const sol = Number(amount) / 1e9;
        return quoteFor(amount, BigInt(Math.round(sol * Number(tokensPerSol))));
      }
      return quoteFor(amount, BigInt(Math.round(Number(amount) * lamportsPerTokenUnit)));
    },
  };
}

const SOL = "SOL";
const TOK = "TOK";

describe("PaperAccount fractions are of the ORIGINAL allocation", () => {
  test("TP1 25% + TP2 50% leaves 25%, full exit clears", async () => {
    const account = new PaperAccount(1.0);
    const broker = fakeBroker(10_000n, 100_000); // 0.1 SOL -> 1000 tokens; 1 token -> 100k lamports
    await account.buy(broker, SOL, TOK, 0.1, 0.25, "test");

    expect(account.openPosition?.tokenAmountRaw).toBe(1000n);
    expect(account.plannedSellAmount(0.25)).toBe(250n);

    await account.sell(broker, SOL, TOK, 0.25, 0.3, "tp1");
    expect(account.openPosition?.tokenAmountRaw).toBe(750n);

    // 50% of ORIGINAL = 500, not 50% of remaining (375).
    expect(account.plannedSellAmount(0.5)).toBe(500n);
    await account.sell(broker, SOL, TOK, 0.5, 0.35, "tp2");
    expect(account.openPosition?.tokenAmountRaw).toBe(250n);

    await account.sell(broker, SOL, TOK, 1, 0.4, "exit");
    expect(account.openPosition).toBeNull();
  });

  test("oversell is clamped to remaining balance", async () => {
    const account = new PaperAccount(1.0);
    const broker = fakeBroker(10_000n, 100_000);
    await account.buy(broker, SOL, TOK, 0.1, 0.25, "test");
    await account.sell(broker, SOL, TOK, 0.25, 0.3, "tp1");
    // Stale 50%-of-original (500) exceeds remaining 750? No: 500 < 750 fine.
    // Force oversell: sell 90% of original (900) > remaining 750 -> clamped.
    await account.sell(broker, SOL, TOK, 0.9, 0.35, "oversell");
    expect(account.openPosition).toBeNull();
  });

  test("every trade carries a unique eventId", async () => {
    const account = new PaperAccount(1.0);
    const broker = fakeBroker(10_000n, 100_000);
    await account.buy(broker, SOL, TOK, 0.1, 0.25, "test");
    await account.sell(broker, SOL, TOK, 1, 0.3, "exit");
    const ids = account.history.map((t) => t.eventId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("restoreState round-trips balance, position and history", async () => {
    const account = new PaperAccount(1.0);
    const broker = fakeBroker(10_000n, 100_000);
    await account.buy(broker, SOL, TOK, 0.1, 0.25, "test");
    const snap = account.snapshot();

    const revived = new PaperAccount(999);
    revived.restoreState({
      solBalance: snap.solBalance,
      realizedPnlSol: snap.realizedPnlSol,
      position: snap.position
        ? {
            ...snap.position,
            tokenAmountRaw: snap.position.tokenAmountRaw.toString(),
            originalTokenAmountRaw: snap.position.originalTokenAmountRaw.toString(),
          }
        : null,
      trades: snap.trades.map((t) => ({ ...t, tokenAmountRaw: t.tokenAmountRaw.toString() })),
    });
    expect(revived.balanceSol).toBe(snap.solBalance);
    expect(revived.openPosition?.tokenAmountRaw).toBe(1000n);
    expect(revived.openPosition?.originalTokenAmountRaw).toBe(1000n);
    expect(revived.history.length).toBe(1);
    expect(LAMPORTS).toBe(1_000_000_000n);
  });
});
