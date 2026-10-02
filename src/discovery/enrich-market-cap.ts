import type { CandidateToken } from "../models";
import type { MarketCapProvider } from "../market-cap/provider";

export async function enrichMarketCaps(
  provider: MarketCapProvider,
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

  const marketCaps =
    await provider.getMarketCaps(
      network,
      tokenAddresses,
    );

  return candidates.map((candidate) => {
    const result =
      marketCaps.get(
        candidate.tokenAddress,
      );

    return {
      ...candidate,

      /*
       * IMPORTANT:
       * market cap comes only from DEX Screener.
       * Never fall back to FDV.
       */
      marketCapUsd:
        result?.marketCapUsd ?? null,

      /*
       * Keep FDV separate.
       *
       * DexPaprika remains the primary FDV source,
       * but DEX Screener's FDV can be retained only
       * when your existing value is missing.
       */
      fdvUsd:
        candidate.fdvUsd ??
        result?.fdvUsd ??
        null,
    };
  });
}
