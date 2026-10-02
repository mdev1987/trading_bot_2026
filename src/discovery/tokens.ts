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

    const details = await paprika.getToken(token.id);

    candidates.push({
      network: paprika.network,

      poolAddress: poolRow.id,
      dexId: poolRow.dex_id,
      dexName: poolRow.dex_name,

      tokenAddress: token.id,
      tokenName: details.name,
      tokenSymbol: details.symbol,

      tokenAddedAt: details.added_at ?? null,
      fdvUsd: details.summary?.fdv ?? null,
      totalSupply: details.total_supply ?? null,

      // SRT specifies market cap, DexPaprika gives FDV.
      // Do NOT substitute FDV here. TokenDetails.market_cap is read when
      // present (often absent for memecoins) — null stays null, and the
      // Phase 2/3 classifiers reject null by design.
      marketCapUsd: details.market_cap ?? null,

      poolCreatedAt: poolRow.created_at ?? fb.createdAt,

      priceUsd: details.summary?.price_usd ?? poolRow.price_usd ?? null,

      liquidityUsd:
        details.summary?.liquidity_usd ?? poolRow.liquidity_usd ?? null,

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
