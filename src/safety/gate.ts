import {
  safetyConfig,
} from "./config";

import type {
  SafetyAssessment,
  SafetyCheck,
  SafetyDecision,
} from "./types";

function check(
  status: SafetyCheck["status"],
  value: number | null,
  reason: string,
  source: string,
): SafetyCheck {
  return {
    status,
    value,
    reason,
    source,
  };
}

function decide(
  checks: SafetyCheck[],
): {
  decision: SafetyDecision;
  reasons: string[];
} {
  const reasons: string[] = [];

  const hasFail = checks.some(
    (item) => item.status === "fail",
  );

  if (hasFail) {
    for (const item of checks) {
      if (item.status === "fail") {
        reasons.push(item.reason);
      }
    }

    return {
      decision: "reject",
      reasons,
    };
  }

  const hasUnknown = checks.some(
    (item) => item.status === "unknown",
  );

  const hasWarn = checks.some(
    (item) => item.status === "warn",
  );

  if (hasUnknown || hasWarn) {
    for (const item of checks) {
      if (
        item.status === "unknown" ||
        item.status === "warn"
      ) {
        reasons.push(item.reason);
      }
    }

    return {
      decision: safetyConfig.unknownDecision,
      reasons,
    };
  }

  return {
    decision: "pass",
    reasons: [],
  };
}

export interface SafetyInput {
  tokenAddress: string;

  globalFees: number | null;

  top10HolderConcentrationPct: number | null;
  largestHolderPct: number | null;

  insiderPct: number | null;
  bundledPct: number | null;

  devPct: number | null;
  sniperPct: number | null;

  walletClusterDetected: boolean | null;
  dexPaid: boolean | null;

  suspiciousChart: boolean | null;
}

export function assessSafety(
  input: SafetyInput,
): SafetyAssessment {
  const globalFees =
    input.globalFees === null
      ? check(
          "unknown",
          null,
          "global fees unavailable",
          "safety-provider",
        )
      : input.globalFees > 0
        ? check(
            "pass",
            input.globalFees,
            "global fees data available",
            "safety-provider",
          )
        : check(
            "warn",
            input.globalFees,
            "global fees are unusually low",
            "safety-provider",
          );

  const top10 =
    input.top10HolderConcentrationPct === null
      ? check(
          "unknown",
          null,
          "top-10 holder concentration unavailable",
          "holder-provider",
        )
      : input.top10HolderConcentrationPct >=
          safetyConfig.top10HolderWarnPct
        ? check(
            "warn",
            input.top10HolderConcentrationPct,
            `top-10 holders = ${input.top10HolderConcentrationPct.toFixed(2)}%`,
            "holder-provider",
          )
        : check(
            "pass",
            input.top10HolderConcentrationPct,
            `top-10 holders = ${input.top10HolderConcentrationPct.toFixed(2)}%`,
            "holder-provider",
          );

  const largestHolder =
    input.largestHolderPct === null
      ? check(
          "unknown",
          null,
          "largest-holder concentration unavailable",
          "holder-provider",
        )
      : input.largestHolderPct >=
          safetyConfig.largestHolderWarnPct
        ? check(
            "warn",
            input.largestHolderPct,
            `largest holder = ${input.largestHolderPct.toFixed(2)}%`,
            "holder-provider",
          )
        : check(
            "pass",
            input.largestHolderPct,
            `largest holder = ${input.largestHolderPct.toFixed(2)}%`,
            "holder-provider",
          );

  const insiders =
    input.insiderPct === null
      ? check(
          "unknown",
          null,
          "insider holdings unavailable",
          "holder-provider",
        )
      : input.insiderPct >= safetyConfig.insiderWarnPct
        ? check(
            "warn",
            input.insiderPct,
            `insiders = ${input.insiderPct.toFixed(2)}%`,
            "holder-provider",
          )
        : check(
            "pass",
            input.insiderPct,
            `insiders = ${input.insiderPct.toFixed(2)}%`,
            "holder-provider",
          );

  const bundles =
    input.bundledPct === null
      ? check(
          "unknown",
          null,
          "bundle exposure unavailable",
          "wallet-provider",
        )
      : check(
          input.bundledPct > 0
            ? "warn"
            : "pass",
          input.bundledPct,
          `bundled exposure = ${input.bundledPct.toFixed(2)}%`,
          "wallet-provider",
        );

  const dev =
    input.devPct === null
      ? check(
          "unknown",
          null,
          "dev holdings/status unavailable",
          "wallet-provider",
        )
      : check(
          "pass",
          input.devPct,
          `dev holdings = ${input.devPct.toFixed(2)}%`,
          "wallet-provider",
        );

  const snipers =
    input.sniperPct === null
      ? check(
          "unknown",
          null,
          "sniper holdings unavailable",
          "wallet-provider",
        )
      : check(
          "pass",
          input.sniperPct,
          `sniper holdings = ${input.sniperPct.toFixed(2)}%`,
          "wallet-provider",
        );

  const walletClusters =
    input.walletClusterDetected === null
      ? check(
          "unknown",
          null,
          "wallet-cluster analysis unavailable",
          "wallet-provider",
        )
      : input.walletClusterDetected
        ? check(
            "warn",
            null,
            "linked wallet cluster detected",
            "wallet-provider",
          )
        : check(
            "pass",
            null,
            "no suspicious wallet cluster detected",
            "wallet-provider",
          );

  const dexPaid =
    input.dexPaid === null
      ? check(
          "unknown",
          null,
          "DEX-paid status unavailable",
          "launch-provider",
        )
      : check(
          "pass",
          input.dexPaid ? 1 : 0,
          input.dexPaid
            ? "DEX is paid"
            : "DEX is not paid",
          "launch-provider",
        );

  const chartBehavior =
    input.suspiciousChart === null
      ? check(
          "unknown",
          null,
          "chart-behavior analysis unavailable",
          "strategy",
        )
      : input.suspiciousChart
        ? check(
            "fail",
            null,
            "suspicious chart behavior detected",
            "strategy",
          )
        : check(
            "pass",
            null,
            "no suspicious chart behavior detected",
            "strategy",
          );

  const checks = [
    globalFees,
    top10,
    largestHolder,
    insiders,
    bundles,
    dev,
    snipers,
    walletClusters,
    dexPaid,
    chartBehavior,
  ];

  const result = decide(checks);

  return {
    tokenAddress: input.tokenAddress,

    globalFees,
    top10HolderConcentration: top10,
    largestHolder,

    insiders,
    bundles,

    dev,
    snipers,

    walletClusters,
    dexPaid,
    chartBehavior,

    decision: result.decision,
    reasons: result.reasons,
  };
}
