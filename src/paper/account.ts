import type { JupiterPaperQuote } from "../execution/jupiter-paper";

const LAMPORTS_PER_SOL = 1_000_000_000n;

export interface PaperPosition {
  tokenMint: string;
  tokenAmountRaw: bigint;
  /** Token amount at entry. Sells are fractions of THIS, not of the remainder. */
  originalTokenAmountRaw: bigint;
  entryPriceUsd: number;
  originalSizeSol: number;
  remainingSizeSol: number;
  openedAt: string;
}

export interface PaperTrade {
  /** Unique per action; lets the DuckDB ledger reconcile idempotently. */
  eventId: string;
  side: "buy" | "sell";
  time: string;
  requestedSol: number;
  actualSol: number;
  tokenAmountRaw: bigint;
  marketPriceUsd: number;
  router: string | null;
  priceImpactPct: number | null;
  requestId: string;
  reason: string;
}

export interface PaperAccountSnapshot {
  solBalance: number;
  position: PaperPosition | null;
  realizedPnlSol: number;
  trades: PaperTrade[];
}

export class PaperAccount {
  private solBalance: number;
  private position: PaperPosition | null = null;
  private realizedPnlSol = 0;
  private readonly trades: PaperTrade[] = [];

  constructor(startingBalanceSol: number) {
    if (!Number.isFinite(startingBalanceSol) || startingBalanceSol <= 0) {
      throw new Error("startingBalanceSol must be > 0");
    }
    this.solBalance = startingBalanceSol;
  }

  get balanceSol(): number {
    return this.solBalance;
  }

  get openPosition(): PaperPosition | null {
    return this.position;
  }

  get history(): readonly PaperTrade[] {
    return this.trades;
  }

  async buy(
    broker: {
      quote(inputMint: string, outputMint: string, amount: bigint): Promise<JupiterPaperQuote>;
    },
    solMint: string,
    tokenMint: string,
    amountSol: number,
    marketPriceUsd: number,
    reason: string,
  ): Promise<JupiterPaperQuote> {
    if (this.position) {
      throw new Error("Paper account already has an open position");
    }
    if (amountSol > this.solBalance) {
      throw new Error(`Insufficient SOL balance: need ${amountSol}, have ${this.solBalance}`);
    }

    const inputLamports = BigInt(Math.round(amountSol * 1e9));
    const quote = await broker.quote(solMint, tokenMint, inputLamports);

    if (quote.transactionPresent) {
      throw new Error("Safety check failed: paper quote unexpectedly contains a transaction");
    }

    const actualSol = Number(quote.inAmount) / Number(LAMPORTS_PER_SOL);
    this.solBalance -= actualSol;

    this.position = {
      tokenMint,
      tokenAmountRaw: quote.outAmount,
      originalTokenAmountRaw: quote.outAmount,
      entryPriceUsd: marketPriceUsd,
      originalSizeSol: actualSol,
      remainingSizeSol: actualSol,
      openedAt: new Date().toISOString(),
    };

    this.trades.push({
      eventId: crypto.randomUUID(),
      side: "buy",
      time: new Date().toISOString(),
      requestedSol: amountSol,
      actualSol,
      tokenAmountRaw: quote.outAmount,
      marketPriceUsd,
      router: quote.router,
      priceImpactPct: quote.priceImpactPct,
      requestId: quote.requestId,
      reason,
    });

    return quote;
  }

  /** Token amount a sell of this fraction would move. No state change. */
  plannedSellAmount(fractionOfOriginal: number): bigint {
    if (!this.position) {
      throw new Error("Paper account has no open position");
    }
    if (fractionOfOriginal <= 0 || fractionOfOriginal > 1) {
      throw new Error("fractionOfOriginal must be > 0 and <= 1");
    }
    const tokenAmount = this.position.tokenAmountRaw;
    let sellAmountRaw =
      fractionOfOriginal >= 1
        ? tokenAmount
        : (this.position.originalTokenAmountRaw * BigInt(Math.round(fractionOfOriginal * 1_000_000))) /
          1_000_000n;
    if (sellAmountRaw <= 0n) {
      throw new Error("Calculated sell amount is zero");
    }
    if (sellAmountRaw > tokenAmount) {
      sellAmountRaw = tokenAmount;
    }
    return sellAmountRaw;
  }

