import type { SetupSignal } from "./setup";

export type EntryStatus = "not-ready" | "ready" | "invalid";

export interface EntryOptions {
  /**
   * Maximum amount of account equity that may be lost
   * if the structural stop is reached.
   *
   * This is an engineering parameter, not a claim
   * that the SRT mandates a particular percentage.
   */
  riskPerTradePct: number;

  /**
   * Hard maximum position size in SOL.
   */
  maxPositionSol: number;

  /**
   * Minimum position size in SOL.
   */
  minPositionSol: number;
}

export interface EntryDecision {
  status: EntryStatus;

  entryPrice: number;
  stopPrice: number;

  stopDistancePct: number;

  riskBudgetSol: number;

  rawPositionSol: number;
  positionSol: number;

  estimatedRiskSol: number;

  triggerPrice: number | null;

  setupType: SetupSignal["type"];

  reasons: string[];
}

function validPositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function createEntryDecision(
  setup: SetupSignal,
  accountBalanceSol: number,
  options: EntryOptions,
): EntryDecision {
  const reasons: string[] = [];

  const entryPrice = setup.price;
  const stopPrice = setup.invalidationPrice;

  const baseResult: EntryDecision = {
    status: "invalid",

    entryPrice,
    stopPrice: stopPrice ?? 0,

    stopDistancePct: 0,

    riskBudgetSol: 0,

    rawPositionSol: 0,
    positionSol: 0,

    estimatedRiskSol: 0,

    triggerPrice: setup.triggerPrice,

    setupType: setup.type,

    reasons,
  };

  if (!validPositive(entryPrice)) {
    reasons.push("invalid-entry-price");
    return baseResult;
  }

  if (!validPositive(accountBalanceSol)) {
    reasons.push("invalid-account-balance");
    return baseResult;
  }

  if (!validPositive(options.riskPerTradePct)) {
    reasons.push("invalid-risk-per-trade");
    return baseResult;
  }

  if (!validPositive(options.maxPositionSol)) {
    reasons.push("invalid-max-position");
    return baseResult;
  }

  if (!validPositive(options.minPositionSol)) {
    reasons.push("invalid-min-position");
    return baseResult;
  }

  if (!validPositive(stopPrice ?? 0)) {
    reasons.push("missing-invalidation-price");
    return baseResult;
  }

  if (stopPrice! >= entryPrice) {
    reasons.push("stop-not-below-entry");
    return baseResult;
  }

  const stopDistance = (entryPrice - stopPrice!) / entryPrice;
  const stopDistancePct = stopDistance * 100;

  if (!(stopDistance > 0)) {
    reasons.push("invalid-stop-distance");
    return baseResult;
  }

  const riskBudgetSol = accountBalanceSol * (options.riskPerTradePct / 100);

  if (!(riskBudgetSol > 0)) {
    reasons.push("zero-risk-budget");
    return baseResult;
  }

  /*
   * Position size such that:
   *
   * position × stop-distance = risk budget
   */
  const rawPositionSol = riskBudgetSol / stopDistance;

  if (rawPositionSol < options.minPositionSol) {
    reasons.push("position-below-minimum");

    return {
      ...baseResult,
      stopDistancePct,
      riskBudgetSol,
      rawPositionSol,
      reasons,
    };
  }

  const positionSol = Math.min(rawPositionSol, options.maxPositionSol, accountBalanceSol);

  if (positionSol < options.minPositionSol) {
    reasons.push("clamped-position-below-minimum");

    return {
      ...baseResult,
      stopDistancePct,
      riskBudgetSol,
      rawPositionSol,
      positionSol,
      reasons,
    };
  }

  const estimatedRiskSol = positionSol * stopDistance;

  reasons.push("valid-entry");
  reasons.push("structural-stop-valid");

  if (positionSol < rawPositionSol) {
    reasons.push("position-size-capped");
  }

  return {
    status: "ready",

    entryPrice,
    stopPrice: stopPrice!,

    stopDistancePct,

    riskBudgetSol,

    rawPositionSol,
    positionSol,

    estimatedRiskSol,

    triggerPrice: setup.triggerPrice,

    setupType: setup.type,

    reasons,
  };
}
