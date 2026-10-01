export type ExecutionMode = "historical" | "paper-jupiter" | "live";

export type QuoteSide = "buy" | "sell";

/**
 * Endpoint-independent execution quote.
 *
 * Authoritative execution metric is derived from
 * input/output amounts + decimals (effective rate).
 * Venue price-impact fields are informational only.
 */
export interface ExecutionQuote {
  side: QuoteSide;

  /** Which quote transport produced this (e.g. "jupiter-swap-v2"). */
  endpoint: string;

  inputMint: string;
  outputMint: string;

  inputAmount: bigint;
  outputAmount: bigint;

  inputDecimals: number | null;
  outputDecimals: number | null;

  /**
   * Human output per 1 unit of human input, or null when
   * decimals are unknown. Derived from amounts, not from
   * any venue impact estimate.
   */
  effectiveRate: number | null;

  /** Informational only. NOT the execution cost. */
  priceImpactPct: number | null;

  router: string | null;
  requestId: string;
}

export function humanAmount(amount: bigint, decimals: number | null): number | null {
  if (decimals === null || decimals < 0) return null;
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  return n / 10 ** decimals;
}

export function effectiveRate(
  inputAmount: bigint,
  inputDecimals: number | null,
  outputAmount: bigint,
  outputDecimals: number | null,
): number | null {
  const humanIn = humanAmount(inputAmount, inputDecimals);
  const humanOut = humanAmount(outputAmount, outputDecimals);
  if (humanIn === null || humanOut === null || humanIn <= 0) return null;
  return humanOut / humanIn;
}

/**
 * Raw round-trip difference between two time-separated quotes,
 * in bps relative to the buy input. This INCLUDES price movement
 * between the two requests — do NOT label it execution cost.
 */
export function roundTripDifferenceBps(buyInSol: number, sellOutSol: number): number | null {
  if (!Number.isFinite(buyInSol) || buyInSol <= 0 || !Number.isFinite(sellOutSol)) return null;
  return ((sellOutSol - buyInSol) / buyInSol) * 10_000;
}
