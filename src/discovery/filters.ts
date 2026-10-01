import type { CandidateToken } from "../models";

export interface DiscoveryFilter {
  minAgeHours?: number;
  maxAgeHours?: number;

  minMarketCapUsd?: number;
  maxMarketCapUsd?: number;

  minFdvUsd?: number;
  maxFdvUsd?: number;

  minLiquidityUsd?: number;
  minVolume24hUsd?: number;
  minTransactions24h?: number;
}

export interface FilterResult {
  passed: boolean;
  reasons: string[];
}

function ageHours(createdAt: string): number {
  const created = Date.parse(createdAt);

  if (!Number.isFinite(created)) {
    return NaN;
  }

  return (Date.now() - created) / 3_600_000;
}

export function applyDiscoveryFilter(
  token: CandidateToken,
  filter: DiscoveryFilter,
): FilterResult {
  const reasons: string[] = [];

  const age = ageHours(token.poolCreatedAt);

  if (
    filter.minAgeHours !== undefined &&
    (!Number.isFinite(age) || age < filter.minAgeHours)
  ) {
    reasons.push("too-young");
  }

  if (
    filter.maxAgeHours !== undefined &&
    (!Number.isFinite(age) || age > filter.maxAgeHours)
  ) {
    reasons.push("too-old");
  }

  if (
    filter.minMarketCapUsd !== undefined &&
    (token.marketCapUsd === null || token.marketCapUsd < filter.minMarketCapUsd)
  ) {
    reasons.push("market-cap-below-min");
  }

  if (
    filter.maxMarketCapUsd !== undefined &&
    (token.marketCapUsd === null || token.marketCapUsd > filter.maxMarketCapUsd)
  ) {
    reasons.push("market-cap-above-max");
  }

  if (
    filter.minFdvUsd !== undefined &&
    (token.fdvUsd === null || token.fdvUsd < filter.minFdvUsd)
  ) {
    reasons.push("fdv-below-min");
  }

  if (
    filter.maxFdvUsd !== undefined &&
    (token.fdvUsd === null || token.fdvUsd > filter.maxFdvUsd)
  ) {
    reasons.push("fdv-above-max");
  }

  if (
    filter.minLiquidityUsd !== undefined &&
    (token.liquidityUsd === null || token.liquidityUsd < filter.minLiquidityUsd)
  ) {
    reasons.push("liquidity-below-min");
  }

  if (
    filter.minVolume24hUsd !== undefined &&
    (token.volume24hUsd === null || token.volume24hUsd < filter.minVolume24hUsd)
  ) {
    reasons.push("volume-below-min");
  }

  if (
    filter.minTransactions24h !== undefined &&
    (token.transactions24h === null ||
      token.transactions24h < filter.minTransactions24h)
  ) {
    reasons.push("transactions-below-min");
  }

  return {
    passed: reasons.length === 0,
    reasons,
  };
}
