export interface CandidateToken {
  network: string;

  poolAddress: string;
  dexId: string;
  dexName: string;

  tokenAddress: string;
  tokenName: string;
  tokenSymbol: string;

  tokenAddedAt: string | null;

  priceUsd: number | null;

  marketCapUsd: number | null;
  fdvUsd: number | null;

  totalSupply: number | null;
  liquidityUsd: number | null;

  poolCreatedAt: string;

  volume24hUsd: number | null;
  transactions24h: number | null;

  priceChange5m: number | null;
  priceChange1h: number | null;
  priceChange6h: number | null;
  priceChange24h: number | null;
}
