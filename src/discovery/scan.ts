import type { DexPaprikaData } from "../dexpaprika";
import { enrichPool } from "./tokens";
import { enrichFromScreener } from "./enrich-market-cap";
import { DexScreenerData } from "../dexscreener";
import type { MarketCapProvider } from "../market-cap/provider";
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
  /** Max pools to enrich (one DexPaprika getPool each; default 12). */
  enrichCap?: number;
  volume24hMin?: number;
  txns24hMin?: number;
  /** Ranked watchlist size (default 5). */
  watchlistSize?: number;
  /**
   * Real market-cap + market-data enrichment (DEX Screener, batched).
   * Without it, every candidate stays BLOCKED — FDV is never substituted.
   */
  marketCapProvider?: MarketCapProvider | null;
  /** Shared DEX Screener client for gap-filling (defaults to fresh). */
  screener?: DexScreenerData | null;
}

export interface ScanResult {
  candidates: WatchCandidate[];
  scannedPools: number;
  enrichedPools: number;
  skippedMajors: number;
  at: string;
}

const HOURS_AGO = (h: number): string => new Date(Date.now() - h * 3_600_000).toISOString();

/**
 * Quote-like majors that can never be memecoin revival plays: fiat
 * stables and wrapped blue-chips. They eat top-volume scan slots with
 * flickering vestigial-pair data (USDG $10M↔$3B between scans) yet can
 * never clear the gates meaningfully — a sub-$10M stable is a corpse,
 * not a setup. Excluded from window scans so enrich budget goes to
 * real candidates. The tracked-pool pin bypasses this (gates decide).
 */
const EXCLUDED_MAJOR_SYMBOLS = new Set([
  "USDC", "USDT", "USDG", "PYUSD", "DAI", "USDS", "FDUSD", "TUSD",
  "USDD", "FRAX", "LUSD", "USDE",
  "CBBTC", "WBTC", "BTC",
  "WETH", "ETH",
  "WSOL", "SOL",
]);

/** True for quote-like majors (case/whitespace-insensitive). Pure — unit tested. */
export function isExcludedMajor(symbol: string | null | undefined): boolean {
  if (!symbol) return false;
  return EXCLUDED_MAJOR_SYMBOLS.has(symbol.trim().toUpperCase());
}

/** Certain major mints (filter rows carry mints, not symbols). */
const MAJOR_MINTS = new Set([
  "So11111111111111111111111111111111111111112", // WSOL
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
]);

interface PoolRowTokens {
  id?: string;
  tokens?: { id?: string | null }[] | null;
}

/** True when every token mint in the row is a known major (stable/stable, SOL/USDC...). Pure — unit tested. */
export function isAllMajorPool(row: PoolRowTokens | null | undefined): boolean {
  const mints = (row?.tokens ?? []).map((t) => t?.id).filter((id): id is string => !!id);
  return mints.length > 0 && mints.every((m) => MAJOR_MINTS.has(m));
}

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

  // Null mcap = unknown (data gap). A present mcap that failed the
  // strict gates above = known-but-out-of-range (e.g. above the $10M
  // Phase 3 ceiling). Different reasons, same BLOCKED outcome.
  const reason =
    token.marketCapUsd === null
      ? "market cap unavailable"
      : "real market cap outside Phase gates";

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
    source: token.marketCapUsd === null ? "unknown" : "reported",
    eligibility: "blocked",
    reason,
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
 * Report throttle for frequent scans: Telegram pings when the set
 * changes (arrivals or departures) or the heartbeat is due — never
 * on an identical re-scan. Pure — unit tested.
 */
export function shouldReportScan(
  prev: WatchCandidate[],
  next: WatchCandidate[],
  lastReportAtMs: number | null,
  nowMs = Date.now(),
  heartbeatMs = 3_600_000,
): boolean {
  if (diffWatchlist(prev, next).length > 0) return true;
  if (diffWatchlist(next, prev).length > 0) return true;
  if (lastReportAtMs === null) return true;
  return nowMs - lastReportAtMs >= heartbeatMs;
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

  // All-major pools (stable/stable...) never enrich: no getPool spent.
  // Other majors (PYUSD, cbBTC...) are dropped post-enrich by symbol.
  let skippedMajors = 0;
  const enrichable: PoolRow[] = [];
  for (const row of seen.values()) {
    if (enrichable.length >= enrichCap) break;
    if (isAllMajorPool(row as PoolRowTokens)) {
      skippedMajors += 1;
      continue;
    }
    enrichable.push(row);
  }

  const allTokens: CandidateToken[] = [];
  let enrichedPools = 0;
  for (const row of enrichable) {
    try {
      const tokens = await enrichPool(paprika, row as Parameters<typeof enrichPool>[1]);
      enrichedPools += 1;
      for (const token of tokens) {
        if (isExcludedMajor(token.tokenSymbol)) {
          skippedMajors += 1;
          continue;
        }
        allTokens.push(token);
      }
    } catch {
      continue;
    }
  }

  // One batched DEX Screener pass for every collected token
  // (mcap + all market-data gaps, ≤30/request). Without it,
  // marketCapUsd stays null and everything BLOCKED.
  const screener = options.screener ?? new DexScreenerData("solana");
  const withCaps =
    options.marketCapProvider && allTokens.length > 0
      ? await enrichFromScreener(
          options.marketCapProvider,
          screener,
          allTokens,
          paprika.network,
        )
      : allTokens;

  const found: WatchCandidate[] = [];
  for (const token of withCaps) {
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
    skippedMajors,
    at: new Date().toISOString(),
  };
}

/**
 * Evaluate ONE pool against the Phase 2/3 gates. Costs one DexPaprika
 * getPool call plus batched DEX Screener enrichment, and keeps a
 * faded-volume pool eligible on gates rather than on volume rank.
 */
export async function classifyPoolByAddress(
  paprika: DexPaprikaData,
  poolAddress: string,
  marketCapProvider?: MarketCapProvider | null,
  screener?: DexScreenerData | null,
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
  const withCaps =
    marketCapProvider && tokens.length > 0
      ? await enrichFromScreener(
          marketCapProvider,
          screener ?? new DexScreenerData("solana"),
          tokens,
          paprika.network,
        )
      : tokens;
  const found: WatchCandidate[] = [];
  for (const token of withCaps) {
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
