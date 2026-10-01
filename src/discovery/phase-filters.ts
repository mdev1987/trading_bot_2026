import { DexPaprikaData } from "../dexpaprika";

export async function findPhase2Pools(paprika: DexPaprikaData) {
  return paprika.filterPools({
    // SRT: approximately 3 days → 2 months old
    createdAfter: "-60d",
    createdBefore: "-3d",

    // Keep genuinely active pools in the scan.
    // This is an engineering starting point, not an SRT-validated threshold.
    volume24hMin: 1_000,
    txns24hMin: 10,

    // SRT emphasizes 24h activity for Phase 2.
    sortBy: "volume_usd_24h",
    sortDir: "desc",

    limit: 100,
  });
}

export async function findPhase3Pools(paprika: DexPaprikaData) {
  return paprika.filterPools({
    // SRT: approximately 1 month or older
    createdBefore: "-30d",

    volume24hMin: 1_000,
    txns24hMin: 10,

    // SRT emphasizes 24h activity and sometimes 6h activity.
    sortBy: "volume_usd_24h",
    sortDir: "desc",

    limit: 100,
  });
}
