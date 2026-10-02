import type { DexPaprikaData } from "../dexpaprika";
import { enrichPool } from "./tokens";
import { classifyPhase2, classifyPhase3 } from "../strategy/discovery";
import type { DiscoveryCandidate } from "../strategy/types";
import type { CandidateToken } from "../models";

export type MarketCapSource = "reported" | "fdv-proxy";

export interface WatchCandidate extends DiscoveryCandidate {
  /**
   * DexPaprika rarely reports market_cap for memecoins, so the
   * classifiers would reject everything. When true, FDV stands in
   * for market cap — stated explicitly here and in every report,
   * never silently.
   */
  marketCapSource: MarketCapSource;
}

export interface ScanOptions {
  /** Pools to pull per age window (default 15). */
  poolsPerWindow?: number;
  /** Max pools to enrich (each costs getPool + getToken calls; default 12). */
  enrichCap?: number;
  volume24hMin?: number;
  txns24hMin?: number;
  /** Allow FDV-as-market-cap proxy (default true). False = strict SRT. */
  useFdvProxy?: boolean;
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

/** Attach a market-cap value, recording whether FDV stood in. */
export function withMarketCapProxy(token: CandidateToken): {
  token: CandidateToken;
  source: MarketCapSource;
} {
  if (token.marketCapUsd !== null) return { token, source: "reported" };
  if (token.fdvUsd !== null) {
    return { token: { ...token, marketCapUsd: token.fdvUsd }, source: "fdv-proxy" };
  }
  return { token, source: "reported" };
}

/** Phase2/Phase3 classification with an explicitly-labeled FDV fallback. */
export function classifyWithProxy(
  token: CandidateToken,
  useFdvProxy: boolean,
  nowMs = Date.now(),
): { candidate: DiscoveryCandidate; source: MarketCapSource } | null {
  const { token: withCap, source } = withMarketCapProxy(token);
  if (source === "fdv-proxy" && !useFdvProxy) return null;
  const candidate = classifyPhase2(withCap, nowMs) ?? classifyPhase3(withCap, nowMs);
  return candidate ? { candidate, source } : null;
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
  const useFdvProxy = options.useFdvProxy ?? true;
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
      const hit = classifyWithProxy(token, useFdvProxy);
      if (hit) found.push({ ...hit.candidate, marketCapSource: hit.source });
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
  useFdvProxy = true,
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
    const hit = classifyWithProxy(token, useFdvProxy, nowMs);
    if (hit) found.push({ ...hit.candidate, marketCapSource: hit.source });
  }
  return { candidates: found, enriched: true };
}
