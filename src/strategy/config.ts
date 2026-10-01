export const SRT_DISCOVERY = {
  phase2: {
    minPairAgeHours: 72,
    maxPairAgeHours: 1_440,

    minMarketCapUsd: 100_000,

    minVolume24hUsd: 1_000,
    minTransactions24h: 10,
  },

  phase3: {
    minPairAgeHours: 720,

    // No maximum age in the SRT (only a 720h minimum).
    maxPairAgeHours: undefined,

    // SRT 03:07:31: presenter caps Phase 3 discovery at $10M market cap —
    // upside above that isn't worth the risk. Personal preference, not law.
    maxMarketCapUsd: 10_000_000,

    minVolume24hUsd: 1_000,
    minTransactions24h: 10,
  },

  phase1: {
    migrated: {
      minMarketCapUsd: 90_000,
    },

    finalStretch: {
      minMarketCapUsd: 30_000,
    },

    newPair: {
      minMarketCapUsd: 8_000,
    },
  },
} as const;
