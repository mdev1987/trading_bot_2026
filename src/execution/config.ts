import type { ExecutionConfig } from "./simulator";

export const executionConfig: ExecutionConfig = {
  // Test assumptions only.
  feeBps: 40,
  slippageBps: 20,

  // 1% of liquidity => +10 bps modeled impact.
  liquidityImpactBpsPerPct: 10,

  // Prevent unrealistic impact from exploding.
  maxLiquidityImpactBps: 150,
} as const;
