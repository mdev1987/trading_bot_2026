import { JupiterQuotes, SOL_DECIMALS, SOL_MINT } from "./jupiter";
import { effectiveRate, type ExecutionQuote, type QuoteSide } from "./types";

/**
 * Endpoint-independent quote facade. Strategy/paper code depends on
 * this, not on a specific Jupiter path (/swap/v2 vs /ultra).
 * The transport (JupiterQuotes today) is injected.
 */
export interface QuoteTransport {
  quoteBuy(solAmount: number, tokenMint: string, taker?: string): Promise<TransportQuote>;
  quoteSell(tokenAmountSmallest: string | bigint, tokenMint: string, taker?: string): Promise<TransportQuote>;
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

const JupiterTransport = (client: JupiterQuotes): QuoteTransport => ({
  quoteBuy: (sol, mint, taker) => client.quoteBuy(sol, mint, taker),
  quoteSell: (amount, mint, taker) => client.quoteSell(amount, mint, taker),
});

export class PaperQuotes {
  constructor(
    private readonly transport: QuoteTransport,
    private readonly endpoint: string,
  ) {}

  static jupiter(client: JupiterQuotes): PaperQuotes {
    return new PaperQuotes(JupiterTransport(client), "jupiter-swap-v2");
  }

  async quoteBuy(
    solAmount: number,
    tokenMint: string,
    tokenDecimals: number | null,
  ): Promise<ExecutionQuote> {
    // Quote-only: no taker -> no transaction. Nothing signed or sent.
    const q = await this.transport.quoteBuy(solAmount, tokenMint);
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
    const q = await this.transport.quoteSell(tokenAmountSmallest, tokenMint);
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
