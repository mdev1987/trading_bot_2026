export const paperConfig = {
  startingBalanceSol: 1.0,

  /**
   * Same position sizing limits from Module 8.
   */
  maxPositionSol: 0.1,

  /**
   * Polling is for market monitoring only.
   * Jupiter is NOT polled every cycle.
   */
  pollMs: 15_000,

  /**
   * One pool/token for the first paper run (STONK).
   */
  poolAddress: "zxTpi4BtaWX3mgdAPoezkMD1hxx8CdeCfrqXMWvSCLX",

  tokenMint: "6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx",

  solMint: "So11111111111111111111111111111111111111112",

  /**
   * Automated discovery: age-windowed DexPaprika scan (Phase 2/3 filters,
   * FDV-as-mcap proxy explicitly labeled), volume-ranked watchlist.
   * The loop keeps ONE position max: scans only rotate the tracked pool
   * while flat; with a position open the scan is report-only.
   */
  scanIntervalMs: 3_600_000,
  watchlistSize: 5,
  scanPoolsPerWindow: 15,
  scanEnrichCap: 12,

  /**
   * Sideways range-break entries. Kill-switch for the noisier setup:
   * set false to isolate reversal/continuation without a redeploy
   * of strategy code.
   */
  enableRangeBreak: true,
} as const;
