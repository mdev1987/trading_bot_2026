import type { JupiterPaperBroker, JupiterPaperQuote } from "./jupiter-paper";
import { SOL_MINT, SOL_DECIMALS } from "./jupiter-mints";
import { effectiveRate, type ExecutionQuote, type QuoteSide } from "./types";

/**
 * Endpoint-independent quote facade. Strategy/paper code depends on
 * this, not on a specific Jupiter path (/swap/v2 vs /ultra).
 * The transport (JupiterPaperBroker today) is injected.
 */
export interface QuoteTransport {
  quote(inputMint: string, outputMint: string, amount: bigint): Promise<JupiterPaperQuote>;
}

export interface TransportQuote {
  side: QuoteSide;
  inputMint: string;
  outputMint: string;
  inputAmount: bigint;
  outputAmount: bigint;
  priceImpactPct: number | null;
  router: string | null;
  requestId: string;
}

const toTransportQuote = (side: QuoteSide, q: JupiterPaperQuote): TransportQuote => ({
  side,
  inputMint: q.inputMint,
  outputMint: q.outputMint,
  inputAmount: q.inAmount,
  outputAmount: q.outAmount,
  priceImpactPct: q.priceImpactPct,
  router: q.router,
  requestId: q.requestId,
});

export class PaperQuotes {
  constructor(
    private readonly transport: QuoteTransport,
    private readonly endpoint: string,
  ) {}

  static jupiter(broker: JupiterPaperBroker): PaperQuotes {
    return new PaperQuotes(
      {
        quote: (inputMint, outputMint, amount) => broker.quote(inputMint, outputMint, amount),
      },
      "jupiter-swap-v2",
    );
  }

  private static lamports(sol: number): bigint {
    if (!Number.isFinite(sol) || sol <= 0) throw new Error("sol must be > 0");
    return BigInt(Math.round(sol * 10 ** SOL_DECIMALS));
  }

  async quoteBuy(
    solAmount: number,
    tokenMint: string,
    tokenDecimals: number | null,
  ): Promise<ExecutionQuote> {
    // Quote-only: broker never supplies taker -> no transaction. Nothing signed or sent.
    const q = toTransportQuote(
      "buy",
      await this.transport.quote(SOL_MINT, tokenMint, PaperQuotes.lamports(solAmount)),
    );
    return {
      side: "buy",
      endpoint: this.endpoint,
      inputMint: SOL_MINT,
      outputMint: tokenMint,
      inputAmount: q.inputAmount,
      outputAmount: q.outputAmount,
      inputDecimals: SOL_DECIMALS,
      outputDecimals: tokenDecimals,
      effectiveRate: effectiveRate(q.inputAmount, SOL_DECIMALS, q.outputAmount, tokenDecimals),
      priceImpactPct: q.priceImpactPct,
      router: q.router,
      requestId: q.requestId,
    };
  }

  async quoteSell(
    tokenAmountSmallest: bigint,
    tokenMint: string,
    tokenDecimals: number | null,
  ): Promise<ExecutionQuote> {
    const q = toTransportQuote(
      "sell",
      await this.transport.quote(tokenMint, SOL_MINT, tokenAmountSmallest),
    );
    return {
      side: "sell",
      endpoint: this.endpoint,
      inputMint: tokenMint,
      outputMint: SOL_MINT,
      inputAmount: q.inputAmount,
      outputAmount: q.outputAmount,
      inputDecimals: tokenDecimals,
      outputDecimals: SOL_DECIMALS,
      effectiveRate: effectiveRate(q.inputAmount, tokenDecimals, q.outputAmount, SOL_DECIMALS),
      priceImpactPct: q.priceImpactPct,
      router: q.router,
      requestId: q.requestId,
    };
  }
}
