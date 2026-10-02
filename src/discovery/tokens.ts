import type { SearchPool } from "dexpaprika-sdk";

import type { CandidateToken } from "../models";

import type { DexPaprikaData } from "../dexpaprika";

const QUOTE_SYMBOLS = new Set(["SOL", "WSOL", "USDC", "USDT"]);

function isQuoteToken(symbol: string): boolean {
  return QUOTE_SYMBOLS.has(symbol.trim().toUpperCase());
}

type PoolDetails = Awaited<ReturnType<DexPaprikaData["getPool"]>>;

interface DetailStats {
  volume_usd?: number | null;
  txns?: number | null;
}

/** Pool-details fields used as fallback when a search row lacks them. */
function detailFallbacks(pool: PoolDetails): {
  createdAt: string;
  volume24hUsd: number | null;
  transactions24h: number | null;
} {
  const p = pool as unknown as {
    created_at?: string | null;
    ["24h"]?: DetailStats | null;
  };
  return {
    createdAt: p.created_at ?? "",
    volume24hUsd: p["24h"]?.volume_usd ?? null,
    transactions24h: p["24h"]?.txns ?? null,
  };
}

export async function enrichPool(
  paprika: DexPaprikaData,
  poolRow: SearchPool,
  prefetched?: PoolDetails,
): Promise<CandidateToken[]> {
  const pool = prefetched ?? (await paprika.getPool(poolRow.id));
  const fb = detailFallbacks(pool);

  const candidates: CandidateToken[] = [];

  for (const token of pool.tokens ?? []) {
    if (isQuoteToken(token.symbol ?? "")) {
      continue;
    }

    // No per-token DexPaprika call: names come from the pool record and
    // every market-data gap (mcap, FDV, price, liquidity, volume) is
    // filled downstream by one batched DEX Screener request. This keeps
    // the plan-limited API to pool listing + 15m candles only.
    candidates.push({
      network: paprika.network,

      poolAddress: poolRow.id,
      dexId: poolRow.dex_id,
      dexName: poolRow.dex_name,

      tokenAddress: token.id,
      tokenName: token.name ?? token.symbol ?? token.id,
      tokenSymbol: token.symbol ?? token.id,

      tokenAddedAt: null,
      fdvUsd: null,
      totalSupply: null,

      // Real market cap arrives via DEX Screener enrichment; null here
      // means unknown and the Phase classifiers reject it by design.
      marketCapUsd: null,

      poolCreatedAt: poolRow.created_at ?? fb.createdAt,

      priceUsd: poolRow.price_usd ?? null,

      liquidityUsd: poolRow.liquidity_usd ?? null,

      volume24hUsd: poolRow.volume_usd_24h ?? fb.volume24hUsd,

      transactions24h: poolRow.transactions_24h ?? fb.transactions24h,

      priceChange5m: poolRow.price_change_percentage_5m ?? null,

      priceChange1h: poolRow.price_change_percentage_1h ?? null,

      priceChange6h: poolRow.price_change_percentage_6h ?? null,

      priceChange24h: poolRow.price_change_percentage_24h ?? null,
    });
  }
  return candidates;
}
