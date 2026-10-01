import { createPosition, managePosition, type MonitorBar } from "./strategy/position";
import type { StructureAnalysis, SwingPoint } from "./strategy/structure";

let step = 0;
const T0 = Date.parse("2026-01-01T00:00:00Z");
const iso = (mins: number): string => new Date(T0 + mins * 60_000).toISOString();

function swing(price: number, index: number, type: "high" | "low", mins: number): SwingPoint {
  return { index, time: iso(mins), price, type };
}

// Build a minimal synthetic analysis. Only the fields managePosition reads matter:
// market.swingHighs/lows, market.lastLow, supports/resistances, currentPrice.
function synthAnalysis(opts: {
  currentPrice: number;
  lastLow: number;
  prevLow: number;
  lastHigh: number;
  prevHigh: number;
}): StructureAnalysis {
  const prevHigh = swing(opts.prevHigh, 1, "high", 10);
  const lastHigh = swing(opts.lastHigh, 3, "high", 30);
  const prevLow = swing(opts.prevLow, 2, "low", 20);
  const lastLow = swing(opts.lastLow, 4, "low", 40);

  return {
    market: {
      trend: "uptrend",
      swingHighs: [prevHigh, lastHigh],
      swingLows: [prevLow, lastLow],
      lastHigh,
      previousHigh: prevHigh,
      lastLow,
      previousLow: prevLow,
    },
    currentPrice: opts.currentPrice,
    levels: [],
    supports: [],
    resistances: [],
  };
}

function bar(price: number, high?: number, low?: number): MonitorBar {
  return { price, high: high ?? price, low: low ?? price };
}

function runStep(
  label: string,
  market: MonitorBar,
  analysis: StructureAnalysis,
  pos: ReturnType<typeof createPosition>,
) {
  step += 1;
  const before = structuredClone(pos);
  const update = managePosition(pos, market, analysis);
  // Commit-after-compute, mirroring the live loop.
  Object.assign(pos, update.position);
  console.log(`\n[Step ${step}] ${label}`);
  console.log(
    `  price=$${market.price} lastLow=$${analysis.market.lastLow?.price} stop=$${before.currentStopPrice}->${pos.currentStopPrice} status=${pos.status} remaining=${pos.remainingSizeSol.toFixed(4)}`,
  );
  for (const a of update.actions) {
    console.log(`  -> ${a.type} qty=${a.quantitySol.toFixed(4)} ${a.reason}`);
  }
  return update;
}

function main() {
  console.log("================================");
  console.log(" Module 9 - Position Simulation");
  console.log("================================");

  const entryPrice = 0.2593;
  const stopPrice = 0.2444;

  const pos = createPosition({
    tokenAddress: "SIM",
    poolAddress: "SIM-POOL",
    entryPrice,
    positionSol: 0.1,
    stopPrice,
    targets: [
      { id: "target-1", triggerPrice: entryPrice * 1.25, sellFraction: 0.25 },
      { id: "target-2", triggerPrice: entryPrice * 1.5, sellFraction: 0.5 },
    ],
    openedAt: iso(0),
  });

  console.log(`Entry $${entryPrice} SL $${stopPrice} size 0.10 SOL`);
  console.log(`TP1 $${(entryPrice * 1.25).toFixed(4)} (25%) TP2 $${(entryPrice * 1.5).toFixed(4)} (50%)`);

  // 1. HOLD below TP1
  runStep(
    "price rises, no target",
    bar(0.275),
    synthAnalysis({ currentPrice: 0.275, lastLow: 0.2444, prevLow: 0.24, lastHigh: 0.27, prevHigh: 0.26 }),
    pos,
  );

  // 2. TP1 + stop moves to new HL $0.29
  runStep(
    "TP1 hit, new HL $0.29",
    bar(0.325),
    synthAnalysis({ currentPrice: 0.325, lastLow: 0.29, prevLow: 0.28, lastHigh: 0.32, prevHigh: 0.31 }),
    pos,
  );

  // 3. HOLD, same HL (no duplicate stop move)
  runStep(
    "higher price, same HL",
    bar(0.35),
    synthAnalysis({ currentPrice: 0.35, lastLow: 0.29, prevLow: 0.28, lastHigh: 0.34, prevHigh: 0.33 }),
    pos,
  );

  // 4. New HL $0.315 -> stop moves again
  runStep(
    "new HL $0.315",
    bar(0.35),
    synthAnalysis({ currentPrice: 0.35, lastLow: 0.315, prevLow: 0.29, lastHigh: 0.345, prevHigh: 0.34 }),
    pos,
  );

  // 5. Wick below trailing stop $0.315 but closes above -> intrabar stop exit
  runStep(
    "wick breaks trailing stop, close above",
    bar(0.32, 0.33, 0.31),
    synthAnalysis({ currentPrice: 0.32, lastLow: 0.315, prevLow: 0.29, lastHigh: 0.345, prevHigh: 0.34 }),
    pos,
  );

  // 6. Separate case: structural failure (failed high + broken low), no trailing conflict
  const pos2 = createPosition({
    tokenAddress: "SIM2",
    poolAddress: "SIM-POOL",
    entryPrice,
    positionSol: 0.1,
    stopPrice,
    targets: [],
    openedAt: iso(0),
  });
  console.log("\n--- structural failure case ---");
  const u6 = runStep(
    "failed high + broken low",
    bar(0.25),
    synthAnalysis({ currentPrice: 0.25, lastLow: 0.245, prevLow: 0.25, lastHigh: 0.26, prevHigh: 0.27 }),
    pos2,
  );
  const hasStopMove = u6.actions.some((a) => a.type === "stop-moved");
  const hasExit = u6.actions.some((a) => a.type === "full-exit");
  console.log(`  contradictory stop-move + exit: ${hasStopMove && hasExit ? "BUG" : "no (ok)"}`);

  // 7. Pre-entry swings must not trigger failure
  const pos3 = createPosition({
    tokenAddress: "SIM3",
    poolAddress: "SIM-POOL",
    entryPrice,
    positionSol: 0.1,
    stopPrice,
    targets: [],
    openedAt: iso(100),
  });
  console.log("\n--- pre-entry swings case ---");
  const u7 = runStep(
    "failure pattern entirely before entry",
    bar(0.25),
    synthAnalysis({ currentPrice: 0.25, lastLow: 0.245, prevLow: 0.25, lastHigh: 0.26, prevHigh: 0.27 }),
    pos3,
  );
  console.log(`  exited on stale pattern: ${u7.actions.some((a) => a.type === "full-exit") ? "BUG" : "no (ok)"}`);

  console.log("\nDone.");
}

main();
