import type { SetupSignal } from "./setup";

export function confirmSetup(setup: SetupSignal, currentPrice: number): SetupSignal {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    return {
      ...setup,
      status: "none",
      reason: [...setup.reason, "invalid-current-price"],
    };
  }

  if (setup.status !== "watch" && setup.status !== "confirmed") {
    return setup;
  }

  if (setup.triggerPrice === null || setup.triggerPrice <= 0) {
    return {
      ...setup,
      status: "watch",
      reason: [...setup.reason, "no-breakout-trigger"],
    };
  }

  if (currentPrice >= setup.triggerPrice) {
    return {
      ...setup,
      status: "confirmed",
      price: currentPrice,
      reason: [...setup.reason, "breakout-confirmed"],
    };
  }

  return {
    ...setup,
    status: "watch",
    price: currentPrice,
  };
}
