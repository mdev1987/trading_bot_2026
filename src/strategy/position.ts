import type { StructureAnalysis } from "./structure";

export type PositionStatus = "open" | "partially-closed" | "closed";

export type PositionActionType =
  | "partial-take-profit"
  | "stop-moved"
  | "full-exit"
  | "hold";

export interface ProfitTarget {
  id: string;

  /**
   * Price at which this target becomes executable.
   *
   * For now this is a price supplied by the strategy.
   * Later we can derive it from psychological market-cap
   * targets once real market-cap data is available.
   */
  triggerPrice: number;

  /**
   * Fraction of the ORIGINAL position to sell.
   *
   * Example: 0.25 = sell 25%.
   *
   * This is an engineering configuration, not an
   * SRT-specified percentage.
   */
  sellFraction: number;
}

export interface Position {
  tokenAddress: string;
  poolAddress: string;

  entryPrice: number;
  originalSizeSol: number;

  remainingSizeSol: number;

  initialStopPrice: number;
  currentStopPrice: number;

  highestPrice: number;

  targets: ProfitTarget[];
  completedTargets: string[];

  status: PositionStatus;
}

export interface PositionAction {
  type: PositionActionType;
  price: number;
  quantitySol: number;
  newStopPrice: number | null;
  reason: string;
}

export interface PositionUpdate {
  position: Position;
  actions: PositionAction[];
}

function moveStopUp(position: Position, newStopPrice: number): boolean {
  if (!Number.isFinite(newStopPrice) || newStopPrice <= 0) {
    return false;
  }

  if (newStopPrice <= position.currentStopPrice) {
    return false;
  }

  if (newStopPrice >= position.highestPrice) {
    return false;
  }

  position.currentStopPrice = newStopPrice;

  return true;
}

function structureHasFailed(analysis: StructureAnalysis): boolean {
  const highs = analysis.market.swingHighs;
  const lows = analysis.market.swingLows;

  if (highs.length < 2 || lows.length < 2) {
    return false;
  }

  const previousHigh = highs.at(-2);
  const lastHigh = highs.at(-1);
  const previousLow = lows.at(-2);
  const lastLow = lows.at(-1);

  if (!previousHigh || !lastHigh || !previousLow || !lastLow) {
    return false;
  }

  /*
   * We want:
   *
   * 1. Latest high failed to exceed previous high.
   * 2. Latest low broke below previous low.
   */

  const failedHigh = lastHigh.price <= previousHigh.price;
  const brokenLow = lastLow.price < previousLow.price;

  return failedHigh && brokenLow;
}