  async sell(
    broker: {
      quote(inputMint: string, outputMint: string, amount: bigint): Promise<JupiterPaperQuote>;
    },
    solMint: string,
    tokenMint: string,
    fractionOfOriginal: number,
    marketPriceUsd: number,
    reason: string,
    prequoted?: JupiterPaperQuote,
  ): Promise<JupiterPaperQuote> {
    if (!this.position) {
      throw new Error("Paper account has no open position");
    }
    if (this.position.tokenMint !== tokenMint) {
      throw new Error("Token mint does not match position");
    }
    if (fractionOfOriginal <= 0 || fractionOfOriginal > 1) {
      throw new Error("fractionOfOriginal must be > 0 and <= 1");
    }

    const tokenAmount = this.position.tokenAmountRaw;

    // Fraction of the ORIGINAL allocation (Module 9 sellFraction semantics):
    // TP1 25% + TP2 50% of 100 leaves 25, not 37.5. Clamp to what remains
    // so a retried/overlapping sell can never oversell.
    // A pre-fetched quote may fix the amount; still clamp defensively.
    let sellAmountRaw = prequoted
      ? BigInt(prequoted.inAmount)
      : this.plannedSellAmount(fractionOfOriginal);
    if (sellAmountRaw <= 0n) {
      throw new Error("Calculated sell amount is zero");
    }
    if (sellAmountRaw > tokenAmount) {
      sellAmountRaw = tokenAmount;
    }

    const quote = prequoted ?? (await broker.quote(tokenMint, solMint, sellAmountRaw));

    if (quote.transactionPresent) {
      throw new Error("Safety check failed: paper quote unexpectedly contains a transaction");
    }

    const receivedSol = Number(quote.outAmount) / Number(LAMPORTS_PER_SOL);
    this.solBalance += receivedSol;

    const sizeFraction = fractionOfOriginal >= 1 ? 1 : fractionOfOriginal;
    const nominalSoldSol = this.position.originalSizeSol * sizeFraction;

    this.position.remainingSizeSol = Math.max(0, this.position.remainingSizeSol - nominalSoldSol);
    this.position.tokenAmountRaw -= sellAmountRaw;
    this.realizedPnlSol += receivedSol - nominalSoldSol;

    this.trades.push({
      eventId: crypto.randomUUID(),
      side: "sell",
      time: new Date().toISOString(),
      requestedSol: nominalSoldSol,
      actualSol: receivedSol,
      tokenAmountRaw: sellAmountRaw,
      marketPriceUsd,
      router: quote.router,
      priceImpactPct: quote.priceImpactPct,
      requestId: quote.requestId,
      reason,
    });

    if (this.position.remainingSizeSol <= 1e-9 || this.position.tokenAmountRaw <= 0n) {
      this.position = null;
    }

    return quote;
  }

  snapshot(): PaperAccountSnapshot {
    return {
      solBalance: this.solBalance,
      position: this.position ? { ...this.position } : null,
      realizedPnlSol: this.realizedPnlSol,
      trades: [...this.trades],
    };
  }

  /** Restore balance/position/stats/history from persisted JSON state (BigInt-safe). */
  restoreState(s: {
    solBalance: number;
    realizedPnlSol: number;
    position:
      | (Omit<PaperPosition, "tokenAmountRaw" | "originalTokenAmountRaw"> & {
          tokenAmountRaw: string;
          originalTokenAmountRaw?: string;
        })
      | null;
    trades?: (Omit<PaperTrade, "tokenAmountRaw"> & { tokenAmountRaw: string })[];
  }): void {
    if (!Number.isFinite(s.solBalance) || s.solBalance < 0) {
      throw new Error("Invalid persisted balance");
    }
    this.solBalance = s.solBalance;
    this.realizedPnlSol = Number.isFinite(s.realizedPnlSol) ? s.realizedPnlSol : 0;
    this.position = s.position
      ? {
          ...s.position,
          tokenAmountRaw: BigInt(s.position.tokenAmountRaw),
          originalTokenAmountRaw: BigInt(
            s.position.originalTokenAmountRaw ?? s.position.tokenAmountRaw,
          ),
        }
      : null;
    this.trades.length = 0;
    for (const t of s.trades ?? []) {
      this.trades.push({ ...t, tokenAmountRaw: BigInt(t.tokenAmountRaw) });
    }
  }
}
