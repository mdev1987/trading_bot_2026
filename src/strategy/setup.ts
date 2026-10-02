import type { StructureAnalysis, SwingPoint } from "./structure";

export type SetupType = "bullish-reversal" | "bullish-continuation" | "range-break";

export type SetupStatus = "watch" | "confirmed" | "none";

export interface SetupSignal {
  type: SetupType;
  status: SetupStatus;

  price: number;

  structuralHighPrice: number | null;
  triggerPrice: number | null;
  invalidationPrice: number | null;

  supportPrice: number | null;
  resistancePrice: number | null;

  reason: string[];
}

export interface SetupOptions {
  /**
   * Maximum distance from current price to a support level.
   */
  supportTolerancePct?: number;

  /**
   * Percentage above the structural high required
   * to consider the previous high broken.
   */
  breakoutPct?: number;

  /**
   * Sideways range-break entries (default true). Kill-switch for
   * isolating the reversal/continuation baseline in backtests and
   * for disabling the noisier setup live without a code change.
   */
  enableRangeBreak?: boolean;
}

function isNear(price: number, level: number, tolerancePct: number): boolean {
  if (price <= 0 || level <= 0) {
    return false;
  }

  const distancePct = (Math.abs(price - level) / level) * 100;

  return distancePct <= tolerancePct;
}

function hasBrokenHigh(price: number, high: SwingPoint | null, breakoutPct: number): boolean {
  if (!high || price <= 0) {
    return false;
  }

  const trigger = high.price * (1 + breakoutPct / 100);

  return price >= trigger;
}

export function detectSetup(analysis: StructureAnalysis, options: SetupOptions = {}): SetupSignal {
  const supportTolerancePct = options.supportTolerancePct ?? 1.0;
  const breakoutPct = options.breakoutPct ?? 0.25;
  const enableRangeBreak = options.enableRangeBreak ?? true;

  const price = analysis.currentPrice;

  const result: SetupSignal = {
    type: "bullish-reversal",
    status: "none",

    price,

    structuralHighPrice: null,
    triggerPrice: null,
    invalidationPrice: null,

    supportPrice: null,
    resistancePrice: null,

    reason: [],
  };

  if (!Number.isFinite(price)) {
    result.reason.push("invalid-current-price");
    return result;
  }

  const highs = analysis.market.swingHighs;
  const lows = analysis.market.swingLows;

  if (highs.length < 2 || lows.length < 2) {
    result.reason.push("insufficient-swing-data");
    return result;
  }

  const previousHigh = highs.at(-2) ?? null;
  const lastHigh = highs.at(-1) ?? null;
  const previousLow = lows.at(-2) ?? null;
  const lastLow = lows.at(-1) ?? null;

  const nearestSupport = analysis.supports.at(0) ?? null;
  const nearestResistance = analysis.resistances.at(0) ?? null;

  result.supportPrice = nearestSupport?.price ?? null;
  result.resistancePrice = nearestResistance?.price ?? null;

  /*
   * BULLISH REVERSAL
   * Weak/down structure -> higher low -> break previous high = confirmed.
   * A higher low that fails and breaks the prior low = back to downtrend.
   */
  const previousHighLower =
    previousHigh !== null && lastHigh !== null && lastHigh.price < previousHigh.price;

  const lastLowHigher =
    previousLow !== null && lastLow !== null && lastLow.price > previousLow.price;

  const nearSupport =
    lastLow !== null &&
    nearestSupport !== null &&
    isNear(lastLow.price, nearestSupport.price, supportTolerancePct);

  const reversalStructure =
    (analysis.market.trend === "downtrend" || previousHighLower) && lastLowHigher;

  if (reversalStructure) {
    result.type = "bullish-reversal";
    result.invalidationPrice = lastLow?.price ?? null;
    result.structuralHighPrice = lastHigh?.price ?? null;
    result.triggerPrice = lastHigh ? lastHigh.price * (1 + breakoutPct / 100) : null;

    result.reason.push("weak-or-downtrend-structure");
    result.reason.push("higher-low-formed");

    if (nearSupport) {
      result.reason.push("higher-low-near-support");
    }

    if (hasBrokenHigh(price, lastHigh, breakoutPct)) {
      result.status = "confirmed";
      result.reason.push("previous-high-broken");
    } else {
      result.status = "watch";
      result.reason.push("waiting-for-previous-high-break");
    }

    return result;
  }

  /*
   * BULLISH CONTINUATION
   * Uptrend + higher low + break recent high = continuation.
   */
  const uptrend = analysis.market.trend === "uptrend";
  const continuationStructure = uptrend && lastLowHigher;

  if (continuationStructure) {
    result.type = "bullish-continuation";
    result.invalidationPrice = lastLow?.price ?? null;
    result.structuralHighPrice = lastHigh?.price ?? null;
    result.triggerPrice = lastHigh ? lastHigh.price * (1 + breakoutPct / 100) : null;

    result.reason.push("uptrend");
    result.reason.push("higher-low-formed");

    if (nearSupport) {
      result.reason.push("higher-low-near-support");
    }

    if (hasBrokenHigh(price, lastHigh, breakoutPct)) {
      result.status = "confirmed";
      result.reason.push("previous-high-broken");
    } else {
      result.status = "watch";
      result.reason.push("waiting-for-continuation-break");
    }

    return result;
  }

  /*
   * RANGE BREAK (sideways markets only)
   * No trend to continue or reverse — trade the range edge instead:
   * a genuine level (2+ touches, built by findLevels) broken by
   * breakoutPct, stop under the range floor. Same confirmation and
   * structural sizing as every other setup; whipsaw risk is higher
   * by construction, which is why the level-touches requirement and
   * the paper size policy exist.
   */
  if (enableRangeBreak && analysis.market.trend === "sideways" && nearestResistance !== null) {
    const rangeHigh = nearestResistance.price;
    const rangeLow =
      nearestSupport !== null && nearestSupport.price < rangeHigh
        ? nearestSupport.price
        : (lastLow?.price ?? null);
    if (rangeLow !== null && rangeLow < price) {
      result.type = "range-break";
      result.invalidationPrice = rangeLow;
      result.structuralHighPrice = rangeHigh;
      result.triggerPrice = rangeHigh * (1 + breakoutPct / 100);

      result.reason.push("sideways-range");
      result.reason.push(`resistance-tested-${nearestResistance.touches}x`);

      if (price >= result.triggerPrice) {
        result.status = "confirmed";
        result.reason.push("range-high-broken");
      } else {
        result.status = "watch";
        result.reason.push("waiting-for-range-break");
      }

      return result;
    }
  }

  result.reason.push("no-long-setup");

  return result;
}
