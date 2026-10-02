export const safetyConfig = {
  /**
   * Unknown safety data must not produce a BUY.
   */
  unknownDecision: "watch" as const,

  /**
   * These are warning levels based on the course's
   * examples/context, not universal safety laws.
   */
  top10HolderWarnPct: 30,
  insiderWarnPct: 40,

  /**
   * The course does not give a deterministic bundle
   * threshold, so bundles are informational until we
   * have a richer detector.
   */
  bundlesHardLimitPct: null,

  /**
   * A single holder with an unusually large share
   * deserves a warning.
   */
  largestHolderWarnPct: 10,
} as const;
