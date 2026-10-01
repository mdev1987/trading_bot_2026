/**
 * Historical execution-cost model. Flat per-side assumptions, stated
 * explicitly — NOT venue measurements and NOT a per-pool AMM model
 * (Meteora/fast pools cannot share one bps curve). Paper/live uses
 * real Jupiter quotes instead.
 */
export type HistoricalExecutionModel = "none" | "conservative" | "amm-stress";

export const HISTORICAL_EXECUTION_BPS: Record<HistoricalExecutionModel, number> = {
  none: 0,
  conservative: 75,
  "amm-stress": 250,
};

export interface BacktestConfig {
  startingBalanceSol: number;

  riskPerTradePct: number;

  minPositionSol: number;
  maxPositionSol: number;

  swingLookback: number;
  levelTolerancePct: number;

  supportTolerancePct: number;
  breakoutPct: number;

  /**
   * Number of candles used to build the rolling analysis window.
   *
   * Example:
   * 672 × 15m = 7 days.
   */
  analysisWindowCandles: number;

  /**
   * Temporary testing targets.
   *
   * These are NOT claimed to be SRT-mandated percentages.
   */
  targets: {
    id: string;
    profitPct: number;
    sellFraction: number;
  }[];

  /**
   * Per-side execution cost for historical fills. Applied to entry
   * notional and every exit proceed. 0 = raw strategy PnL.
   */
  costPerSideBps?: number;
}

export interface BacktestTrade {
  tokenAddress: string;
  poolAddress: string;

  entryTime: string;
  entryPrice: number;
  positionSol: number;

  initialStopPrice: number;

  exitTime: string | null;
  exitPrice: number | null;

  pnlSol: number;
  pnlPct: number;

  exitReason: string | null;

  partialExits: number;

  realizedPnlSol: number;

  maxPrice: number;

  barsHeld: number;
}

export interface BacktestResult {
  startingBalanceSol: number;
  endingBalanceSol: number;

  totalPnlSol: number;
  totalPnlPct: number;

  totalTrades: number;

  winningTrades: number;
  losingTrades: number;

  winRatePct: number;

  maxDrawdownSol: number;
  maxDrawdownPct: number;

  totalCostsSol: number;

  trades: BacktestTrade[];
}
