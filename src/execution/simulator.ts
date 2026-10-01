export type ExecutionSide = "buy" | "sell";

export interface ExecutionConfig {
  /**
   * Trading fee charged on each side.
   * Example: 40 bps = 0.40%.
   *
   * This is an engineering assumption for simulation,
   * not a claim about a particular venue.
   */
  feeBps: number;

  /**
   * Base slippage applied to every fill.
   *
   * Example: 20 bps = 0.20%.
   */
  slippageBps: number;

  /**
   * Liquidity-impact model.
   *
   * Example:
   * liquidityImpactBpsPerPct = 10
   *
   * If the trade is 1% of available liquidity,
   * the model adds 10 bps of impact.
   */
  liquidityImpactBpsPerPct: number;

  /**
   * Hard cap on modeled liquidity impact.
   */
  maxLiquidityImpactBps: number;
}

export interface FillRequest {
  side: ExecutionSide;

  /**
   * Reference market price of the token.
   */
  priceUsd: number;

  /**
   * Trade size in SOL.
   */
  notionalSol: number;

  /**
   * SOL/USD conversion used for this historical/live snapshot.
   *
   * For historical replay this should eventually come
   * from historical data rather than a fixed constant.
   */
  solPriceUsd: number;

  /**
   * Estimated available liquidity in USD.
   *
   * For the first backtest integration this may be a
   * configured estimate. Historical liquidity should be
   * added later when available.
   */
  liquidityUsd: number;
}

export interface FillResult {
  side: ExecutionSide;
  referencePriceUsd: number;
  fillPriceUsd: number;
  notionalSol: number;
  notionalUsd: number;
  feeSol: number;
  baseSlippageBps: number;
  liquidityImpactBps: number;
  totalPriceImpactBps: number;
  effectiveCostSol: number;
}

function validatePositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be > 0`);
  }
}

export class ExecutionSimulator {
  constructor(private readonly config: ExecutionConfig) {
    if (config.feeBps < 0) {
      throw new Error("feeBps must be >= 0");
    }
    if (config.slippageBps < 0) {
      throw new Error("slippageBps must be >= 0");
    }
    if (config.liquidityImpactBpsPerPct < 0) {
      throw new Error("liquidityImpactBpsPerPct must be >= 0");
    }
    if (config.maxLiquidityImpactBps < 0) {
      throw new Error("maxLiquidityImpactBps must be >= 0");
    }
  }

  simulateFill(request: FillRequest): FillResult {
    validatePositive(request.priceUsd, "priceUsd");
    validatePositive(request.notionalSol, "notionalSol");
    validatePositive(request.solPriceUsd, "solPriceUsd");
    validatePositive(request.liquidityUsd, "liquidityUsd");

    const notionalUsd = request.notionalSol * request.solPriceUsd;
    const liquiditySharePct = (notionalUsd / request.liquidityUsd) * 100;

    const rawLiquidityImpactBps = liquiditySharePct * this.config.liquidityImpactBpsPerPct;

    const liquidityImpactBps = Math.min(rawLiquidityImpactBps, this.config.maxLiquidityImpactBps);

    const totalPriceImpactBps = this.config.slippageBps + liquidityImpactBps;
    const impactFraction = totalPriceImpactBps / 10_000;

    const fillPriceUsd =
      request.side === "buy"
        ? request.priceUsd * (1 + impactFraction)
        : request.priceUsd * (1 - impactFraction);

    const feeSol = request.notionalSol * (this.config.feeBps / 10_000);
    const effectiveCostSol = feeSol + request.notionalSol * (totalPriceImpactBps / 10_000);

    return {
      side: request.side,
      referencePriceUsd: request.priceUsd,
      fillPriceUsd,
      notionalSol: request.notionalSol,
      notionalUsd,
      feeSol,
      baseSlippageBps: this.config.slippageBps,
      liquidityImpactBps,
      totalPriceImpactBps,
      effectiveCostSol,
    };
  }
}
