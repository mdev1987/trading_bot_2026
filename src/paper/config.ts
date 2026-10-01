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
} as const;
