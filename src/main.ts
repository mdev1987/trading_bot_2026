import { DexPaprikaData } from "./dexpaprika";
import { getPoolCandles } from "./market/ohlcv";
import { runBacktest } from "./backtest/engine";
import { printBacktestReport } from "./backtest/report";
import type { BacktestConfig } from "./backtest/types";
import type { CandidateToken } from "./models";
import { strategyConfig, tradingConfig } from "./config";

const paprika = new DexPaprikaData();

const POOL_ADDRESS = "zxTpi4BtaWX3mgdAPoezkMD1hxx8CdeCfrqXMWvSCLX";
const TOKEN_ADDRESS = "6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx";

const backtestConfig: BacktestConfig = {
  startingBalanceSol: tradingConfig.accountBalanceSol,
  riskPerTradePct: tradingConfig.riskPerTradePct,
  minPositionSol: tradingConfig.minPositionSol,
  maxPositionSol: tradingConfig.maxPositionSol,
  swingLookback: strategyConfig.swingLookback,
  levelTolerancePct: strategyConfig.levelTolerancePct,
  supportTolerancePct: strategyConfig.supportTolerancePct,
  breakoutPct: strategyConfig.breakoutPct,
  analysisWindowCandles: strategyConfig.analysisWindowCandles,
  targets: strategyConfig.targets.map((t) => ({ ...t })),
};

async function main() {
  console.log("================================");
  console.log(" Module 10 - Paper Replay");
  console.log("================================");
  console.log(`Pool: ${POOL_ADDRESS}`);
  console.log("NOTE: rolling -7d technical test, not a performance claim.");

  const candles = await getPoolCandles(paprika, POOL_ADDRESS, {
    start: "-7d",
    interval: "15m",
    limit: 672,
    inversed: false,
  });

  console.log(`Candles: ${candles.length}`);

  if (candles.length === 0) {
    console.log("No candles.");
    return;
  }

  const token: CandidateToken = {
    network: paprika.network,
    poolAddress: POOL_ADDRESS,
    dexId: "meteora",
    dexName: "Meteora",
    tokenAddress: TOKEN_ADDRESS,
    tokenName: "STONK",
    tokenSymbol: "STONK",
    tokenAddedAt: null,
    priceUsd: null,
    marketCapUsd: null,
    fdvUsd: null,
    totalSupply: null,
    liquidityUsd: null,
    poolCreatedAt: candles[0]!.timeOpen,
    volume24hUsd: null,
    transactions24h: null,
    priceChange5m: null,
    priceChange1h: null,
    priceChange6h: null,
    priceChange24h: null,
  };

  const result = runBacktest(token, candles, backtestConfig);

  printBacktestReport(result);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
