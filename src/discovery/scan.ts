import type { DexPaprikaData } from "../dexpaprika";
import { enrichPool } from "./tokens";
import { classifyPhase2, classifyPhase3 } from "../strategy/discovery";
import { getAgeHours } from "../strategy/age";
import { SRT_DISCOVERY } from "../strategy/config";
import type { DiscoveryCandidate, DiscoveryPhase } from "../strategy/types";
import type { CandidateToken } from "../models";

export type MarketCapSource = "reported" | "unknown";

/**
 * Strategy eligibility. READY only with a REAL reported market cap
 * passing the Phase gates. FDV is display-only context — it must
 * never satisfy a market-cap filter (course-fidelity rule).
 */
export type Eligibility = "ready" | "blocked";

export interface WatchCandidate extends DiscoveryCandidate {
  marketCapSource: MarketCapSource;
  eligibility: Eligibility;
  /** Why a BLOCKED candidate is blocked (market cap unavailable, ...). */
  eligibilityReason: string;
}

export interface ScanOptions {
  /** Pools to pull per age window (default 15). */
  poolsPerWindow?: number;
  /** Max pools to enrich (each costs getPool + getToken calls; default 12). */
  enrichCap?: number;
  volume24hMin?: number;
  txns24hMin?: number;
  /** Ranked watchlist size (default 5). */
  watchlistSize?: number;
}

export interface ScanResult {
  candidates: WatchCandidate[];
  scannedPools: number;
  enrichedPools: number;
  at: string;
}

const HOURS_AGO = (h: number): string => new Date(Date.now() - h * 3_600_000).toISOString();

/**
 * Course-fidelity eligibility. The strict Phase classifiers run on the
 * REAL reported market cap only — a null mcap can never PASS. Tokens
 * matching a phase on age + volume + transactions but lacking a real
 * market cap are reported as age-compatible and BLOCKED, with FDV kept
 * as display-only context.
 */
export function classifyEligibility(
  token: CandidateToken,
  nowMs = Date.now(),
): { candidate: DiscoveryCandidate; source: MarketCapSource; eligibility: Eligibility; reason: string } | null {
  const strict = classifyPhase2(token, nowMs) ?? classifyPhase3(token, nowMs);
  if (strict) {
    return { candidate: strict, source: "reported", eligibility: "ready", reason: "real market cap passes gates" };
  }

  const ageHours = getAgeHours(token.poolCreatedAt, nowMs);
  if (!Number.isFinite(ageHours)) return null;

  const volOk = (min: number): boolean => token.volume24hUsd !== null && token.volume24hUsd >= min;
  const txnOk = (min: number): boolean => token.transactions24h !== null && token.transactions24h >= min;

  let phase: DiscoveryPhase | null = null;
  const p3 = SRT_DISCOVERY.phase3;
  if (ageHours >= p3.minPairAgeHours && volOk(p3.minVolume24hUsd) && txnOk(p3.minTransactions24h)) {
    phase = "phase3";
  } else {
    const p2 = SRT_DISCOVERY.phase2;
    const maxOk = p2.maxPairAgeHours === undefined || ageHours <= p2.maxPairAgeHours;
    if (ageHours >= p2.minPairAgeHours && maxOk && volOk(p2.minVolume24hUsd) && txnOk(p2.minTransactions24h)) {
      phase = "phase2";
    }
  }
  if (!phase) return null;

  return {
    candidate: {
      phase,
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
    },
    source: "unknown",
    eligibility: "blocked",
    reason: "market cap unavailable",
  };
}

/** Rank by 24h volume, highest first. Pure — unit tested. */
export function rankCandidates(candidates: WatchCandidate[], limit: number): WatchCandidate[] {
  return [...candidates]
    .sort((a, b) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0))
    .slice(0, Math.max(0, limit));
}

/** Pool addresses present in `next` but absent from `prev`. Pure — unit tested. */
export function diffWatchlist(prev: WatchCandidate[], next: WatchCandidate[]): WatchCandidate[] {
  const known = new Set(prev.map((c) => c.poolAddress));
  return next.filter((c) => !known.has(c.poolAddress));
}

/**
 * Merge pinned pools (e.g. the currently-tracked pool) into a ranked
 * watchlist. Pinned pools that pass the gates are guaranteed a slot even
 * when the volume-ranked slice cut them — qualification is judged on
 * gates, never on volume rank. Pure — unit tested.
 */
export function mergePinned(
  ranked: WatchCandidate[],
  pinned: WatchCandidate[],
  limit: number,
): WatchCandidate[] {
  const merged = new Map<string, WatchCandidate>();
  for (const c of ranked) merged.set(c.poolAddress, c);
  for (const c of pinned) {
    if (!merged.has(c.poolAddress)) merged.set(c.poolAddress, c);
  }
  const ordered = rankCandidates([...merged.values()], merged.size);
  const pinnedIds = new Set(pinned.map((c) => c.poolAddress));
  const guaranteed = ordered.filter((c) => pinnedIds.has(c.poolAddress));
  const rest = ordered.filter((c) => !pinnedIds.has(c.poolAddress));
  return [...guaranteed, ...rest].slice(0, Math.max(guaranteed.length, limit));
}

