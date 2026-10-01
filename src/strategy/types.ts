export type DiscoveryPhase =
  | "phase1-migrated"
  | "phase1-final-stretch"
  | "phase1-new-pair"
  | "phase2"
  | "phase3";

export interface DiscoveryCandidate {
  phase: DiscoveryPhase;

  network: string;

  poolAddress: string;
  tokenAddress: string;

  tokenName: string;
  tokenSymbol: string;

  dexId: string;
  dexName: string;

  pairAgeHours: number;

  marketCapUsd: number | null;
  fdvUsd: number | null;

  liquidityUsd: number | null;
  volume24hUsd: number | null;
  transactions24h: number | null;

  priceChange5m: number | null;
  priceChange1h: number | null;
  priceChange6h: number | null;
  priceChange24h: number | null;
}
