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

  /** ISO time of the entry candle. Structural failure only reacts to swings after this. */
  openedAt: string;

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

/** Price observed for one monitoring step. high/low default to price (closed-candle mode). */
export interface MonitorBar {
  price: number;
  high: number;
  low: number;
}

export function closeOnly(price: number): MonitorBar {
  return { price, high: price, low: price };
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

function structureHasFailed(analysis: StructureAnalysis, sinceTime: string): boolean {
  const since = Date.parse(sinceTime);
  const highs = analysis.market.swingHighs.filter(
    (p) => !Number.isFinite(since) || Date.parse(p.time) > since,
  );
  const lows = analysis.market.swingLows.filter(
    (p) => !Number.isFinite(since) || Date.parse(p.time) > since,
  );

  // Only structural changes occurring AFTER the entry can invalidate it.
  // An old failure pattern must never be read as a new failure.
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
   *
   * That is the structural change we want to
   * protect the remaining position from.
   */

  const failedHigh = lastHigh.price <= previousHigh.price;
  const brokenLow = lastLow.price < previousLow.price;

  return failedHigh && brokenLow;
}

export function managePosition(
  input: Position,
  market: MonitorBar,
  analysis: StructureAnalysis,
): PositionUpdate {
  // Pure: never mutate the caller's position. Callers commit the returned
  // position only after the corresponding execution succeeds, so a failed
  // quote can never leave strategy state ahead of account state.
  const position: Position = JSON.parse(JSON.stringify(input)) as Position;
  const actions: PositionAction[] = [];
  const { price, high, low } = market;

  if (position.status === "closed" || position.remainingSizeSol <= 0) {
    return { position, actions };
  }

  if (!Number.isFinite(price) || price <= 0) {
    actions.push({
      type: "hold",
      price,
      quantitySol: 0,
      newStopPrice: null,
      reason: "invalid-current-price",
    });

    return { position, actions };
  }

  /*
   * Track the highest observed price (intrabar high, not just close).
   */
  if (high > position.highestPrice) {
    position.highestPrice = high;
  }

  /*
   * 1. HARD STOP (stop-first: a bar touching both stop and target exits).
   * Fill conservatively at the worse of stop / price (gap-down fills at price).
   */
  if (low <= position.currentStopPrice) {
    const quantity = position.remainingSizeSol;

    position.remainingSizeSol = 0;
    position.status = "closed";

    const exitReason =
      position.currentStopPrice > position.entryPrice ? "trailing-stop-hit" : "stop-loss-hit";

    actions.push({
      type: "full-exit",
      price: Math.min(price, position.currentStopPrice),
      quantitySol: quantity,
      newStopPrice: null,
      reason: exitReason,
    });

    return { position, actions };
  }

  /*
   * 2. PROFIT TARGETS (intrabar high; fill at the better of trigger / price,
   * i.e. a wick through the target counts as a limit fill at the target).
   */
  for (const target of position.targets) {
    if (position.completedTargets.includes(target.id)) {
      continue;
    }

    if (high < target.triggerPrice) {
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

    const fillPrice = Math.max(target.triggerPrice, price);

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
      price: fillPrice,
      quantitySol: quantity,
      newStopPrice: null,
      reason: `profit-target:${target.id}`,
    });

    /*
     * The SRT raises the stop after taking partial profit.
     * Use the most recent confirmed swing low.
     */
    const latestLow = analysis.market.lastLow;

    if (latestLow && latestLow.price > position.currentStopPrice && latestLow.price < fillPrice) {
      const oldStop = position.currentStopPrice;

      if (moveStopUp(position, latestLow.price)) {
        actions.push({
          type: "stop-moved",
          price: fillPrice,
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
   * 3. TREND / PATTERN FAILURE (before trailing: a failed structure exits
   * without emitting a contradictory stop-move on the same step).
   */
  if (structureHasFailed(analysis, position.openedAt)) {
    const quantity = position.remainingSizeSol;

    position.remainingSizeSol = 0;
    position.status = "closed";

    actions.push({
      type: "full-exit",
      price,
      quantitySol: quantity,
      newStopPrice: null,
      reason: "market-structure-failure",
    });

    return { position, actions };
  }

  /*
   * 4. STRUCTURAL TRAILING STOP
   * On every new confirmed higher low, raise the stop.
   */
  const latestLow = analysis.market.lastLow;

  if (latestLow && latestLow.price > position.currentStopPrice && latestLow.price < price) {
    const oldStop = position.currentStopPrice;

    if (moveStopUp(position, latestLow.price)) {
      actions.push({
        type: "stop-moved",
        price,
        quantitySol: 0,
        newStopPrice: position.currentStopPrice,
        reason:
          `new-structural-low` +
          `:${oldStop.toFixed(8)}` +
          `->${position.currentStopPrice.toFixed(8)}`,
      });
    }
  }

  if (actions.length === 0) {
    actions.push({
      type: "hold",
      price,
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
  openedAt: string;
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

  if (!params.openedAt || !Number.isFinite(Date.parse(params.openedAt))) {
    throw new Error("Invalid openedAt");
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
    openedAt: params.openedAt,
    status: "open",
  };
}
