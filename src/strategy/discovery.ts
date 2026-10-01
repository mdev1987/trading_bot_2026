import type { CandidateToken } from "../models";
import type { DiscoveryCandidate } from "./types";

import { getAgeHours } from "./age";
import { SRT_DISCOVERY } from "./config";

export function classifyPhase2(
  token: CandidateToken,
  nowMs = Date.now(),
): DiscoveryCandidate | null {
  const ageHours = getAgeHours(token.poolCreatedAt, nowMs);

  if (!Number.isFinite(ageHours)) {
    return null;
  }

  const rules = SRT_DISCOVERY.phase2;

  if (ageHours < rules.minPairAgeHours) {
    return null;
  }

  if (rules.maxPairAgeHours !== undefined && ageHours > rules.maxPairAgeHours) {
    return null;
  }

  if (
    token.volume24hUsd === null ||
    token.volume24hUsd < rules.minVolume24hUsd
  ) {
    return null;
  }

  if (
    token.transactions24h === null ||
    token.transactions24h < rules.minTransactions24h
  ) {
    return null;
  }

  // SRT specifies market cap.
  // We do NOT substitute FDV.
  if (
    token.marketCapUsd === null ||
    token.marketCapUsd < rules.minMarketCapUsd
  ) {
    return null;
  }

  return {
    phase: "phase2",

    network: token.network,

    poolAddress: token.poolAddress,
    tokenAddress: token.tokenAddress,

    tokenName: token.tokenName,
    tokenSymbol: token.tokenSymbol,

    dexId: token.dexId,
    dexName: token.dexName,

    pairAgeHours: ageHours,

    marketCapUsd: token.marketCapUsd,
    fdvUsd: token.fdvUsd,

    liquidityUsd: token.liquidityUsd,
    volume24hUsd: token.volume24hUsd,
    transactions24h: token.transactions24h,

    priceChange5m: token.priceChange5m,
    priceChange1h: token.priceChange1h,
    priceChange6h: token.priceChange6h,
    priceChange24h: token.priceChange24h,
  };
}

export function classifyPhase3(
  token: CandidateToken,
  nowMs = Date.now(),
): DiscoveryCandidate | null {
  const ageHours = getAgeHours(token.poolCreatedAt, nowMs);

  if (!Number.isFinite(ageHours)) {
    return null;
  }

  const rules = SRT_DISCOVERY.phase3;

  if (ageHours < rules.minPairAgeHours) {
    return null;
  }

  if (rules.maxPairAgeHours !== undefined && ageHours > rules.maxPairAgeHours) {
    return null;
  }

  if (
    token.volume24hUsd === null ||
    token.volume24hUsd < rules.minVolume24hUsd
  ) {
    return null;
  }

  if (
    token.transactions24h === null ||
    token.transactions24h < rules.minTransactions24h
  ) {
    return null;
  }

  // Phase 3 has no market-cap rule in the SRT discovery section.
  // No maximum age, no artificial $10M ceiling.

  return {
    phase: "phase3",

    network: token.network,

    poolAddress: token.poolAddress,
    tokenAddress: token.tokenAddress,

    tokenName: token.tokenName,
    tokenSymbol: token.tokenSymbol,

    dexId: token.dexId,
    dexName: token.dexName,

    pairAgeHours: ageHours,

    marketCapUsd: token.marketCapUsd,
    fdvUsd: token.fdvUsd,

    liquidityUsd: token.liquidityUsd,
    volume24hUsd: token.volume24hUsd,
    transactions24h: token.transactions24h,

    priceChange5m: token.priceChange5m,
    priceChange1h: token.priceChange1h,
    priceChange6h: token.priceChange6h,
    priceChange24h: token.priceChange24h,
  };
}
