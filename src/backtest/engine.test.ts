import { describe, expect, test } from "bun:test";
import { runBacktest } from "./engine";
import type { BacktestConfig } from "./types";
import type { Candle } from "../market/ohlcv";
import type { CandidateToken } from "../models";

const T0 = Date.parse("2026-01-01T00:00:00Z");
const iso = (i: number): string => new Date(T0 + i * 900_000).toISOString();

function candlesFromCloses(closes: number[]): Candle[] {
  return closes.map((c, i) => ({
    timeOpen: iso(i),
    timeClose: iso(i + 1),
    open: c * 0.999,
    high: c * 1.0015,
    low: c * 0.9985,
    close: c,
    volume: 1000,
  }));
}

const token: CandidateToken = {
  network: "solana",
  poolAddress: "POOL",
  dexId: "dex",
  dexName: "DEX",
  tokenAddress: "MINT",
  tokenName: "T",
  tokenSymbol: "T",
  tokenAddedAt: null,
  priceUsd: null,
  marketCapUsd: null,
  fdvUsd: null,
  totalSupply: null,
  liquidityUsd: null,
  poolCreatedAt: iso(0),
  volume24hUsd: null,
  transactions24h: null,
  priceChange5m: null,
  priceChange1h: null,
  priceChange6h: null,
  priceChange24h: null,
};

const config: BacktestConfig = {
  startingBalanceSol: 1.0,
  riskPerTradePct: 1.0,
  minPositionSol: 0.02,
  maxPositionSol: 0.1,
  swingLookback: 2,
  levelTolerancePct: 2,
  supportTolerancePct: 5,
  breakoutPct: 0.25,
  analysisWindowCandles: 672,
  targets: [{ id: "tp1", profitPct: 25, sellFraction: 0.25 }],
};

describe("backtest ledger integrity", () => {
  test("steady climb produces trades with consistent PnL accounting", () => {
    // Drift + oscillation: pivots form HH/HL so continuation setups trigger.
    const closes: number[] = [];
    let p = 1;
    for (let i = 0; i < 80; i++) {
      p *= 1.003;
      closes.push(p * (1 + 0.02 * Math.sin(i)));
    }
    const result = runBacktest(token, candlesFromCloses(closes), config);
    expect(result.totalTrades).toBeGreaterThan(0);
    const sum = result.trades.reduce((a, t) => a + t.pnlSol, 0);
    expect(Math.abs(result.totalPnlSol - sum)).toBeLessThan(1e-9);
    expect(result.endingBalanceSol).toBeCloseTo(1 + sum, 9);
  });

  test("no trade re-enters on its own exit candle", () => {
    const closes: number[] = [];
    let p = 1;
    for (let i = 0; i < 80; i++) {
      p *= 1.003 * (1 + 0.02 * Math.sin(i)) * (i % 20 === 19 ? 0.94 : 1);
      closes.push(p);
    }
    const result = runBacktest(token, candlesFromCloses(closes), config);
    const exits = new Set(
      result.trades.filter((t) => t.exitReason !== "end-of-data").map((t) => t.exitTime),
    );
    for (const t of result.trades) {
      expect(exits.has(t.entryTime) && t.exitReason !== "end-of-data").toBe(false);
    }
  });

  test("flat market yields no trades and zero drawdown", () => {
    const result = runBacktest(token, candlesFromCloses(new Array(60).fill(1)), config);
    expect(result.totalTrades).toBe(0);
    expect(result.maxDrawdownSol).toBe(0);
  });

  test("execution costs only drag PnL, never create it", () => {
    const closes: number[] = [];
    let p = 1;
    for (let i = 0; i < 80; i++) {
      p *= 1.003;
      closes.push(p * (1 + 0.02 * Math.sin(i)));
    }
    const candles = candlesFromCloses(closes);
    const raw = runBacktest(token, candles, { ...config, costPerSideBps: 0 });
    const stressed = runBacktest(token, candles, { ...config, costPerSideBps: 250 });
    expect(raw.totalTrades).toBeGreaterThan(0);
    expect(stressed.totalCostsSol).toBeGreaterThan(0);
    expect(stressed.totalPnlSol).toBeLessThan(raw.totalPnlSol);
  });
});
