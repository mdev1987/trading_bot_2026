import type { CandidateToken } from "../models";
import type { MarketCapProvider } from "../market-cap/provider";
import { DexScreenerData } from "../dexscreener";

/**
 * Fill every CandidateToken gap DEX Screener can cover, in ONE batched
 * request per 30 tokens:
 * - marketCapUsd: Screener only, never FDV (strict course rule).
 * - fdvUsd / priceUsd / liquidityUsd / volume / txns / price changes:
 *   DexPaprika values win when present; Screener fills nulls.
 *
 * This is what lets the scan skip per-token DexPaprika getToken calls
 * entirely — the plan-limited API is used for pool listing + 15m
 * candles only.
 */
export async function enrichFromScreener(
  provider: MarketCapProvider,
  screener: DexScreenerData,
  candidates: CandidateToken[],
  network = "solana",
): Promise<CandidateToken[]> {
  if (candidates.length === 0) {
    return candidates;
  }

  const tokenAddresses = [
    ...new Set(
      candidates.map(
        (candidate) => candidate.tokenAddress,
      ),
    ),
  ];

  const [marketCaps, snapshots] = await Promise.all([
    provider.getMarketCaps(network, tokenAddresses),
    screener.getTokenSnapshots(tokenAddresses),
  ]);

  return candidates.map((candidate) => {
    const cap = marketCaps.get(candidate.tokenAddress);
    const snap = snapshots.get(candidate.tokenAddress);

    return {
      ...candidate,

      marketCapUsd: cap?.marketCapUsd ?? null,

      fdvUsd: candidate.fdvUsd ?? cap?.fdvUsd ?? snap?.fdvUsd ?? null,
      priceUsd: candidate.priceUsd ?? snap?.priceUsd ?? null,
      liquidityUsd: candidate.liquidityUsd ?? snap?.liquidityUsd ?? null,
      volume24hUsd: candidate.volume24hUsd ?? snap?.volume24hUsd ?? null,
      transactions24h: candidate.transactions24h ?? snap?.txns24h ?? null,
      priceChange5m: candidate.priceChange5m ?? snap?.priceChangeM5Pct ?? null,
      priceChange1h: candidate.priceChange1h ?? snap?.priceChangeH1Pct ?? null,
      priceChange6h: candidate.priceChange6h ?? snap?.priceChangeH6Pct ?? null,
      priceChange24h: candidate.priceChange24h ?? snap?.priceChangeH24Pct ?? null,
    };
  });
}
