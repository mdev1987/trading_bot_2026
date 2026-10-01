export interface MarketCapProvider {
  getMarketCapUsd(
    network: string,
    tokenAddress: string,
  ): Promise<number | null>;
}
