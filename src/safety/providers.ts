import type { SafetyInput } from "./gate";

const RPC_TIMEOUT_MS = 10_000;
const ORDERS_TIMEOUT_MS = 10_000;

export interface HolderConcentration {
  top10Pct: number | null;
  largestPct: number | null;
}

interface RpcResponse<T> {
  result?: T;
  error?: { message?: string };
}

async function rpcCall<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T | null> {
  let response: Response;
  try {
    response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
  } catch (error) {
    console.warn(`[SAFETY-RPC] ${method} failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  if (!response.ok) {
    console.warn(`[SAFETY-RPC] ${method} HTTP ${response.status}`);
    return null;
  }
  try {
    const json = (await response.json()) as RpcResponse<T>;
    if (json.error) {
      console.warn(`[SAFETY-RPC] ${method} error: ${json.error.message ?? "unknown"}`);
      return null;
    }
    return json.result ?? null;
  } catch {
    console.warn(`[SAFETY-RPC] ${method} invalid JSON`);
    return null;
  }
}

function toNumber(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Top-10 + largest holder share via standard Solana JSON-RPC
 * (works on Shyft authenticated RPC and public endpoints alike).
 * Returns nulls — never throws — so unknown stays unknown.
 */
export async function getHolderConcentration(
  rpcUrl: string,
  tokenMint: string,
): Promise<HolderConcentration> {
  const [largest, supply] = await Promise.all([
    rpcCall<{ value: { uiAmount: number | string | null }[] }>(rpcUrl, "getTokenLargestAccounts", [
      tokenMint,
      { commitment: "confirmed" },
    ]),
    rpcCall<{ value: { uiAmountString: string } }>(rpcUrl, "getTokenSupply", [
      tokenMint,
      { commitment: "confirmed" },
    ]),
  ]);

  const total = supply?.value?.uiAmountString ? toNumber(supply.value.uiAmountString) : null;
  const amounts = (largest?.value ?? [])
    .map((a) => toNumber(a.uiAmount))
    .filter((n): n is number => n !== null)
    .sort((a, b) => b - a);

  if (total === null || total <= 0 || amounts.length === 0) return { top10Pct: null, largestPct: null };

  const top10 = amounts.slice(0, 10).reduce((s, v) => s + v, 0);
  return { top10Pct: (top10 / total) * 100, largestPct: (amounts[0]! / total) * 100 };
}

/**
 * DEX-paid signal via DEX Screener paid orders (profiles/takeovers/ads).
 * Any listed order means the team paid for visibility. Fetch failure or
 * a non-array response yields null (unknown), never false.
 */
export async function getDexPaidStatus(tokenMint: string): Promise<boolean | null> {
  const url = `https://api.dexscreener.com/orders/v1/solana/${tokenMint}`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(ORDERS_TIMEOUT_MS),
    });
  } catch (error) {
    console.warn(`[SAFETY-ORDERS] request failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  if (!response.ok) {
    console.warn(`[SAFETY-ORDERS] HTTP ${response.status}`);
    return null;
  }
  try {
    const json: unknown = await response.json();
    // Live shape: {"orders": [...], "boosts": [...]}. Accept a bare
    // array too, for forward compatibility.
    if (Array.isArray(json)) return json.length > 0;
    if (json !== null && typeof json === "object" && Array.isArray((json as { orders?: unknown }).orders)) {
      return (json as { orders: unknown[] }).orders.length > 0;
    }
    console.warn("[SAFETY-ORDERS] unexpected response shape");
    return null;
  } catch {
    console.warn("[SAFETY-ORDERS] invalid JSON");
    return null;
  }
}

export interface MintAuthorities {
  /** Null = revoked (or absent). Undefined-shaped failures stay null Tri-state via `known`. */
  mintAuthority: string | null;
  freezeAuthority: string | null;
  /** First listed creator address, when the DAS record has one. */
  creatorAddress: string | null;
  known: boolean;
}

/**
 * Mint/freeze authorities + creator via Helius DAS getAsset.
 * Revoked authorities come back null — the single most important
 * dev-risk signal (unlimited minting / freezing still possible?).
 * `known=false` on any failure so absent data never reads as revoked.
 */
export async function getMintAuthorities(
  rpcUrl: string,
  tokenMint: string,
): Promise<MintAuthorities> {
  const unknown: MintAuthorities = { mintAuthority: null, freezeAuthority: null, creatorAddress: null, known: false };
  let response: Response;
  try {
    response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAsset", params: { id: tokenMint } }),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
  } catch (error) {
    console.warn(`[SAFETY-DAS] getAsset failed: ${error instanceof Error ? error.message : String(error)}`);
    return unknown;
  }
  if (!response.ok) {
    console.warn(`[SAFETY-DAS] getAsset HTTP ${response.status}`);
    return unknown;
  }
  try {
    const json = (await response.json()) as RpcResponse<{
      token_info?: { mint_authority?: string | null; freeze_authority?: string | null } | null;
      creators?: { address?: string | null }[] | null;
    }>;
    if (json.error || !json.result) {
      console.warn(`[SAFETY-DAS] getAsset error: ${json.error?.message ?? "empty result"}`);
      return unknown;
    }
    const info = json.result.token_info ?? null;
    if (!info) return unknown;
    const creators = (json.result.creators ?? []).map((c) => c.address).filter((a): a is string => !!a);
    return {
      mintAuthority: info.mint_authority ?? null,
      freezeAuthority: info.freeze_authority ?? null,
      creatorAddress: creators[0] ?? null,
      known: true,
    };
  } catch {
    console.warn("[SAFETY-DAS] getAsset invalid JSON");
    return unknown;
  }
}

/**
 * Share of total supply currently held by one wallet (dev/creator
 * holdings estimate). Standard getTokenAccountsByOwner, summed over
 * every token account the owner has for the mint.
 */
export async function getOwnerHoldingsPct(
  rpcUrl: string,
  ownerAddress: string,
  tokenMint: string,
): Promise<number | null> {
  const [accounts, supply] = await Promise.all([
    rpcCall<{ value: { account: { data: { parsed: { info: { tokenAmount: { uiAmount: number | string | null } } } } } }[] }>(
      rpcUrl,
      "getTokenAccountsByOwner",
      [ownerAddress, { mint: tokenMint }, { encoding: "jsonParsed", commitment: "confirmed" }],
    ),
    rpcCall<{ value: { uiAmountString: string } }>(rpcUrl, "getTokenSupply", [
      tokenMint,
      { commitment: "confirmed" },
    ]),
  ]);
  const total = supply?.value?.uiAmountString ? toNumber(supply.value.uiAmountString) : null;
  if (total === null || total <= 0 || !accounts?.value) return null;
  let held = 0;
  for (const a of accounts.value) {
    const n = toNumber(a?.account?.data?.parsed?.info?.tokenAmount?.uiAmount);
    if (n !== null) held += n;
  }
  return (held / total) * 100;
}

/**
 * Build a gate SafetyInput with every wired source filled and the rest
 * null. Insiders, bundles, snipers, wallet clusters, global fees and
 * chart behavior have no provider yet — they stay unknown, and the
 * entry policy decides what unknown means (paper may trade WATCH).
 */
export async function fetchSafetyInput(
  rpcUrl: string,
  tokenMint: string,
): Promise<SafetyInput> {
  const [holders, dexPaid, authorities] = await Promise.all([
    getHolderConcentration(rpcUrl, tokenMint),
    getDexPaidStatus(tokenMint),
    getMintAuthorities(rpcUrl, tokenMint),
  ]);
  let devPct: number | null = null;
  if (authorities.known && authorities.creatorAddress) {
    devPct = await getOwnerHoldingsPct(rpcUrl, authorities.creatorAddress, tokenMint);
  }
  return {
    tokenAddress: tokenMint,
    globalFees: null,
    top10HolderConcentrationPct: holders.top10Pct,
    largestHolderPct: holders.largestPct,
    insiderPct: null,
    bundledPct: null,
    devPct,
    mintAuthorityRevoked: authorities.known ? authorities.mintAuthority === null : null,
    freezeAuthorityRevoked: authorities.known ? authorities.freezeAuthority === null : null,
    sniperPct: null,
    walletClusterDetected: null,
    dexPaid,
    suspiciousChart: null,
  };
}
