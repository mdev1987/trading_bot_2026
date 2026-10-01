import type { ExecutionConfig } from "./simulator";

export const executionConfig: ExecutionConfig = {
  // Test assumptions only.
  feeBps: 40,
  slippageBps: 20,

  // Constant-product math: trading 1% of pool reserves moves the
  // effective price ~1% (~100 bps). The old value of 10 understated
  // small-pool costs ~10x. Still a test assumption, not a venue claim —
  // historical replay only, never the paper/live path.
  liquidityImpactBpsPerPct: 100,

  // Prevent unrealistic impact from exploding.
  maxLiquidityImpactBps: 150,
} as const;
