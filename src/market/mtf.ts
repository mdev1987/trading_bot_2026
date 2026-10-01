import type { DexPaprikaData } from "../dexpaprika";
import { getPoolCandles } from "./ohlcv";
import { analyzeMarket, type StructureAnalysis } from "../strategy/structure";

/**
 * Multi-timeframe market context (course stresses timeframe matters and
 * shows 1m/5m/15m/1h charts; exact role mapping is a backtest hypothesis,
 * not an SRT rule).
 *
 * Roles used for display/context only — the strategy still trades the
 * 15m primary structure until MTF-gated entries are validated:
 *   5m  → entry structure
 *   15m → primary structure (strategy timeframe)
 *   1h  → broader trend/context
 */
export interface MarketContext {
  m5: StructureAnalysis;
  m15: StructureAnalysis;
  h1: StructureAnalysis;
}

export async function getMarketContext(
  paprika: DexPaprikaData,
  poolAddress: string,
  swingLookback: number,
  levelTolerancePct: number,
): Promise<MarketContext> {
  const [m5, m15, h1] = await Promise.all([
    getPoolCandles(paprika, poolAddress, { start: "-2d", interval: "5m", limit: 200 }),
    getPoolCandles(paprika, poolAddress, { start: "-7d", interval: "15m", limit: 200 }),
    getPoolCandles(paprika, poolAddress, { start: "-7d", interval: "1h", limit: 200 }),
  ]);

  const analyze = (candles: Awaited<ReturnType<typeof getPoolCandles>>) => {
    const last = candles.at(-1);
    if (!last || candles.length < 20) {
      throw new Error("Insufficient candles for timeframe context");
    }
    return analyzeMarket(candles, last.close, swingLookback, levelTolerancePct);
  };

  return { m5: analyze(m5), m15: analyze(m15), h1: analyze(h1) };
}

export function formatMarketContext(ctx: MarketContext): string {
  return `MTF 5m:${ctx.m5.market.trend} 15m:${ctx.m15.market.trend} 1h:${ctx.h1.market.trend}`;
}
