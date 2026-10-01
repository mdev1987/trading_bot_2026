import { DexPaprikaClient } from "dexpaprika-sdk";
import { config } from "./config";

type SortDirection = "asc" | "desc";

type PoolSortField =
  | "volume_usd_24h"
  | "volume_usd_7d"
  | "volume_usd_30d"
  | "liquidity_usd"
  | "txns_24h"
  | "created_at"
  | "price_usd"
  | "price_change_percentage_24h"
  | "price_change_percentage_6h"
  | "price_change_percentage_1h"
  | "price_change_percentage_5m";

export interface PoolFilterOptions {
  volume24hMin?: number;
  volume24hMax?: number;

  txns24hMin?: number;
  txns24hMax?: number;

  priceChange24hMin?: number;
  priceChange24hMax?: number;

  priceChange6hMin?: number;
  priceChange6hMax?: number;

  priceChange1hMin?: number;
  priceChange1hMax?: number;

  priceChange5mMin?: number;
  priceChange5mMax?: number;

  createdAfter?: string;
  createdBefore?: string;

  sortBy?: PoolSortField;
  sortDir?: SortDirection;

  limit?: number;
  cursor?: string;
}

export class DexPaprikaData {
  readonly client: DexPaprikaClient;
  readonly network: string;

  constructor() {
    this.client = new DexPaprikaClient(
      "https://api.dexpaprika.com",
      {},
      {
        apiKey: config.dexPaprika.apiKey,
      },
    );

    this.network = config.dexPaprika.network;
  }

  async getNetworks() {
    return this.client.networks.list();
  }

  async getDexes() {
    return this.client.dexes.listByNetwork(this.network, {
      limit: 100,
    });
  }

  async getNewPools(limit = 20) {
    return this.client.pools.listByNetwork(this.network, {
      limit,
      orderBy: "created_at",
      sort: "desc",
    });
  }

  async getTopPoolsByVolume(limit = 20) {
    return this.client.pools.listByNetwork(this.network, {
      limit,
      orderBy: "volume_usd_24h",
      sort: "desc",
    });
  }

  async filterPools(options: PoolFilterOptions = {}) {
    return this.client.pools.filter(this.network, options);
  }

  async getPool(poolAddress: string) {
    return this.client.pools.getDetails(this.network, poolAddress);
  }

  async getPoolOHLCV(
    poolAddress: string,
    options: {
      start: string;
      end?: string;
      interval?: "1m" | "5m" | "10m" | "15m" | "30m" | "1h" | "6h" | "12h" | "24h";
      limit?: number;
      inversed?: boolean;
    },
  ) {
    return this.client.pools.getOHLCV(this.network, poolAddress, options);
  }

  async getToken(tokenAddress: string) {
    return this.client.tokens.getDetails(this.network, tokenAddress);
  }

  async getTokenPools(tokenAddress: string, limit = 20) {
    return this.client.tokens.getPools(this.network, tokenAddress, {
      limit,
      orderBy: "volume_usd_24h",
      sort: "desc",
    });
  }
}
