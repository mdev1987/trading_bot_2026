import type { BacktestResult } from "./types";

export function printBacktestReport(result: BacktestResult): void {
  console.log();
  console.log("================================");
  console.log(" Backtest Report");
  console.log("================================");
  console.log(`Starting balance : ${result.startingBalanceSol.toFixed(4)} SOL`);
  console.log(`Ending balance   : ${result.endingBalanceSol.toFixed(4)} SOL`);
  console.log(
    `PnL               : ${result.totalPnlSol >= 0 ? "+" : ""}${result.totalPnlSol.toFixed(4)} SOL`,
  );
  console.log(
    `Return            : ${result.totalPnlPct >= 0 ? "+" : ""}${result.totalPnlPct.toFixed(2)}%`,
  );
  console.log(`Trades            : ${result.totalTrades}`);
  console.log(`Wins              : ${result.winningTrades}`);
  console.log(`Losses            : ${result.losingTrades}`);
  console.log(`Win rate          : ${result.winRatePct.toFixed(2)}%`);
  console.log(`Max drawdown      : ${result.maxDrawdownSol.toFixed(4)} SOL`);
  console.log(`Max drawdown %    : ${result.maxDrawdownPct.toFixed(2)}%`);
  console.log();

  for (const [index, trade] of result.trades.entries()) {
    console.log(
      [
        `${index + 1}.`,
        trade.entryTime,
        `entry=$${trade.entryPrice.toFixed(8)}`,
        `size=${trade.positionSol.toFixed(4)} SOL`,
        `pnl=${trade.pnlSol >= 0 ? "+" : ""}${trade.pnlSol.toFixed(4)} SOL`,
        `return=${trade.pnlPct >= 0 ? "+" : ""}${trade.pnlPct.toFixed(2)}%`,
        `exit=${trade.exitReason ?? "?"}`,
      ].join(" | "),
    );
  }
}
