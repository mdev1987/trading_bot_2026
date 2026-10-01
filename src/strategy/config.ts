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

    // No maximum age in the SRT.
    maxPairAgeHours: undefined,

    minMarketCapUsd: undefined,

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
