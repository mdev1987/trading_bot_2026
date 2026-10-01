import type { Candle } from "../market/ohlcv";

export interface SwingPoint {
  index: number;
  time: string;
  price: number;
  type: "high" | "low";
}

export type Trend = "uptrend" | "downtrend" | "sideways" | "unknown";

export interface MarketStructure {
  trend: Trend;

  swingHighs: SwingPoint[];
  swingLows: SwingPoint[];

  lastHigh: SwingPoint | null;
  previousHigh: SwingPoint | null;

  lastLow: SwingPoint | null;
  previousLow: SwingPoint | null;
}

export function detectSwingPoints(candles: Candle[], lookback = 2): SwingPoint[] {
  const points: SwingPoint[] = [];

  if (candles.length < lookback * 2 + 1) {
    return points;
  }

  for (let i = lookback; i < candles.length - lookback; i++) {
    const current = candles[i]!;

    let isHigh = true;
    let isLow = true;

    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) {
        continue;
      }

      if (candles[j]!.high >= current.high) {
        isHigh = false;
      }

      if (candles[j]!.low <= current.low) {
        isLow = false;
      }
    }

    if (isHigh) {
      points.push({
        index: i,
        time: current.timeClose,
        price: current.high,
        type: "high",
      });
    }

    if (isLow) {
      points.push({
        index: i,
        time: current.timeClose,
        price: current.low,
        type: "low",
      });
    }
  }

  return points;
}

export function classifyHighs(highs: SwingPoint[]): {
  point: SwingPoint;
  classification: "higher-high" | "lower-high" | "equal-high";
}[] {
  const result: {
    point: SwingPoint;
    classification: "higher-high" | "lower-high" | "equal-high";
  }[] = [];

  for (let i = 1; i < highs.length; i++) {
    const previous = highs[i - 1]!;
    const current = highs[i]!;

    let classification: "higher-high" | "lower-high" | "equal-high";

    if (current.price > previous.price) {
      classification = "higher-high";
    } else if (current.price < previous.price) {
      classification = "lower-high";
    } else {
      classification = "equal-high";
    }

    result.push({
      point: current,
      classification,
    });
  }

  return result;
}

export function classifyLows(lows: SwingPoint[]): {
  point: SwingPoint;
  classification: "higher-low" | "lower-low" | "equal-low";
}[] {
  const result: {
    point: SwingPoint;
    classification: "higher-low" | "lower-low" | "equal-low";
  }[] = [];

  for (let i = 1; i < lows.length; i++) {
    const previous = lows[i - 1]!;
    const current = lows[i]!;

    let classification: "higher-low" | "lower-low" | "equal-low";

    if (current.price > previous.price) {
      classification = "higher-low";
    } else if (current.price < previous.price) {
      classification = "lower-low";
    } else {
      classification = "equal-low";
    }

    result.push({
      point: current,
      classification,
    });
  }

  return result;
}

export function classifyTrend(highs: SwingPoint[], lows: SwingPoint[]): Trend {
  if (highs.length < 2 || lows.length < 2) {
    return "unknown";
  }

  const previousHigh = highs[highs.length - 2]!;
  const lastHigh = highs[highs.length - 1]!;

  const previousLow = lows[lows.length - 2]!;
  const lastLow = lows[lows.length - 1]!;

  const higherHigh = lastHigh.price > previousHigh.price;
  const higherLow = lastLow.price > previousLow.price;

  const lowerHigh = lastHigh.price < previousHigh.price;
  const lowerLow = lastLow.price < previousLow.price;

  if (higherHigh && higherLow) {
    return "uptrend";
  }

  if (lowerHigh && lowerLow) {
    return "downtrend";
  }

  return "sideways";
}

export function analyzeStructure(candles: Candle[], swingLookback = 2): MarketStructure {
  const points = detectSwingPoints(candles, swingLookback);

  const swingHighs = points.filter((point) => point.type === "high");
  const swingLows = points.filter((point) => point.type === "low");

  return {
    trend: classifyTrend(swingHighs, swingLows),

    swingHighs,
    swingLows,

    lastHigh: swingHighs.at(-1) ?? null,
    previousHigh: swingHighs.at(-2) ?? null,

    lastLow: swingLows.at(-1) ?? null,
    previousLow: swingLows.at(-2) ?? null,
  };
}

export interface PriceLevel {
  price: number;
  touches: number;
  firstIndex: number;
  lastIndex: number;
}

export function findLevels(
  candles: Candle[],
  swingLookback = 2,
  tolerancePct = 0.75,
  minTouches = 2,
): PriceLevel[] {
  const points = detectSwingPoints(candles, swingLookback);

  const levels: PriceLevel[] = [];

  for (const point of points) {
    const existing = levels.find((level) => {
      const tolerance = (level.price * tolerancePct) / 100;

      return Math.abs(level.price - point.price) <= tolerance;
    });

    if (!existing) {
      levels.push({
        price: point.price,
        touches: 1,
        firstIndex: point.index,
        lastIndex: point.index,
      });

      continue;
    }

    // Do not count nearby pivots as separate reactions.
    // Require some temporal separation.
    const minSeparation = swingLookback * 2 + 1;

    if (point.index - existing.lastIndex < minSeparation) {
      continue;
    }

    existing.price = (existing.price * existing.touches + point.price) / (existing.touches + 1);

    existing.touches += 1;
    existing.lastIndex = point.index;
  }

  return levels
    .filter((level) => level.touches >= minTouches)
    .sort((a, b) => b.touches - a.touches);
}

export interface StructureAnalysis {
  market: MarketStructure;

  currentPrice: number;

  levels: PriceLevel[];

  supports: PriceLevel[];
  resistances: PriceLevel[];
}

export function analyzeMarket(
  candles: Candle[],
  currentPrice: number,
  swingLookback = 2,
  levelTolerancePct = 0.75,
): StructureAnalysis {
  const market = analyzeStructure(candles, swingLookback);
  const levels = findLevels(candles, swingLookback, levelTolerancePct, 2);

  const supports = levels.filter((level) => level.price < currentPrice);
  const resistances = levels.filter((level) => level.price > currentPrice);

  return {
    market,
    currentPrice,
    levels,
    supports,
    resistances,
  };
}
