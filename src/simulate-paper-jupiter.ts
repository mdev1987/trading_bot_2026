import { JupiterPaperBroker } from "./execution/jupiter-paper";
import { PaperAccount } from "./paper/account";
import { paperConfig } from "./paper/config";
import { config } from "./config";

console.log("================================");
console.log(" Module 12 - Jupiter Paper Trading");
console.log("================================");
console.log("Mode: paper-jupiter");
console.log("Transactions: DISABLED\n");

const jupiter = new JupiterPaperBroker(config.jupiter.apiKey);
const account = new PaperAccount(paperConfig.startingBalanceSol);

// Same test token already used successfully with quote-jupiter.
const entryPriceUsd = 0.25;

console.log("BUY test");
console.log(`Balance before: ${account.balanceSol.toFixed(4)} SOL`);

const buy = await account.buy(
  jupiter,
  paperConfig.solMint,
  paperConfig.tokenMint,
  Math.min(paperConfig.maxPositionSol, account.balanceSol),
  entryPriceUsd,
  "module-12-test-entry",
);

console.log(`in      : ${buy.inAmount.toString()}`);
console.log(`out     : ${buy.outAmount.toString()}`);
console.log(`router  : ${buy.router ?? "unknown"}`);
console.log(`impact  : ${buy.priceImpactPct?.toFixed(6) ?? "n/a"}% (informational only)`);
console.log(`request : ${buy.requestId}`);
console.log(`balance : ${account.balanceSol.toFixed(4)} SOL`);

console.log("\nSELL test");

const sell = await account.sell(jupiter, paperConfig.solMint, paperConfig.tokenMint, 1, 0.3, "module-12-test-exit");

console.log(`in      : ${sell.inAmount.toString()}`);
console.log(`out     : ${sell.outAmount.toString()}`);
console.log(`router  : ${sell.router ?? "unknown"}`);
console.log(`impact  : ${sell.priceImpactPct?.toFixed(6) ?? "n/a"}% (informational only)`);
console.log(`request : ${sell.requestId}`);
console.log(`balance : ${account.balanceSol.toFixed(4)} SOL`);

const snapshot = account.snapshot();

console.log("\n================================");
console.log(" Paper Account");
console.log("================================");
console.log(`SOL balance : ${snapshot.solBalance.toFixed(6)}`);
console.log(`Realized PnL: ${snapshot.realizedPnlSol >= 0 ? "+" : ""}${snapshot.realizedPnlSol.toFixed(6)} SOL`);
console.log(`Trades      : ${snapshot.trades.length}`);
console.log("\nDone.");
console.log("No transaction signed or sent.");
