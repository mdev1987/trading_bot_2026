const JUPITER_ORDER_URL = "https://api.jup.ag/swap/v2/order";

export interface JupiterPaperQuote {
  inputMint: string;
  outputMint: string;

  inAmount: bigint;
  outAmount: bigint;

  inUsdValue: number | null;
  outUsdValue: number | null;

  /** Percentage points (authoritative field per docs). Informational for paper. */
  priceImpactPct: number | null;
  feeBps: number | null;

  signatureFeeLamports: number;
  prioritizationFeeLamports: number;
  rentFeeLamports: number;

  router: string | null;
  requestId: string;

  transactionPresent: boolean;
}

interface JupiterOrderResponse {
  inputMint?: string;
  outputMint?: string;
  inAmount?: string;
  outAmount?: string;

  inUsdValue?: number;
  outUsdValue?: number;

  priceImpact?: number;
  priceImpactPct?: string;

  feeBps?: number;

  signatureFeeLamports?: number;
  prioritizationFeeLamports?: number;
  rentFeeLamports?: number;

  router?: string;
  requestId?: string;

  transaction?: string | null;

  error?: string;
  errorCode?: number;
  errorMessage?: string;
}

export class JupiterPaperBroker {
  private readonly apiKey: string;

  constructor(apiKey: string | undefined) {
    if (!apiKey) {
      throw new Error("JUPITER_API_KEY is required");
    }
    this.apiKey = apiKey;
  }

  async quote(inputMint: string, outputMint: string, amount: bigint): Promise<JupiterPaperQuote> {
    if (amount <= 0n) {
      throw new Error("Quote amount must be > 0");
    }

    const params = new URLSearchParams({
      inputMint,
      outputMint,
      amount: amount.toString(),
    });

    // IMPORTANT: No "taker" is supplied.
    // Therefore Jupiter returns quote-only data and no transaction.
    const response = await fetch(`${JUPITER_ORDER_URL}?${params.toString()}`, {
      headers: {
        "x-api-key": this.apiKey,
        accept: "application/json",
      },
    });

    const rawText = await response.text();

    let data: JupiterOrderResponse;
    try {
      data = JSON.parse(rawText) as JupiterOrderResponse;
    } catch {
      throw new Error(`Jupiter returned invalid JSON: HTTP ${response.status}`);
    }

    if (!response.ok) {
      throw new Error(
        `Jupiter quote failed: HTTP ${response.status} ${data.errorMessage ?? data.error ?? rawText.slice(0, 200)}`,
      );
    }

    if (data.error || data.errorMessage) {
      throw new Error(`Jupiter quote failed: ${data.errorMessage ?? data.error}`);
    }

    if (!data.inputMint || !data.outputMint || !data.inAmount || !data.outAmount || !data.requestId) {
      throw new Error("Jupiter response missing required quote fields");
    }

    return {
      inputMint: data.inputMint,
      outputMint: data.outputMint,
      inAmount: BigInt(data.inAmount),
      outAmount: BigInt(data.outAmount),
      inUsdValue: data.inUsdValue ?? null,
      outUsdValue: data.outUsdValue ?? null,
      priceImpactPct:
        typeof data.priceImpact === "number"
          ? data.priceImpact
          : data.priceImpactPct != null
            ? Number(data.priceImpactPct) * 100
            : null,
      feeBps: data.feeBps ?? null,
      signatureFeeLamports: data.signatureFeeLamports ?? 0,
      prioritizationFeeLamports: data.prioritizationFeeLamports ?? 0,
      rentFeeLamports: data.rentFeeLamports ?? 0,
      router: data.router ?? null,
      requestId: data.requestId,
      transactionPresent: Boolean(data.transaction),
    };
  }
}
