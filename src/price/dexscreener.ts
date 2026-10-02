import {
  DexScreenerData,
  type DexScreenerTokenSnapshot,
} from "../dexscreener";

export interface PriceUpdate
  extends DexScreenerTokenSnapshot {
  previousPriceUsd: number | null;
  changePct: number | null;
}

export type PriceUpdateHandler = (
  updates: PriceUpdate[],
) => void | Promise<void>;

const fmtWindow = (v: number | null): string => (v === null ? "n/a" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`);

/**
 * Multi-window momentum line from one Screener snapshot — the MTF
 * context the plan-limited DexPaprika 5m/1h candles cannot provide
 * (they 403). Pure, zero network.
 */
export function formatScreenerContext(update: PriceUpdate): string {
  return (
    `MTF m5:${fmtWindow(update.priceChangeM5Pct)} ` +
    `h1:${fmtWindow(update.priceChangeH1Pct)} ` +
    `h6:${fmtWindow(update.priceChangeH6Pct)} ` +
    `h24:${fmtWindow(update.priceChangeH24Pct)} ` +
    `(DEX Screener, ${update.dexId ?? "?"})`
  );
}

export interface DexScreenerPriceTrackerOptions {
  intervalMs?: number;
  maxTokens?: number;
}

export class DexScreenerPriceTracker {
  private readonly data: DexScreenerData;

  private readonly intervalMs: number;

  private readonly maxTokens: number;

  private addresses: string[] = [];

  private previousPrices =
    new Map<string, number>();

  private running = false;

  private timer:
    ReturnType<typeof setTimeout> | null =
    null;

  private handler:
    PriceUpdateHandler | null =
    null;

  constructor(
    options: DexScreenerPriceTrackerOptions = {},
  ) {
    this.data =
      new DexScreenerData("solana");

    this.intervalMs =
      options.intervalMs ?? 2_000;

    this.maxTokens =
      options.maxTokens ?? 30;
  }

  start(
    tokenAddresses: string[],
    handler: PriceUpdateHandler,
  ): void {
    this.addresses = [
      ...new Set(
        tokenAddresses.filter(
          (address) =>
            address.trim().length > 0,
        ),
      ),
    ].slice(0, this.maxTokens);

    this.handler = handler;

    if (this.running) {
      return;
    }

    this.running = true;

    void this.loop();
  }

  updateTokens(
    tokenAddresses: string[],
  ): void {
    this.addresses = [
      ...new Set(
        tokenAddresses.filter(
          (address) =>
            address.trim().length > 0,
        ),
      ),
    ].slice(0, this.maxTokens);
  }

  stop(): void {
    this.running = false;

    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  get tracked(): readonly string[] {
    return this.addresses;
  }

  get isRunning(): boolean {
    return this.running;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      const startedAt = Date.now();

      try {
        await this.poll();
      } catch (error) {
        console.warn(
          `[PRICE] poll failed: ${
            error instanceof Error
              ? error.message
              : String(error)
          }`,
        );
      }

      if (!this.running) {
        break;
      }

      /*
       * Do not use setInterval().
       *
       * This prevents overlapping HTTP requests when
       * DexScreener takes longer than expected.
       */
      const elapsed =
        Date.now() - startedAt;

      const delay = Math.max(
        0,
        this.intervalMs - elapsed,
      );

      await new Promise<void>(
        (resolve) => {
          this.timer = setTimeout(
            resolve,
            delay,
          );
        },
      );

      this.timer = null;
    }
  }

  private async poll(): Promise<void> {
    if (
      this.addresses.length === 0 ||
      this.handler === null
    ) {
      return;
    }

    const snapshots =
      await this.data.getTokenSnapshots(
        this.addresses,
      );

    const updates: PriceUpdate[] = [];

    for (const address of this.addresses) {
      const snapshot =
        snapshots.get(address);

      if (!snapshot) {
        continue;
      }

      const previousPrice =
        this.previousPrices.get(address)
          ?? null;

      const currentPrice =
        snapshot.priceUsd;

      let changePct: number | null = null;

      if (
        previousPrice !== null &&
        currentPrice !== null &&
        previousPrice > 0
      ) {
        changePct =
          (
            (currentPrice - previousPrice) /
            previousPrice
          ) * 100;
      }

      if (currentPrice !== null) {
        this.previousPrices.set(
          address,
          currentPrice,
        );
      }

      updates.push({
        ...snapshot,
        previousPriceUsd: previousPrice,
        changePct,
      });
    }

    if (updates.length > 0) {
      await this.handler(updates);
    }
  }
}
