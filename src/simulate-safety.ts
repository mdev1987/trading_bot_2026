import { assessSafety } from "./safety/gate";
import { formatSafetyReport } from "./safety/report";

console.log("================================");
console.log(" Module 13 - SRT Safety Gate");
console.log("================================");

const safeExample = assessSafety({
  tokenAddress: "TEST",

  globalFees: 100,

  top10HolderConcentrationPct: 21,
  largestHolderPct: 4,

  insiderPct: 20,
  bundledPct: 0,

  devPct: 2,
  mintAuthorityRevoked: true,
  freezeAuthorityRevoked: true,
  sniperPct: 1,

  walletClusterDetected: false,
  dexPaid: true,

  suspiciousChart: false,
});

console.log(formatSafetyReport(safeExample));

console.log("\n--- unknown-data case ---");

const unknownExample = assessSafety({
  tokenAddress: "TEST",

  globalFees: null,

  top10HolderConcentrationPct: null,
  largestHolderPct: null,

  insiderPct: null,
  bundledPct: null,

  devPct: null,
  mintAuthorityRevoked: null,
  freezeAuthorityRevoked: null,
  sniperPct: null,

  walletClusterDetected: null,
  dexPaid: null,

  suspiciousChart: null,
});

console.log(formatSafetyReport(unknownExample));

console.log("\n--- suspicious case ---");

const suspiciousExample = assessSafety({
  tokenAddress: "TEST",

  globalFees: 0,

  top10HolderConcentrationPct: 42,
  largestHolderPct: 15,

  insiderPct: 47,
  bundledPct: 25,

  devPct: 18,
  mintAuthorityRevoked: false,
  freezeAuthorityRevoked: false,
  sniperPct: 12,

  walletClusterDetected: true,
  dexPaid: false,

  suspiciousChart: true,
});

console.log(formatSafetyReport(suspiciousExample));

console.log("\nDone.");
