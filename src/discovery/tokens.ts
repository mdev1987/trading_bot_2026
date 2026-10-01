import type { SearchPool } from "dexpaprika-sdk";

import type { CandidateToken } from "../models";

import type { DexPaprikaData } from "../dexpaprika";

const QUOTE_SYMBOLS = new Set(["SOL", "WSOL", "USDC", "USDT"]);

function isQuoteToken(symbol: string): boolean {
  return QUOTE_SYMBOLS.has(symbol.trim().toUpperCase());
}

export async function enrichPool(
  paprika: DexPaprikaData,
  poolRow: SearchPool,
): Promise<CandidateToken[]> {
  const pool = await paprika.getPool(poolRow.id);

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

      poolCreatedAt: poolRow.created_at,

      priceUsd: details.summary?.price_usd ?? poolRow.price_usd ?? null,

      liquidityUsd:
        details.summary?.liquidity_usd ?? poolRow.liquidity_usd ?? null,

      volume24hUsd: poolRow.volume_usd_24h ?? null,

      transactions24h: poolRow.transactions_24h ?? null,

      priceChange5m: poolRow.price_change_percentage_5m ?? null,

      priceChange1h: poolRow.price_change_percentage_1h ?? null,

      priceChange6h: poolRow.price_change_percentage_6h ?? null,

      priceChange24h: poolRow.price_change_percentage_24h ?? null,
    });
  }
  return candidates;
}