interface PoolRow {
  id: string;
}

function poolRows(res: unknown): PoolRow[] {
  if (Array.isArray(res)) return res as PoolRow[];
  if (res !== null && typeof res === "object") {
    const r = res as Record<string, unknown>;
    for (const key of ["pools", "results", "data"]) {
      if (Array.isArray(r[key])) return r[key] as PoolRow[];
    }
  }
  return [];
}

/**
 * Automated discovery scan. Two age-windowed filter calls (Phase 2:
 * 72h–1440h, Phase 3: 720h+) sorted by volume, bounded enrichment,
 * FDV-proxy classification, volume-ranked watchlist.
 *
 * OHLCV uses only the in-plan 15m form downstream — this scan itself
 * costs list + getPool + getToken calls only.
 */
export async function scanCandidates(
  paprika: DexPaprikaData,
  options: ScanOptions = {},
): Promise<ScanResult> {
  const poolsPerWindow = options.poolsPerWindow ?? 15;
  const enrichCap = options.enrichCap ?? 12;
  const volume24hMin = options.volume24hMin ?? 1_000;
  const txns24hMin = options.txns24hMin ?? 10;
  const watchlistSize = options.watchlistSize ?? 5;

  const windows = [HOURS_AGO(72), HOURS_AGO(720)];
  const seen = new Map<string, PoolRow>();
  for (const createdBefore of windows) {
    const res = await paprika.filterPools({
      createdBefore,
      volume24hMin,
      txns24hMin,
      sortBy: "volume_usd_24h",
      sortDir: "desc",
      limit: poolsPerWindow,
    });
    for (const row of poolRows(res)) {
      if (row?.id && !seen.has(row.id)) seen.set(row.id, row);
    }
  }

  const rows = [...seen.values()].slice(0, enrichCap);
  const found: WatchCandidate[] = [];
  let enrichedPools = 0;
  for (const row of rows) {
    let tokens: CandidateToken[];
    try {
      tokens = await enrichPool(paprika, row as Parameters<typeof enrichPool>[1]);
      enrichedPools += 1;
    } catch {
      continue;
    }
    for (const token of tokens) {
      const hit = classifyEligibility(token);
      if (hit) {
        found.push({
          ...hit.candidate,
          marketCapSource: hit.source,
          eligibility: hit.eligibility,
          eligibilityReason: hit.reason,
        });
      }
    }
  }

  // One entry per pool: keep the highest-volume candidate.
  const byPool = new Map<string, WatchCandidate>();
  for (const c of found) {
    const prev = byPool.get(c.poolAddress);
    if (!prev || (c.volume24hUsd ?? 0) > (prev.volume24hUsd ?? 0)) {
      byPool.set(c.poolAddress, c);
    }
  }

  return {
    candidates: rankCandidates([...byPool.values()], watchlistSize),
    scannedPools: seen.size,
    enrichedPools,
    at: new Date().toISOString(),
  };
}

/**
 * Evaluate ONE pool against the Phase 2/3 gates (same FDV-proxy rule).
 * Used to pin the currently-tracked pool into the scan set: it costs
 * one getPool + per-token getToken call and keeps a faded-volume pool
 * eligible on gates rather than on volume rank.
 */
export async function classifyPoolByAddress(
  paprika: DexPaprikaData,
  poolAddress: string,
  nowMs = Date.now(),
): Promise<{ candidates: WatchCandidate[]; enriched: boolean }> {
  let tokens: CandidateToken[];
  try {
    const pool = await paprika.getPool(poolAddress);
    const p = pool as unknown as {
      id: string;
      dex_id: string;
      dex_name: string;
      created_at?: string | null;
      ["24h"]?: { volume_usd?: number | null; txns?: number | null } | null;
    };
    // Search-row equivalent built from pool details (one getPool call;
    // passed prefetched so enrichPool does not refetch).
    const row = {
      id: p.id,
      dex_id: p.dex_id,
      dex_name: p.dex_name,
      created_at: p.created_at ?? "",
      volume_usd_24h: p["24h"]?.volume_usd ?? null,
      transactions_24h: p["24h"]?.txns ?? null,
    } as unknown as Parameters<typeof enrichPool>[1];
    tokens = await enrichPool(paprika, row, pool);
  } catch {
    return { candidates: [], enriched: false };
  }
  const found: WatchCandidate[] = [];
  for (const token of tokens) {
    const hit = classifyEligibility(token, nowMs);
    if (hit) {
      found.push({
        ...hit.candidate,
        marketCapSource: hit.source,
        eligibility: hit.eligibility,
        eligibilityReason: hit.reason,
      });
    }
  }
  return { candidates: found, enriched: true };
}
