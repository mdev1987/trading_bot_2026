/**
 * Course-fidelity safety gate (SRT ~01:04, ~01:07).
 *
 * The course names NO fixed bundle/insider limits and warns against
 * simplistic thresholds. It weighs interacting indicators instead:
 * dev/sniper/insider holdings, bundled supply, top-10 concentration,
 * global fees relative to market cap, DEX-paid status, wallet clusters,
 * and chart behavior.
 *
 * So there is deliberately no numeric score here — each check reports
 * its own status, and the decision follows explicit rules below.
 * Checks with no wired data source stay `unknown`, never `pass`.
 */

export type SafetyStatus = "pass" | "warn" | "fail" | "unknown";

export interface SafetyCheck {
  status: SafetyStatus;
  value: number | null;
  reason: string;
  source: string;
}

export interface SafetyAssessment {
  dev: SafetyCheck;
  snipers: SafetyCheck;
  insiders: SafetyCheck;
  bundles: SafetyCheck;
  holderConcentration: SafetyCheck;
  globalFees: SafetyCheck;
  dexPaid: SafetyCheck;
  walletClusters: SafetyCheck;
  chartBehavior: SafetyCheck;

  decision: "pass" | "watch" | "reject";
}

export type SafetyInput = Partial<
  Record<
    | "dev"
    | "snipers"
    | "insiders"
    | "bundles"
    | "holderConcentration"
    | "globalFees"
    | "dexPaid"
    | "walletClusters"
    | "chartBehavior",
    Omit<SafetyCheck, "source"> & { source?: string }
  >
>;

const CHECK_KEYS = [
  "dev",
  "snipers",
  "insiders",
  "bundles",
  "holderConcentration",
  "globalFees",
  "dexPaid",
  "walletClusters",
  "chartBehavior",
] as const;

function unknownCheck(reason: string): SafetyCheck {
  return { status: "unknown", value: null, reason, source: "unwired" };
}

/** Any single `fail` rejects. Any `warn`/`unknown` caps at `watch`. */
export function gateDecision(
  checks: Pick<SafetyAssessment, (typeof CHECK_KEYS)[number]>,
): "pass" | "watch" | "reject" {
  let sawNonPass = false;
  for (const key of CHECK_KEYS) {
    const status = checks[key].status;
    if (status === "fail") return "reject";
    if (status !== "pass") sawNonPass = true;
  }
  return sawNonPass ? "watch" : "pass";
}

export function assessSafety(input: SafetyInput = {}): SafetyAssessment {
  const assessment = {} as SafetyAssessment;
  for (const key of CHECK_KEYS) {
    const provided = input[key];
    assessment[key] = provided
      ? {
          status: provided.status,
          value: provided.value,
          reason: provided.reason,
          source: provided.source ?? "manual",
        }
      : unknownCheck("no data source wired yet");
  }
  assessment.decision = gateDecision(assessment);
  return assessment;
}
