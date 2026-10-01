export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const SOL_DECIMALS = 9;

const JUPITER_BASE_URL = "https://api.jup.ag/swap/v2";

export type ExecutionMode = "historical" | "paper-jupiter" | "live";

export interface JupiterOrderParams {
  inputMint: string;
  outputMint: string;
  /** Amount in the smallest unit of the input token, as a decimal string. */
  amount: string;
  /** Omit for quote-only (no transaction). Required to receive an assembled transaction. */
  taker?: string;
}

export interface JupiterOrderResponse {
  mode: string;
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  inUsdValue?: number | null;
  outUsdValue?: number | null;
  /** Price impact in percentage points (e.g. -0.1 = -0.1%). */
  priceImpact?: number | null;
  swapUsdValue?: number | null;
  router?: string | null;
  requestId?: string | null;
  transaction?: string | null;
  feeBps?: number | null;
  platformFee?: unknown;
  errorCode?: number | null;
  errorMessage?: string | null;
  error?: string | null;
}

export interface JupiterExecutionQuote {
  side: "buy" | "sell";
  inputMint: string;
  outputMint: string;
  inputAmount: bigint;
  outputAmount: bigint;
  /** Tokens per 1 SOL for buys; SOL per token-unit is derivable. Null when not computable. */
  outputPerInput: number | null;
  priceImpactPct: number | null;
  router: string | null;
  requestId: string;
  feeBps: number | null;
  hasTransaction: boolean;
  raw: JupiterOrderResponse;
}

export function solToLamports(sol: number): string {
  if (!Number.isFinite(sol) || sol <= 0) {
    throw new Error("sol must be > 0");
  }
  return String(Math.round(sol * 10 ** SOL_DECIMALS));
}

export class JupiterQuotes {
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;

  constructor(apiKey?: string, baseUrl: string = JUPITER_BASE_URL) {
    this.apiKey = apiKey || undefined;
    this.baseUrl = baseUrl;
  }

  async getOrder(params: JupiterOrderParams): Promise<JupiterOrderResponse> {
    const query = new URLSearchParams({
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: params.amount,
    });
    if (params.taker) {
      query.set("taker", params.taker);
    }

    const headers: Record<string, string> = {};
    if (this.apiKey) {
      headers["x-api-key"] = this.apiKey;
    }

    const res = await fetch(`${this.baseUrl}/order?${query}`, { headers });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Jupiter /order ${res.status}: ${body.slice(0, 300)}`);
    }

    const order = (await res.json()) as JupiterOrderResponse;

    if (order.transaction === "" || order.errorCode != null) {
      throw new Error(
        `Jupiter cannot build transaction [router=${order.router}] error ${order.errorCode}: ${order.errorMessage ?? order.error ?? "unknown"}`,
      );
    }

    return order;
  }

  private toQuote(side: "buy" | "sell", order: JupiterOrderResponse): JupiterExecutionQuote {
    const inputAmount = BigInt(order.inAmount);
    const outputAmount = BigInt(order.outAmount);

    let outputPerInput: number | null = null;
    try {
      const inNum = Number(order.inAmount);
      const outNum = Number(order.outAmount);
      if (inNum > 0 && Number.isFinite(inNum) && Number.isFinite(outNum)) {
        outputPerInput = outNum / inNum;
      }
    } catch {
      outputPerInput = null;
    }

    return {
      side,
      inputMint: order.inputMint,
      outputMint: order.outputMint,
      inputAmount,
      outputAmount,
      outputPerInput,
      priceImpactPct: order.priceImpact ?? null,
      router: order.router ?? null,
      requestId: order.requestId ?? "",
      feeBps: order.feeBps ?? null,
      hasTransaction: typeof order.transaction === "string" && order.transaction.length > 0,
      raw: order,
    };
  }

  /** SOL → TOKEN quote. Omit taker for quote-only (no transaction, paper-safe). */
  async quoteBuy(solAmount: number, tokenMint: string, taker?: string): Promise<JupiterExecutionQuote> {
    const order = await this.getOrder({
      inputMint: SOL_MINT,
      outputMint: tokenMint,
      amount: solToLamports(solAmount),
      taker,
    });
    return this.toQuote("buy", order);
  }

  /** TOKEN → SOL quote. Amount is in the token's smallest units. Omit taker for quote-only. */
  async quoteSell(
    tokenAmountSmallest: string | bigint,
    tokenMint: string,
    taker?: string,
  ): Promise<JupiterExecutionQuote> {
    const amount = typeof tokenAmountSmallest === "bigint" ? tokenAmountSmallest.toString() : tokenAmountSmallest;
    const order = await this.getOrder({
      inputMint: tokenMint,
      outputMint: SOL_MINT,
      amount,
      taker,
    });
    return this.toQuote("sell", order);
  }
}
