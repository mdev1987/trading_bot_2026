export interface DexScreenerPair {
  chainId?: string | null;
  dexId?: string | null;
  url?: string | null;
  pairAddress?: string | null;

  baseToken?: {
    address?: string | null;
    name?: string | null;
    symbol?: string | null;
  };

  quoteToken?: {
    address?: string | null;
    name?: string | null;
    symbol?: string | null;
  };

  priceNative?: string | null;
  priceUsd?: string | null;

  liquidity?: {
    usd?: number | null;
    base?: number | null;
    quote?: number | null;
  } | null;

  fdv?: number | null;
  marketCap?: number | null;
  pairCreatedAt?: number | null;

  txns?: Record<
    string,
    {
      buys?: number;
      sells?: number;
    }
  >;

  volume?: Record<string, number>;
  priceChange?: Record<string, number> | null;

  boosts?: {
    active?: number;
  } | null;
}

export interface DexScreenerTokenSnapshot {
  tokenAddress: string;

  priceUsd: number | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;

  liquidityUsd: number | null;

  pairAddress: string | null;
  dexId: string | null;
  pairCreatedAt: number | null;

  quoteSymbol: string | null;

  observedAt: number;
}

const API_URL = "https://api.dexscreener.com";

const MAX_ADDRESSES_PER_REQUEST = 30;

const REQUEST_TIMEOUT_MS = 10_000;

function finitePositive(
  value: unknown,
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0
  );
}

function parsePositiveNumber(
  value: string | null | undefined,
): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value);

  return finitePositive(parsed)
    ? parsed
    : null;
}

function chunk<T>(
  items: T[],
  size: number,
): T[][] {
  const result: T[][] = [];

  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }

  return result;
}

function pairLiquidity(
  pair: DexScreenerPair,
): number {
  return finitePositive(pair.liquidity?.usd)
    ? pair.liquidity.usd!
    : 0;
}

function quotePriority(
  pair: DexScreenerPair,
): number {
  const symbol =
    pair.quoteToken?.symbol
      ?.trim()
      .toUpperCase();

  if (!symbol) {
    return 0;
  }

  if (symbol === "SOL" || symbol === "WSOL") {
    return 4;
  }

  if (symbol === "USDC") {
    return 3;
  }

  if (symbol === "USDT") {
    return 2;
  }

  return 1;
}

function isBetterPair(
  candidate: DexScreenerPair,
  current: DexScreenerPair | undefined,
): boolean {
  if (!current) {
    return true;
  }

  const candidateQuote =
    quotePriority(candidate);

  const currentQuote =
    quotePriority(current);

  if (candidateQuote !== currentQuote) {
    return candidateQuote > currentQuote;
  }

  return (
    pairLiquidity(candidate) >
    pairLiquidity(current)
  );
}

function getTokenPriceUsd(
  pair: DexScreenerPair,
  tokenAddress: string,
): number | null {
  const baseAddress =
    pair.baseToken?.address ?? null;

  const quoteAddress =
    pair.quoteToken?.address ?? null;

  /*
   * Normal case:
   * token is the base asset and DexScreener's
   * priceUsd is already the token's USD price.
   */
  if (baseAddress === tokenAddress) {
    return parsePositiveNumber(
      pair.priceUsd,
    );
  }

  /*
   * Less common case:
   * token is the quote asset.
   *
   * priceNative = quote units per 1 base token
   * priceUsd    = USD price of 1 base token
   *
   * Therefore:
   *
   * quote USD price =
   * base USD price / quote-per-base
   */
  if (quoteAddress === tokenAddress) {
    const basePriceUsd =
      parsePositiveNumber(pair.priceUsd);

    const quotePerBase =
      parsePositiveNumber(pair.priceNative);

    if (
      basePriceUsd === null ||
      quotePerBase === null
    ) {
      return null;
    }

    const quotePriceUsd =
      basePriceUsd / quotePerBase;

    return finitePositive(quotePriceUsd)
      ? quotePriceUsd
      : null;
  }

  return null;
}

