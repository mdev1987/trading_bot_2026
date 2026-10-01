import { LivePaperLoop } from "./paper/live-loop";
import { config } from "./config";

const loop = new LivePaperLoop(
  {
    poolAddress: "zxTpi4BtaWX3mgdAPoezkMD1hxx8CdeCfrqXMWvSCLX",
    tokenMint: "6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx",
    solMint: "So11111111111111111111111111111111111111112",
    startingBalanceSol: 1.0,
    maxPositionSol: 0.1,
    minPositionSol: 0.02,
    riskPerTradePct: 1.0,
    swingLookback: 3,
    levelTolerancePct: 0.75,
    supportTolerancePct: 1.0,
    breakoutPct: 0.25,
    analysisWindowCandles: 672,
    paths: { ...config.paths },
  },
  config.jupiter.apiKey,
);

process.on("SIGINT", () => {
  console.log("\nStopping paper trader...");
  loop.stop();
});

await loop.start();
