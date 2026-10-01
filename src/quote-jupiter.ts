import { config } from "./config";
import { JupiterQuotes } from "./execution/jupiter";

// Paper-Jupiter quote check. Quote-only (no taker -> no transaction).
// Strategy signal -> live quote -> record. NOTHING is signed or sent.
const TOKEN_MINT = "6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx";
const BUY_SOL = 0.01;

console.log("================================");
console.log(" Module 11 - Jupiter Paper Quotes");
console.log("================================");
console.log("Mode: paper-jupiter (quote-only, no transaction sent)");

const jupiter = new JupiterQuotes(config.jupiter.apiKey);

const buy = await jupiter.quoteBuy(BUY_SOL, TOKEN_MINT);

console.log(`\nBUY  SOL -> TOKEN`);
console.log(`  in:  ${buy.inputAmount.toString()} lamports (${BUY_SOL} SOL)`);
console.log(`  out: ${buy.outputAmount.toString()} token units`);
console.log(`  router: ${buy.router ?? "?"}`);
console.log(`  priceImpact: ${buy.priceImpactPct ?? "?"} pct-points`);
console.log(`  requestId: ${buy.requestId || "?"}`);
console.log(`  hasTransaction: ${buy.hasTransaction} (expected false, no taker)`);

// SELL uses the BUY output as input: separate quote, separate route/liquidity.
const sell = await jupiter.quoteSell(buy.outputAmount, TOKEN_MINT);

console.log(`\nSELL TOKEN -> SOL`);
console.log(`  in:  ${sell.inputAmount.toString()} token units`);
console.log(`  out: ${sell.outputAmount.toString()} lamports`);
console.log(`  router: ${sell.router ?? "?"}`);
console.log(`  priceImpact: ${sell.priceImpactPct ?? "?"} pct-points`);
console.log(`  requestId: ${sell.requestId || "?"}`);
console.log(`  hasTransaction: ${sell.hasTransaction} (expected false, no taker)`);

console.log("\nDone. No transaction signed or sent.");