function emptySnapshot(
  tokenAddress: string,
): DexScreenerTokenSnapshot {
  return {
    tokenAddress,

    priceUsd: null,
    marketCapUsd: null,
    fdvUsd: null,

    liquidityUsd: null,

    pairAddress: null,
    dexId: null,
    pairCreatedAt: null,

    quoteSymbol: null,

    observedAt: Date.now(),
  };
}

export class DexScreenerData {
  readonly chainId: string;

  constructor(chainId = "solana") {
    this.chainId = chainId;
  }

  async getTokenSnapshots(
    tokenAddresses: string[],
  ): Promise<
    Map<string, DexScreenerTokenSnapshot>
  > {
    const uniqueAddresses = [
      ...new Set(
        tokenAddresses.filter(
          (address) => address.trim().length > 0,
        ),
      ),
    ];

    const snapshots = new Map<
      string,
      DexScreenerTokenSnapshot
    >();

    for (const batch of chunk(
      uniqueAddresses,
      MAX_ADDRESSES_PER_REQUEST,
    )) {
      const pairs = await this.fetchBatch(
        batch,
      );

      const bestPairs = new Map<
        string,
        DexScreenerPair
      >();

      for (const pair of pairs) {
        const baseAddress =
          pair.baseToken?.address ?? null;

        const quoteAddress =
          pair.quoteToken?.address ?? null;

        if (
          baseAddress &&
          batch.includes(baseAddress) &&
          isBetterPair(
            pair,
            bestPairs.get(baseAddress),
          )
        ) {
          bestPairs.set(
            baseAddress,
            pair,
          );
        }

        if (
          quoteAddress &&
          batch.includes(quoteAddress) &&
          isBetterPair(
            pair,
            bestPairs.get(quoteAddress),
          )
        ) {
          bestPairs.set(
            quoteAddress,
            pair,
          );
        }
      }

      for (const tokenAddress of batch) {
        const pair =
          bestPairs.get(tokenAddress);

        if (!pair) {
          snapshots.set(
            tokenAddress,
            emptySnapshot(tokenAddress),
          );

          continue;
        }

        snapshots.set(
          tokenAddress,
          {
            tokenAddress,

            priceUsd:
              getTokenPriceUsd(
                pair,
                tokenAddress,
              ),

            /*
             * CRITICAL:
             * market cap comes directly from
             * DEX Screener.
             *
             * Never replace it with FDV.
             */
            marketCapUsd:
              finitePositive(pair.marketCap)
                ? pair.marketCap!
                : null,

            fdvUsd:
              finitePositive(pair.fdv)
                ? pair.fdv!
                : null,

            liquidityUsd:
              finitePositive(
                pair.liquidity?.usd,
              )
                ? pair.liquidity!.usd!
                : null,

            pairAddress:
              pair.pairAddress ?? null,

            dexId:
              pair.dexId ?? null,

            pairCreatedAt:
              pair.pairCreatedAt ?? null,

            quoteSymbol:
              pair.quoteToken?.symbol
                ?? null,

            observedAt: Date.now(),
          },
        );
      }
    }

    return snapshots;
  }

  private async fetchBatch(
    tokenAddresses: string[],
  ): Promise<DexScreenerPair[]> {
    if (tokenAddresses.length === 0) {
      return [];
    }

    const url =
      `${API_URL}/tokens/v1/` +
      `${encodeURIComponent(this.chainId)}/` +
      tokenAddresses.join(",");

    let response: Response;

    try {
      response = await fetch(url, {
        headers: {
          accept: "application/json",
        },

        signal: AbortSignal.timeout(
          REQUEST_TIMEOUT_MS,
        ),
      });
    } catch (error) {
      console.warn(
        `[DEXSCREENER] request failed: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      );

      return [];
    }

    if (!response.ok) {
      console.warn(
        `[DEXSCREENER] HTTP ${response.status}`,
      );

      return [];
    }

    try {
      const data: unknown =
        await response.json();

      if (!Array.isArray(data)) {
        console.warn(
          "[DEXSCREENER] unexpected response",
        );

        return [];
      }

      return data as DexScreenerPair[];
    } catch (error) {
      console.warn(
        `[DEXSCREENER] invalid JSON: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      );

      return [];
    }
  }
}