export function managePosition(
  position: Position,
  currentPrice: number,
  analysis: StructureAnalysis,
): PositionUpdate {
  const actions: PositionAction[] = [];

  if (position.status === "closed" || position.remainingSizeSol <= 0) {
    return { position, actions };
  }

  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    actions.push({
      type: "hold",
      price: currentPrice,
      quantitySol: 0,
      newStopPrice: null,
      reason: "invalid-current-price",
    });

    return { position, actions };
  }

  /*
   * Track the highest observed price.
   */
  if (currentPrice > position.highestPrice) {
    position.highestPrice = currentPrice;
  }

  /*
   * 1. HARD STOP
   */
  if (currentPrice <= position.currentStopPrice) {
    const quantity = position.remainingSizeSol;

    position.remainingSizeSol = 0;
    position.status = "closed";

    const exitReason =
      position.currentStopPrice > position.entryPrice ? "trailing-stop-hit" : "stop-loss-hit";

    actions.push({
      type: "full-exit",
      price: currentPrice,
      quantitySol: quantity,
      newStopPrice: null,
      reason: exitReason,
    });

    return { position, actions };
  }

  /*
   * 2. PROFIT TARGETS
   */
  for (const target of position.targets) {
    if (position.completedTargets.includes(target.id)) {
      continue;
    }

    if (currentPrice < target.triggerPrice) {
      continue;
    }

    if (target.sellFraction <= 0 || target.sellFraction > 1) {
      continue;
    }

    const quantity = Math.min(
      position.originalSizeSol * target.sellFraction,
      position.remainingSizeSol,
    );

    if (quantity <= 0) {
      continue;
    }

    position.remainingSizeSol -= quantity;
    position.completedTargets.push(target.id);

    if (position.remainingSizeSol <= 0) {
      position.remainingSizeSol = 0;
      position.status = "closed";
    } else {
      position.status = "partially-closed";
    }

    actions.push({
      type: "partial-take-profit",
      price: currentPrice,
      quantitySol: quantity,
      newStopPrice: null,
      reason: `profit-target:${target.id}`,
    });

    /*
     * The SRT raises the stop after taking partial profit.
     * Use the most recent confirmed swing low.
     */
    const latestLow = analysis.market.lastLow;

    if (
      latestLow &&
      latestLow.price > position.currentStopPrice &&
      latestLow.price < currentPrice
    ) {
      const oldStop = position.currentStopPrice;

      if (moveStopUp(position, latestLow.price)) {
        actions.push({
          type: "stop-moved",
          price: currentPrice,
          quantitySol: 0,
          newStopPrice: position.currentStopPrice,
          reason:
            `new-structural-low-after-${target.id}` +
            `:${oldStop.toFixed(8)}` +
            `->${position.currentStopPrice.toFixed(8)}`,
        });
      }
    }
  }

  if (position.status === "closed" || position.remainingSizeSol <= 0) {
    return { position, actions };
  }

  /*
   * 3. STRUCTURAL TRAILING STOP
   * On every new confirmed higher low, raise the stop.
   */
  const latestLow = analysis.market.lastLow;

  if (
    latestLow &&
    latestLow.price > position.currentStopPrice &&
    latestLow.price < currentPrice
  ) {
    const oldStop = position.currentStopPrice;

    if (moveStopUp(position, latestLow.price)) {
      actions.push({
        type: "stop-moved",
        price: currentPrice,
        quantitySol: 0,
        newStopPrice: position.currentStopPrice,
        reason:
          `new-structural-low` +
          `:${oldStop.toFixed(8)}` +
          `->${position.currentStopPrice.toFixed(8)}`,
      });
    }
  }

  /*
   * 4. TREND / PATTERN FAILURE
   */
  if (structureHasFailed(analysis)) {
    const quantity = position.remainingSizeSol;

    position.remainingSizeSol = 0;
    position.status = "closed";

    actions.push({
      type: "full-exit",
      price: currentPrice,
      quantitySol: quantity,
      newStopPrice: null,
      reason: "market-structure-failure",
    });

    return { position, actions };
  }

  if (actions.length === 0) {
    actions.push({
      type: "hold",
      price: currentPrice,
      quantitySol: 0,
      newStopPrice: null,
      reason: "position-healthy",
    });
  }

  return { position, actions };
}

export function createPosition(params: {
  tokenAddress: string;
  poolAddress: string;
  entryPrice: number;
  positionSol: number;
  stopPrice: number;
  targets: ProfitTarget[];
}): Position {
  if (!Number.isFinite(params.entryPrice) || params.entryPrice <= 0) {
    throw new Error("Invalid entry price");
  }

  if (!Number.isFinite(params.stopPrice) || params.stopPrice <= 0) {
    throw new Error("Invalid stop price");
  }

  if (params.stopPrice >= params.entryPrice) {
    throw new Error("Stop must be below entry");
  }

  if (!Number.isFinite(params.positionSol) || params.positionSol <= 0) {
    throw new Error("Invalid position size");
  }

  return {
    tokenAddress: params.tokenAddress,
    poolAddress: params.poolAddress,
    entryPrice: params.entryPrice,
    originalSizeSol: params.positionSol,
    remainingSizeSol: params.positionSol,
    initialStopPrice: params.stopPrice,
    currentStopPrice: params.stopPrice,
    highestPrice: params.entryPrice,
    targets: params.targets,
    completedTargets: [],
    status: "open",
  };
}
