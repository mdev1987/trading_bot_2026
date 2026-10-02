import {
  DexScreenerData,
} from "../dexscreener";

import type {
  MarketCapProvider,
  MarketCapResult,
} from "./provider";

export class DexScreenerMarketCap
  implements MarketCapProvider
{
  private readonly data =
    new DexScreenerData("solana");

  async getMarketCaps(
    network: string,
    tokenAddresses: string[],
  ): Promise<Map<string, MarketCapResult>> {
    if (network !== "solana") {
      throw new Error(
        `DexScreenerMarketCap only supports solana, got ${network}`,
      );
    }

    const snapshots =
      await this.data.getTokenSnapshots(
        tokenAddresses,
      );

    const result = new Map<
      string,
      MarketCapResult
    >();

    for (const address of tokenAddresses) {
      const snapshot =
        snapshots.get(address);

      result.set(
        address,
        {
          marketCapUsd:
            snapshot?.marketCapUsd ?? null,

          fdvUsd:
            snapshot?.fdvUsd ?? null,

          source:
            snapshot?.marketCapUsd !== null &&
            snapshot?.marketCapUsd !== undefined
              ? "dexscreener"
              : "unknown",

          pairAddress:
            snapshot?.pairAddress ?? null,

          dexId:
            snapshot?.dexId ?? null,

          verified:
            snapshot?.marketCapUsd !== null &&
            snapshot?.marketCapUsd !== undefined,
        },
      );
    }

    return result;
  }

  async getMarketCapUsd(
    network: string,
    tokenAddress: string,
  ): Promise<number | null> {
    const result =
      await this.getMarketCaps(
        network,
        [tokenAddress],
      );

    return (
      result.get(tokenAddress)
        ?.marketCapUsd ?? null
    );
  }
}
