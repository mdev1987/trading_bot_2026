export type SafetyStatus =
  | "pass"
  | "warn"
  | "fail"
  | "unknown";

export type SafetyDecision =
  | "pass"
  | "watch"
  | "reject";

export interface SafetyCheck {
  status: SafetyStatus;
  value: number | null;
  reason: string;
  source: string;
}

export interface SafetyAssessment {
  tokenAddress: string;

  globalFees: SafetyCheck;
  top10HolderConcentration: SafetyCheck;
  largestHolder: SafetyCheck;

  insiders: SafetyCheck;
  bundles: SafetyCheck;

  dev: SafetyCheck;
  snipers: SafetyCheck;

  walletClusters: SafetyCheck;
  dexPaid: SafetyCheck;
  chartBehavior: SafetyCheck;

  decision: SafetyDecision;

  reasons: string[];
}
