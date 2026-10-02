export interface MarketCapResult {
  marketCapUsd: number | null;
  fdvUsd: number | null;

  source: "dexscreener" | "unknown";

  pairAddress: string | null;
  dexId: string | null;

  /**
   * True when DEX Screener supplied a usable market-cap value.
   */
  verified: boolean;
}

export interface MarketCapProvider {
  getMarketCaps(
    network: string,
    tokenAddresses: string[],
  ): Promise<Map<string, MarketCapResult>>;
}
