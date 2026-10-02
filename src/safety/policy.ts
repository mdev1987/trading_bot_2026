import type { SafetyDecision } from "./types";

export interface EntryPolicy {
  allowed: boolean;
  /** Fraction of the configured max position (paper risk scaling). */
  sizeFraction: number;
  label: string;
}

/**
 * PAPER-ONLY entry policy. The safety gate itself is untouched
 * (unknown still yields WATCH there). This policy decides what the
 * paper loop does with that verdict:
 *
 * - reject → never trade (any mode, no exceptions).
 * - watch  → paper may trade at HALF size, with the full safety
 *            report attached to the BUY alert so the gap is visible.
 * - pass   → full size.
 *
 * A funded/live path must require PASS. There is no live path in
 * this codebase (Jupiter is quote-only), so this policy only ever
 * risks paper SOL.
 */
export function entryPolicy(decision: SafetyDecision): EntryPolicy {
  switch (decision) {
    case "pass":
      return { allowed: true, sizeFraction: 1, label: "safety PASS — full size" };
    case "watch":
      return {
        allowed: true,
        sizeFraction: 0.5,
        label: "safety WATCH — paper-only half size, gaps reported",
      };
    case "reject":
      return { allowed: false, sizeFraction: 0, label: "safety REJECT — never trade" };
  }
}
