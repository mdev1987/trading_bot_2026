import type {
  SafetyAssessment,
  SafetyCheck,
} from "./types";

function icon(status: SafetyCheck["status"]): string {
  switch (status) {
    case "pass":
      return "✅";
    case "warn":
      return "⚠️";
    case "fail":
      return "❌";
    case "unknown":
      return "❔";
  }
}

function line(
  label: string,
  value: SafetyCheck,
): string {
  return (
    `${icon(value.status)} ` +
    `${label.padEnd(18)} ` +
    value.reason
  );
}

export function formatSafetyReport(
  assessment: SafetyAssessment,
): string {
  return [
    "🛡️ SAFETY ASSESSMENT",
    "────────────────────────",
    line("Global fees", assessment.globalFees),
    line(
      "Top-10 holders",
      assessment.top10HolderConcentration,
    ),
    line(
      "Largest holder",
      assessment.largestHolder,
    ),
    line("Insiders", assessment.insiders),
    line("Bundles", assessment.bundles),
    line("Dev", assessment.dev),
    line("Snipers", assessment.snipers),
    line(
      "Wallet clusters",
      assessment.walletClusters,
    ),
    line("DEX paid", assessment.dexPaid),
    line(
      "Chart behavior",
      assessment.chartBehavior,
    ),
    "",
    `Decision: ${assessment.decision.toUpperCase()}`,
  ].join("\n");
}
