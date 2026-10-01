import { config } from "./config";
import { DexPaprikaData } from "./dexpaprika";
import { JupiterPaperBroker } from "./execution/jupiter-paper";
import { PaperQuotes } from "./execution/quote";
import { roundTripDifferenceBps } from "./execution/types";

// Paper-Jupiter quote check via the consolidated path
// (transport: JupiterPaperBroker, facade: PaperQuotes).
// Quote-only (no taker -> no transaction). NOTHING is signed or sent.
const TOKEN_MINT = "6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx";
const POOL_ADDRESS = "zxTpi4BtaWX3mgdAPoezkMD1hxx8CdeCfrqXMWvSCLX";
const BUY_SOL = 0.01;

console.log("================================");
console.log(" Module 11 - Jupiter Paper Quotes");
console.log("================================");
console.log("Mode: paper-jupiter (quote-only, no transaction sent)");

const paprika = new DexPaprikaData();
const pool = await paprika.getPool(POOL_ADDRESS);
const tokenDecimals =
  (pool.tokens ?? []).find((t) => t.id === TOKEN_MINT)?.decimals ?? null;
console.log(`Token decimals: ${tokenDecimals ?? "unknown (rates unavailable)"}`);

const quotes = PaperQuotes.jupiter(new JupiterPaperBroker(config.jupiter.apiKey));

const buy = await quotes.quoteBuy(BUY_SOL, TOKEN_MINT, tokenDecimals);

console.log(`\nBUY  SOL -> TOKEN`);
console.log(`  in:  ${buy.inputAmount.toString()} lamports (${BUY_SOL} SOL)`);
console.log(`  out: ${buy.outputAmount.toString()} token units`);
console.log(`  effective rate: ${buy.effectiveRate ?? "n/a"} tokens/SOL`);
console.log(`  router: ${buy.router ?? "?"}`);
console.log(`  priceImpact: ${buy.priceImpactPct ?? "?"} pct-points (informational only)`);
console.log(`  requestId: ${buy.requestId || "?"}`);

// SELL uses the BUY output as input: separate quote, separate route/liquidity,
// obtained at a different moment (includes price movement — NOT pure cost).
const sell = await quotes.quoteSell(buy.outputAmount, TOKEN_MINT, tokenDecimals);

console.log(`\nSELL TOKEN -> SOL`);
console.log(`  in:  ${sell.inputAmount.toString()} token units`);
console.log(`  out: ${sell.outputAmount.toString()} lamports`);
console.log(`  effective rate: ${sell.effectiveRate ?? "n/a"} SOL/token`);
console.log(`  router: ${sell.router ?? "?"}`);
console.log(`  priceImpact: ${sell.priceImpactPct ?? "?"} pct-points (informational only)`);
console.log(`  requestId: ${sell.requestId || "?"}`);

const sellSol = Number(sell.outputAmount) / 1e9;
console.log(
  `\nRound-trip difference: ${roundTripDifferenceBps(BUY_SOL, sellSol)?.toFixed(2) ?? "?"} bps (includes inter-quote price movement)`,
);

console.log("\nDone. No transaction signed or sent.");
