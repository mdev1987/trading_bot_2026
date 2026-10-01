import { ExecutionSimulator } from "./execution/simulator";
import { executionConfig } from "./execution/config";

console.log("================================");
console.log(" Module 11 - Execution Simulation");
console.log("================================");

const simulator = new ExecutionSimulator(executionConfig);

// Deliberately simple test fixture.
// 200 USD/SOL is only a test value.
const solPriceUsd = 200;

const scenarios = [
  { name: "small trade", notionalSol: 0.02, liquidityUsd: 50_000 },
  { name: "normal trade", notionalSol: 0.1, liquidityUsd: 50_000 },
  { name: "large relative-to-liquidity trade", notionalSol: 0.5, liquidityUsd: 10_000 },
];

for (const scenario of scenarios) {
  console.log(`\n--- ${scenario.name} ---`);

  const buy = simulator.simulateFill({
    side: "buy",
    priceUsd: 0.25,
    notionalSol: scenario.notionalSol,
    solPriceUsd,
    liquidityUsd: scenario.liquidityUsd,
  });

  const sell = simulator.simulateFill({
    side: "sell",
    priceUsd: 0.3,
    notionalSol: scenario.notionalSol,
    solPriceUsd,
    liquidityUsd: scenario.liquidityUsd,
  });

  console.log(`BUY  reference=$${buy.referencePriceUsd.toFixed(8)}`);
  console.log(`     fill=$${buy.fillPriceUsd.toFixed(8)}`);
  console.log(`     fee=${buy.feeSol.toFixed(6)} SOL`);
  console.log(`     liquidity impact=${buy.liquidityImpactBps.toFixed(2)} bps`);

  console.log(`SELL reference=$${sell.referencePriceUsd.toFixed(8)}`);
  console.log(`     fill=$${sell.fillPriceUsd.toFixed(8)}`);
  console.log(`     fee=${sell.feeSol.toFixed(6)} SOL`);
  console.log(`     liquidity impact=${sell.liquidityImpactBps.toFixed(2)} bps`);
}

console.log("\nDone.");
