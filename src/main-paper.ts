import { LivePaperLoop } from "./paper/live-loop";
import { config, strategyConfig, tradingConfig } from "./config";
import { paperConfig } from "./paper/config";

const loop = new LivePaperLoop(
  {
    poolAddress: paperConfig.poolAddress,
    tokenMint: paperConfig.tokenMint,
    solMint: paperConfig.solMint,
    startingBalanceSol: tradingConfig.accountBalanceSol,
    maxPositionSol: tradingConfig.maxPositionSol,
    minPositionSol: tradingConfig.minPositionSol,
    riskPerTradePct: tradingConfig.riskPerTradePct,
    swingLookback: strategyConfig.swingLookback,
    levelTolerancePct: strategyConfig.levelTolerancePct,
    supportTolerancePct: strategyConfig.supportTolerancePct,
    breakoutPct: strategyConfig.breakoutPct,
    analysisWindowCandles: strategyConfig.analysisWindowCandles,
    targets: strategyConfig.targets.map((t) => ({ ...t })),
    pollMs: paperConfig.pollMs,
    paths: { ...config.paths },
    scanIntervalMs: paperConfig.scanIntervalMs,
    watchlistSize: paperConfig.watchlistSize,
    scanPoolsPerWindow: paperConfig.scanPoolsPerWindow,
    scanEnrichCap: paperConfig.scanEnrichCap,
  },
  config.jupiter.apiKey,
);

process.on("SIGINT", () => {
  console.log("\nStopping paper trader (SIGINT)...");
  loop.stop("SIGINT");
});

process.on("SIGTERM", () => {
  console.log("\nStopping paper trader (SIGTERM)...");
  loop.stop("SIGTERM");
});

await loop.start();
