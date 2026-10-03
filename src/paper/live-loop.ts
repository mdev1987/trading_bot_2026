import { DexPaprikaData } from "../dexpaprika";
import { JupiterPaperBroker } from "../execution/jupiter-paper";
import { PaperAccount } from "./account";
import { PaperStore } from "./store";
import { analyzeMarket } from "../strategy/structure";
import { detectSetup } from "../strategy/setup";
import { confirmSetup } from "../strategy/confirmation";
import { createEntryDecision } from "../strategy/entry";
import { createPosition, managePosition, type MonitorBar, type Position } from "../strategy/position";
import { assessSafety, type SafetyInput } from "../safety/gate";
import { fetchSafetyInput } from "../safety/providers";
import { entryPolicy } from "../safety/policy";
import { formatSafetyReport } from "../safety/report";
import {
  classifyPoolByAddress,
  diffWatchlist,
  mergePinned,
  scanCandidates,
  shouldReportScan,
  type WatchCandidate,
} from "../discovery/scan";
import { DexScreenerMarketCap } from "../market-cap/dexscreener";
import { DexScreenerPriceTracker, formatScreenerContext, type PriceUpdate } from "../price/dexscreener";
import { meanTrueRangePct } from "../strategy/momentum";
import type { Candle } from "../market/ohlcv";
import { getPoolCandles } from "../market/ohlcv";
import { config } from "../config";
import type { SetupSignal } from "../strategy/setup";
import type { EntryDecision } from "../strategy/entry";
import {
  telegram,
  paperOpenMessage,
  paperPartialMessage,
  paperCloseMessage,
  paperStartMessage,
  paperStopMessage,
  paperScanMessage,
  type TokenContext,
} from "../telegram";

const CANDLE_INTERVAL = "15m" as const;

const QUOTE_SYMBOLS = new Set(["SOL", "WSOL", "USDC", "USDT"]);

/**
 * No safety data providers are wired yet (holders, launch, wallets),
 * so every field is null and the gate deliberately returns WATCH —
 * which blocks entries (unknown must never produce a BUY).
 */
function emptySafetyInput(tokenAddress: string): SafetyInput {
  return {
    tokenAddress,
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
  };
}

export interface LivePaperConfig {
  poolAddress: string;
  tokenMint: string;
  solMint: string;
  startingBalanceSol: number;
  maxPositionSol: number;
  minPositionSol: number;
  riskPerTradePct: number;
  swingLookback: number;
  levelTolerancePct: number;
  supportTolerancePct: number;
  breakoutPct: number;
  analysisWindowCandles: number;
  targets: { id: string; profitPct: number; sellFraction: number }[];
  pollMs: number;
  paths: { stateFile: string; ledgerFile: string };
  scanIntervalMs: number;
  watchlistSize: number;
  scanPoolsPerWindow: number;
  scanEnrichCap: number;
  enableRangeBreak: boolean;
  atrStopFloorMultiplier: number;
}

interface ActivePool {
  poolAddress: string;
  tokenMint: string;
}

export class LivePaperLoop {
  private readonly paprika = new DexPaprikaData();
  private readonly jupiter: JupiterPaperBroker;
  private readonly account: PaperAccount;
  private readonly store: PaperStore;
  private strategyPosition: Position | null = null;
  private token: TokenContext | null = null;

  private running = false;
  private lastProcessedCandle = "";
  private startedAt: string | null = null;
  private stopReason = "loop ended";

  // Multi-pool automation: one tracked pool at a time (single-position
  // account), hourly discovery scan refreshing the ranked watchlist.
  private activePool: ActivePool;
  private readonly tokenContexts = new Map<string, TokenContext>();
  private watchlist: WatchCandidate[] = [];
  private lastScanAt = "";
  private lastScanReportAt: number | null = null;
  private candlesByPool: Record<string, string> = {};

  // DEX Screener: real market-cap enrichment + 2s live prices.
  // DexPaprika stays the discovery/metadata/OHLCV source.
  private readonly marketCaps = new DexScreenerMarketCap();
  private readonly priceTracker = new DexScreenerPriceTracker({ intervalMs: 2_000, maxTokens: 30 });
  private readonly livePrices = new Map<string, PriceUpdate>();
  /** Freshness window for trusting a tracker price over candle close. */
  private static readonly LIVE_PRICE_MAX_AGE_MS = 30_000;

  constructor(
    private readonly config: LivePaperConfig,
    jupiterApiKey: string | undefined,
  ) {
    this.jupiter = new JupiterPaperBroker(jupiterApiKey ?? "");
    this.account = new PaperAccount(config.startingBalanceSol);
    this.store = new PaperStore(config.paths.stateFile, config.paths.ledgerFile);
    this.activePool = { poolAddress: config.poolAddress, tokenMint: config.tokenMint };
  }

  async start(): Promise<void> {
    if (this.running) {
      throw new Error("Paper loop already running");
    }

    // Recover persisted state unconditionally: balance, open positions,
    // history and stats all come from disk, never from defaults.
    const persisted = await this.store.init();
    this.account.restoreState({
      solBalance: persisted.balanceSol,
      realizedPnlSol: persisted.realizedPnlSol,
      position: persisted.paperPosition,
      trades:
        persisted.trades?.map((t) => ({ ...t, tokenAmountRaw: t.tokenAmountRaw })) ?? [],
    });
    this.strategyPosition = persisted.strategyPosition;
    this.lastProcessedCandle = persisted.lastProcessedCandle ?? "";
    if (this.strategyPosition) {
      console.log(
        `Recovered open strategy position: entry=$${this.strategyPosition.entryPrice.toFixed(8)} remaining=${this.strategyPosition.remainingSizeSol.toFixed(4)} SOL`,
      );
    }

    // Active pool: persisted rotation wins; an open position's pool wins
    // over config (a restart must never orphan a live position); fresh
    // boots fall back to the configured default pool.
    this.activePool = persisted.activePool ?? (
      this.strategyPosition
        ? { poolAddress: this.strategyPosition.poolAddress, tokenMint: this.strategyPosition.tokenAddress }
        : { poolAddress: this.config.poolAddress, tokenMint: this.config.tokenMint }
    );
    this.watchlist = persisted.watchlist ?? [];
    this.lastScanAt = persisted.lastScanAt ?? "";
    this.candlesByPool = persisted.candlesByPool ?? {};
    const knownCandle = this.candlesByPool[this.activePool.poolAddress] ?? "";
    if (!this.lastProcessedCandle && knownCandle) {
      this.lastProcessedCandle = knownCandle;
    }

    this.token = await this.resolveTokenContext(this.activePool.poolAddress, this.activePool.tokenMint);
    this.running = true;

    console.log("================================");
    console.log(" Module 13 - Live Paper Strategy");
    console.log("================================");
    console.log("Mode: paper-jupiter");
    console.log("Transactions: DISABLED");
    console.log(`Pool: ${this.activePool.poolAddress}`);
    console.log(`Token: ${this.token.symbol} (${this.token.dex})`);
    console.log(`Interval: ${CANDLE_INTERVAL}`);
    console.log(`Watchlist: ${this.watchlist.length} pools (scan every ${(this.config.scanIntervalMs / 3_600_000).toFixed(1)}h)`);
    console.log();

    const startedAt = new Date().toISOString();
    this.startedAt = startedAt;
    this.stopReason = "loop ended";
    const snap = this.account.snapshot();
    await telegram(
      paperStartMessage({
        token: this.token,
        mode: "paper-jupiter",
        interval: CANDLE_INTERVAL,
        pollMs: this.config.pollMs,
        balanceSol: snap.solBalance,
        realizedPnlSol: snap.realizedPnlSol,
        riskPerTradePct: this.config.riskPerTradePct,
        minPositionSol: this.config.minPositionSol,
        maxPositionSol: this.config.maxPositionSol,
        targets: this.config.targets.map((t) => ({ ...t })),
        resumed: (this.lastProcessedCandle ?? "") !== "" || this.strategyPosition !== null,
        openPositionSol: this.strategyPosition?.remainingSizeSol ?? snap.position?.remainingSizeSol ?? null,
        startedAt,
      }),
    )
      .then(() => console.log("Telegram start report sent"))
      .catch((e) => console.error("Telegram start report failed:", e));

    // Live price stream follows the active pool + watchlist (2s,
    // batched, well inside the 300 req/min limit). Position stops and
    // targets react to it; structure/setups stay on closed 15m candles.
    this.priceTracker.start(this.trackedTokenMints(), async (updates) => {
      for (const u of updates) this.livePrices.set(u.tokenAddress, u);
    });

    // Boot scan seeds the watchlist immediately (report-only when a
    // position is already open; rotation only happens while flat).
    await this.runScan();

    while (this.running) {
      try {
        await this.tick();
        if (this.scanDue()) {
          await this.runScan();
        }
      } catch (error) {
        console.error("Paper loop error:", error instanceof Error ? error.message : error);
      }
      await Bun.sleep(this.config.pollMs);
    }

    await this.sendStopReport();
  }

  stop(reason = "signal"): void {
    this.stopReason = reason;
    this.running = false;
    this.priceTracker.stop();
  }

  /** Token mints the price tracker should follow right now. */
  private trackedTokenMints(): string[] {
    const mints = new Set<string>([this.activePool.tokenMint]);
    for (const c of this.watchlist) mints.add(c.tokenAddress);
    return [...mints];
  }

  /** Fresh live price for a token, or null when stale/absent. */
  private livePriceUsd(tokenMint: string): number | null {
    const update = this.livePrices.get(tokenMint);
    if (!update || update.priceUsd === null) return null;
    if (Date.now() - update.observedAt > LivePaperLoop.LIVE_PRICE_MAX_AGE_MS) return null;
    return update.priceUsd;
  }

  private async sendStopReport(): Promise<void> {
    const stoppedAt = new Date().toISOString();
    const snap = this.account.snapshot();
    const stats = this.store.state.stats;
    await telegram(
      paperStopMessage({
        token: this.token,
        reason: this.stopReason,
        startedAt: this.startedAt,
        stoppedAt,
        balanceSol: snap.solBalance,
        realizedPnlSol: snap.realizedPnlSol,
        openPositionSol:
          this.strategyPosition?.remainingSizeSol ?? snap.position?.remainingSizeSol ?? null,
        lastCandle: this.lastProcessedCandle || null,
        trades: stats.trades,
        wins: stats.wins,
        losses: stats.losses,
      }),
    )
      .then(() => console.log("Telegram stop report sent"))
      .catch((e) => console.error("Telegram stop report failed:", e));
  }

  get snapshot() {
    return this.account.snapshot();
  }

  private async resolveTokenContext(poolAddress: string, tokenMint: string): Promise<TokenContext> {
    const cached = this.tokenContexts.get(poolAddress);
    if (cached) return cached;
    const fallback: TokenContext = {
      name: "Unknown",
      symbol: "UNKNOWN",
      chain: this.paprika.network,
      dex: "unknown",
      ca: tokenMint,
      poolAddress,
      liquidityUsd: null,
    };
    try {
      const pool = await this.paprika.getPool(poolAddress);
      const dex = pool.dex_name ?? fallback.dex;
      const meme = (pool.tokens ?? []).find(
        (t) => !QUOTE_SYMBOLS.has((t.symbol ?? "").trim().toUpperCase()),
      );
      const ctx: TokenContext = {
        name: meme?.name ?? fallback.name,
        symbol: meme?.symbol ?? fallback.symbol,
        chain: this.paprika.network,
        dex,
        ca: tokenMint,
        poolAddress,
        liquidityUsd: null,
      };
      this.tokenContexts.set(poolAddress, ctx);
      return ctx;
    } catch (error) {
      console.error("Token context lookup failed, using fallback:", error instanceof Error ? error.message : error);
      return fallback;
    }
  }

  private scanDue(): boolean {
    if (!this.lastScanAt) return true;
    return Date.now() - Date.parse(this.lastScanAt) >= this.config.scanIntervalMs;
  }

  /** Periodic discovery scan: refresh the ranked watchlist, Telegram on change. */
  private async runScan(): Promise<void> {
    try {
      const result = await scanCandidates(this.paprika, {
        poolsPerWindow: this.config.scanPoolsPerWindow,
        enrichCap: this.config.scanEnrichCap,
        watchlistSize: this.config.watchlistSize,
        marketCapProvider: this.marketCaps,
      });
      let pinned: WatchCandidate[] = [];
      try {
        const pin = await classifyPoolByAddress(
          this.paprika,
          this.activePool.poolAddress,
          this.marketCaps,
        );
        pinned = pin.candidates;
        if (!pin.enriched) console.log(`SCAN pin: tracked pool lookup failed`);
      } catch (error) {
        console.error("SCAN pin failed:", error instanceof Error ? error.message : error);
      }
      const merged = mergePinned(result.candidates, pinned, this.config.watchlistSize);
      const fresh = diffWatchlist(this.watchlist, merged);
      const report = shouldReportScan(this.watchlist, merged, this.lastScanReportAt);
      this.watchlist = merged;
      this.lastScanAt = result.at;
      await this.store.save({ watchlist: this.watchlist, lastScanAt: this.lastScanAt });
      this.priceTracker.updateTokens(this.trackedTokenMints());
      const pinnedMark = new Set(pinned.map((c) => c.poolAddress));
      console.log(
        `SCAN ${result.at}: ${result.scannedPools} pools, ${result.enrichedPools} enriched, ` +
        `${merged.length} candidates (${fresh.length} new, ${pinned.length} pinned)`,
      );
      for (const c of merged) {
        const mcap = c.marketCapUsd == null ? "unknown" : `$${Math.round(c.marketCapUsd).toLocaleString()}`;
        const fdv = c.fdvUsd == null ? "n/a" : `$${Math.round(c.fdvUsd).toLocaleString()}`;
        console.log(
          `  - ${c.tokenSymbol} [${c.phase}${c.eligibility === "ready" ? "" : "-age-compatible"}] ` +
          `MCAP: ${mcap} | FDV: ${fdv} | eligibility=${c.eligibility.toUpperCase()} (${c.eligibilityReason})` +
          (pinnedMark.has(c.poolAddress) ? " 📌" : ""),
        );
      }
      // At 10-minute cadence the console logs every scan, but Telegram
      // only pings on set changes (or the hourly heartbeat) — otherwise
      // an identical re-scan would spam the chat 144 times a day.
      if (report) {
        this.lastScanReportAt = Date.now();
        await telegram(
          paperScanMessage({
            at: result.at,
            scannedPools: result.scannedPools,
            enrichedPools: result.enrichedPools,
            candidates: merged.map((c) => ({
              symbol: c.tokenSymbol + (pinnedMark.has(c.poolAddress) ? " 📌" : ""),
              phase: c.phase,
              poolAddress: c.poolAddress,
              volume24hUsd: c.volume24hUsd,
              marketCapUsd: c.marketCapUsd,
              fdvUsd: c.fdvUsd,
              marketCapSource: c.marketCapSource,
              eligibility: c.eligibility,
              eligibilityReason: c.eligibilityReason,
              pairAgeHours: c.pairAgeHours,
            })),
            activeSymbol: this.token?.symbol ?? null,
            positionOpen: this.strategyPosition !== null || this.account.openPosition !== null,
          }),
        ).catch((e) => console.error("Telegram scan report failed:", e));
      } else {
        console.log(`SCAN report skipped (unchanged set, heartbeat not due)`);
      }
    } catch (error) {
      console.error("Discovery scan failed:", error instanceof Error ? error.message : error);
    }
  }

  /** Switch the tracked pool (flat only — never with a position open). */
  private async switchActivePool(
    poolAddress: string,
    tokenMint: string,
    enteredCandleTimeClose: string,
  ): Promise<TokenContext> {
    this.candlesByPool[this.activePool.poolAddress] = this.lastProcessedCandle;
    this.activePool = { poolAddress, tokenMint };
    this.lastProcessedCandle = enteredCandleTimeClose;
    this.candlesByPool[poolAddress] = enteredCandleTimeClose;
    const ctx = await this.resolveTokenContext(poolAddress, tokenMint);
    this.token = ctx;
    this.priceTracker.updateTokens(this.trackedTokenMints());
    await this.store.save({
      activePool: { ...this.activePool },
      candlesByPool: { ...this.candlesByPool },
      lastProcessedCandle: this.lastProcessedCandle,
    });
    console.log(`🔀 ROTATED tracking -> ${ctx.symbol} (${ctx.dex}) ${poolAddress}`);
    return ctx;
  }

  private async tick(): Promise<void> {
    // Relative window stays inside the plan's history (same form as the
    // working Module 6-10 calls). Absolute ISO ranges can 403.
    const rows = await this.paprika.getPoolOHLCV(this.activePool.poolAddress, {
      start: "-7d",
      interval: CANDLE_INTERVAL,
      limit: this.config.analysisWindowCandles,
    });

    if (rows.length < 20) {
      console.log(`Waiting for enough candles: ${rows.length}`);
      return;
    }

    // The latest row may still be forming. It must never confirm signals
    // (closed-candle rule), but its high/low/close ARE the live monitor
    // for stops and targets between closed candles.
    const lastRow = rows.at(-1)!;
    const lastIsForming = new Date(lastRow.time_close).getTime() > Date.now();
    const closedRows = lastIsForming ? rows.slice(0, -1) : rows;
    const closed = closedRows.at(-1);
    if (!closed) return;

    const isNewClosedCandle = closed.time_close !== this.lastProcessedCandle;

    const candles: Candle[] = closedRows.map((r) => ({
      timeOpen: r.time_open,
      timeClose: r.time_close,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume,
    }));

    // Live monitor bar: DEX Screener 2s price when fresh (stops/targets
    // react in seconds, not per 15s poll), else the forming/closed candle.
    // Entries still need closed closes; wicks stay candle-based.
    const live = this.livePriceUsd(this.activePool.tokenMint);
    const monitor: MonitorBar = lastIsForming
      ? { price: live ?? lastRow.close, high: lastRow.high, low: lastRow.low }
      : { price: live ?? closed.close, high: closed.high, low: closed.low };

    // A throw anywhere below leaves lastProcessedCandle untouched, so the
    // candle is retried next cycle instead of being silently skipped.
    // Rotation may switch activePool inside processStrategy — the tail
    // save must follow the pool whose candles were actually fetched.
    const trackedPool = this.activePool.poolAddress;
    await this.processStrategy(candles, closed.close, monitor, isNewClosedCandle);

    if (this.activePool.poolAddress !== trackedPool) {
      // evaluateWatchlist rotated and already persisted the new pool's
      // candle bookkeeping; the BUY line above has the entry details.
      console.log(
        `[${this.token?.symbol ?? "?"} ${this.lastProcessedCandle}] entered on rotation (was tracking ${trackedPool.slice(0, 8)})`,
      );
      return;
    }

    if (isNewClosedCandle) {
      this.lastProcessedCandle = closed.time_close;
      this.candlesByPool[this.activePool.poolAddress] = closed.time_close;
      await this.store.save({
        lastProcessedCandle: closed.time_close,
        candlesByPool: { ...this.candlesByPool },
      });
      console.log(`[${this.token?.symbol ?? "?"} ${closed.time_close}] close=$${closed.close.toFixed(8)}`);
    }
  }

  private async persistAccountAndStrategy(): Promise<void> {
    const snap = this.account.snapshot();
    await this.store.save({
      balanceSol: snap.solBalance,
      realizedPnlSol: snap.realizedPnlSol,
      paperPosition: snap.position
        ? {
            ...snap.position,
            tokenAmountRaw: snap.position.tokenAmountRaw.toString(),
            originalTokenAmountRaw: snap.position.originalTokenAmountRaw.toString(),
          }
        : null,
      strategyPosition: this.strategyPosition,
      trades: snap.trades.map((t) => ({ ...t, tokenAmountRaw: t.tokenAmountRaw.toString() })),
    });
  }

  private async processStrategy(
    candles: Candle[],
    closedPrice: number,
    monitor: MonitorBar,
    isNewClosedCandle: boolean,
  ): Promise<void> {
    const token = this.token!;
    const analysis = analyzeMarket(candles, closedPrice, this.config.swingLookback, this.config.levelTolerancePct);

    // Safety checklist is local (no API cost). No safety data providers
    // are wired yet, so every assessment is WATCH — entries stay blocked
    // until real holder/wallet/launch sources exist (course-fidelity rule).
    if (isNewClosedCandle) {
      const safety = assessSafety(emptySafetyInput(this.activePool.tokenMint));
      console.log(
        `SAFETY ${this.token?.symbol ?? "?"} pre-check decision=${safety.decision} (providers resolve on confirmed setups: Helius holders + DEX orders)`,
      );
      // Multi-window momentum from the Screener tracker cache (free —
      // no DexPaprika 5m/1h calls, which the plan rejects).
      const cached = this.livePrices.get(this.activePool.tokenMint);
      if (cached && Date.now() - cached.observedAt <= LivePaperLoop.LIVE_PRICE_MAX_AGE_MS) {
        console.log(formatScreenerContext(cached));
      }
    }

    // Manage an open strategy position on EVERY tick with the live monitor
    // bar. Jupiter is quoted only on actionable SELL.
    if (this.strategyPosition) {
      // Proposal only: pure function, authoritative state commits below
      // after quotes succeed. A failed quote keeps the old position and the
      // candle is retried, never wedged.
      const proposal = managePosition(this.strategyPosition, monitor, analysis);
      const sells = proposal.actions.filter(
        (a) => a.type === "partial-take-profit" || a.type === "full-exit",
      );

      // Phase 1: pre-quote every planned sell BEFORE touching any state.
      // If any quote fails, the proposal is discarded, the authoritative
      // position is untouched, and the candle is retried next tick.
      const planned: {
        action: (typeof sells)[number];
        fraction: number;
        quote: Awaited<ReturnType<JupiterPaperBroker["quote"]>>;
      }[] = [];
      for (const action of sells) {
        const fraction =
          action.type === "full-exit"
            ? 1
            : Math.min(1, action.quantitySol / (proposal.position.originalSizeSol || action.quantitySol));
        const amount = this.account.plannedSellAmount(fraction);
        const quote = await this.jupiter.quote(this.activePool.tokenMint, this.config.solMint, amount);
        if (quote.transactionPresent) {
          throw new Error("Safety check failed: paper quote unexpectedly contains a transaction");
        }
        planned.push({ action, fraction, quote });
      }

      // Phase 2: all quotes good — execute, then commit the proposal once.
      try {
        for (const { action, fraction, quote } of planned) {
          const balanceBefore = this.account.balanceSol;
          const realizedBefore = this.account.snapshot().realizedPnlSol;
          await this.account.sell(
            this.jupiter,
            this.config.solMint,
            this.activePool.tokenMint,
            fraction,
            action.price,
            action.reason,
            quote,
          );
          const snap = this.account.snapshot();
          console.log(
            `PAPER SELL ${action.type} out=${quote.outAmount.toString()} lamports router=${quote.router ?? "?"} (${action.reason})`,
          );

          const trade = snap.trades.at(-1)!;
          const tradeNo = this.store.state.stats.trades;
          await this.store.recordTrade({
            eventId: trade.eventId,
            time: trade.time,
            side: "sell",
            tradeNo,
            tokenMint: this.activePool.tokenMint,
            tokenSymbol: token.symbol,
            poolAddress: this.activePool.poolAddress,
            dex: token.dex,
            chain: token.chain,
            requestedSol: trade.requestedSol,
            actualSol: trade.actualSol,
            tokenAmountRaw: trade.tokenAmountRaw.toString(),
            marketPriceUsd: action.price,
            router: trade.router,
            priceImpactPct: trade.priceImpactPct,
            requestId: trade.requestId,
            reason: action.reason,
            balanceAfterSol: snap.solBalance,
            realizedPnlSol: snap.realizedPnlSol,
          });

          if (action.type === "full-exit") {
            const pnl = snap.realizedPnlSol - realizedBefore;
            const stats = this.store.state.stats;
            const won = pnl > 0;
            this.strategyPosition = null;
            await this.store.save({
              balanceSol: snap.solBalance,
              realizedPnlSol: snap.realizedPnlSol,
              paperPosition: null,
              strategyPosition: null,
              stats: {
                trades: stats.trades,
                wins: stats.wins + (won ? 1 : 0),
                losses: stats.losses + (won ? 0 : 1),
              },
              // The sell leg must persist here: this branch returns
              // without reaching persistAccountAndStrategy below.
              trades: snap.trades.map((t) => ({ ...t, tokenAmountRaw: t.tokenAmountRaw.toString() })),
            });
            const openedAt = proposal.position.openedAt;
            const closedAt = new Date().toISOString();
            const buyTrade = snap.trades.find((t) => t.side === "buy");
            await telegram(
              paperCloseMessage({
                token,
                tradeNo,
                won,
                entryPriceUsd: proposal.position.entryPrice,
                exitPriceUsd: action.price,
                exitReason: action.reason,
                pnlSol: pnl,
                pnlPct:
                  proposal.position.originalSizeSol > 0 ? (pnl / proposal.position.originalSizeSol) * 100 : 0,
                durationMs: Date.parse(closedAt) - Date.parse(openedAt),
                openedAt,
                closedAt,
                balanceBeforeSol: balanceBefore,
                balanceAfterSol: snap.solBalance,
                wins: stats.wins + (won ? 1 : 0),
                losses: stats.losses + (won ? 0 : 1),
                realizedPnlSol: snap.realizedPnlSol,
                router: trade.router,
                executionNote:
                  buyTrade !== undefined
                    ? `Exec: ${buyTrade.tokenAmountRaw.toString()} units for ${buyTrade.actualSol.toFixed(6)} SOL → ${trade.actualSol.toFixed(6)} SOL (signal $${proposal.position.entryPrice.toFixed(8)} → $${action.price.toFixed(8)})`
                    : undefined,
              }),
            ).catch((e) => console.error("Telegram close report failed:", e));
          } else {
            await telegram(
              paperPartialMessage({
                token,
                tradeNo,
                fraction,
                soldSolNominal: trade.requestedSol,
                receivedSol: trade.actualSol,
                remainingSol: snap.position?.remainingSizeSol ?? 0,
                newStopUsd: proposal.position.currentStopPrice,
                reason: action.reason,
                balanceAfterSol: snap.solBalance,
              }),
            ).catch((e) => console.error("Telegram partial report failed:", e));
          }
        }

        // Commit stop moves / trailing (no execution involved).
        // If sells ran above, proposal.position already reflects them.
        if (this.strategyPosition !== null || sells.length === 0) {
          this.strategyPosition = proposal.position.status === "closed" ? null : proposal.position;
          await this.persistAccountAndStrategy();
        }
        for (const action of proposal.actions) {
          if (action.type === "stop-moved") {
            console.log(`Stop moved -> $${proposal.position.currentStopPrice.toFixed(8)} (${action.reason})`);
          }
        }
      } catch (error) {
        // Quote/store failure: authoritative strategy position is untouched
        // (proposal discarded) and the candle stays unprocessed for retry.
        console.error("Sell execution failed, keeping position for retry:", error instanceof Error ? error.message : error);
        throw error;
      }
    }

    // Entries only on NEW closed candles with no open position.
    // Course order: eligibility (real market cap) -> SAFETY PASS ->
    // setup -> confirmation -> Jupiter quote. Jupiter quoted only on
    // CONFIRMED.
    if (isNewClosedCandle && !this.strategyPosition && !this.account.openPosition) {
      const entered = await this.tryEnter(
        this.activePool.poolAddress,
        this.activePool.tokenMint,
        token,
        analysis,
        candles,
        candles.at(-1)!.timeClose,
        closedPrice,
        this.candidateFor(this.activePool.poolAddress),
      );
      if (!entered && this.watchlist.length > 0) {
        await this.evaluateWatchlist();
      }
      return;
    }

    if (!isNewClosedCandle) return;
    console.log(
      `Paper balance: ${this.account.balanceSol.toFixed(6)} SOL | Position: ${this.account.openPosition ? `OPEN remaining=${this.account.openPosition.remainingSizeSol.toFixed(6)} SOL` : "NONE"}`,
    );
  }

  /** Watchlist eligibility for a pool, or null when unscanned. */
  private candidateFor(poolAddress: string): WatchCandidate | null {
    return this.watchlist.find((c) => c.poolAddress === poolAddress) ?? null;
  }

  /**
   * Eligibility -> setup -> confirm -> momentum -> SAFETY -> entry-size
   * -> paper BUY. Returns true when a position was opened. FDV-proxy /
   * age-compatible candidates, red-tape momentum, and REJECT safety
   * never reach execution.
   */
  private async tryEnter(
    poolAddress: string,
    tokenMint: string,
    token: TokenContext,
    analysis: ReturnType<typeof analyzeMarket>,
    candles: Candle[],
    candleTimeClose: string,
    closedPrice: number,
    candidate: WatchCandidate | null,
  ): Promise<boolean> {
    // Course order, API-aware: eligibility (cached, free) and the
    // structure setup (have candles, free) come first; network providers
    // (Screener momentum, safety) are only queried on CONFIRMED setups.
    if (!candidate || candidate.eligibility !== "ready") {
      console.log(
        `ENTRY BLOCKED (${token.symbol}): eligibility=BLOCKED — ${candidate?.eligibilityReason ?? "pool not in eligible watchlist (market cap unavailable)"}`,
      );
      return false;
    }

    const setup = detectSetup(analysis, {
      supportTolerancePct: this.config.supportTolerancePct,
      breakoutPct: this.config.breakoutPct,
      enableRangeBreak: this.config.enableRangeBreak,
    });
    const confirmed = confirmSetup(setup, closedPrice);

    if (confirmed.status !== "confirmed") {
      if (poolAddress === this.activePool.poolAddress) {
        console.log(`Setup: ${confirmed.type} ${confirmed.status} | balance=${this.account.balanceSol.toFixed(6)} SOL`);
      }
      return false;
    }

    // Real safety data: RPC holder concentration + DEX paid orders.
    // Insiders/bundles/dev/snipers/clusters/fees/chart stay unknown.
    const safety = assessSafety(await fetchSafetyInput(config.solana.rpcUrl, tokenMint));
    const policy = entryPolicy(safety.decision);
    const top10 = safety.top10HolderConcentration.value;
    console.log(
      `SAFETY-ENTRY ${token.symbol}: decision=${safety.decision} ` +
        `top10=${top10 === null ? "unknown" : `${top10.toFixed(1)}%`} dexPaid=${String(safety.dexPaid.value)} ` +
        `-> ${policy.label}`,
    );
    if (!policy.allowed) {
      console.log(`ENTRY BLOCKED (${token.symbol}): safety=${safety.decision} — ${safety.reasons.slice(0, 3).join("; ")}`);
      return false;
    }

    // Volatility stop floor: structural stops inside ~1× 14-candle ATR
    // are wiggle-outs, not risk control. Fail closed on unknown ATR.
    const floorMult = this.config.atrStopFloorMultiplier;
    const atrPct = floorMult > 0 ? meanTrueRangePct(candles, 14) : null;
    const minStopDistancePct =
      floorMult > 0 ? (atrPct === null ? Number.POSITIVE_INFINITY : atrPct * floorMult) : undefined;

    const entry = createEntryDecision(confirmed, this.account.balanceSol, {
      riskPerTradePct: this.config.riskPerTradePct,
      minPositionSol: this.config.minPositionSol,
      // Paper risk scaling: WATCH trades half size, PASS full size.
      maxPositionSol: this.config.maxPositionSol * policy.sizeFraction,
      minStopDistancePct,
    });

    if (entry.status !== "ready") {
      console.log(`Entry not ready (${token.symbol}): ${entry.reasons.join(",")}`);
      return false;
    }

    await this.executeBuy(poolAddress, tokenMint, token, candleTimeClose, closedPrice, confirmed, entry);
    await telegram(
      `🛡️ Safety @ entry — ${token.symbol} (${safety.decision.toUpperCase()}, ${policy.label})\n\n` +
        formatSafetyReport(safety),
    ).catch((e) => console.error("Telegram safety report failed:", e));
    return true;
  }

  private async executeBuy(
    poolAddress: string,
    tokenMint: string,
    token: TokenContext,
    candleTimeClose: string,
    closedPrice: number,
    confirmed: SetupSignal,
    entry: EntryDecision,
  ): Promise<void> {
    const balanceBefore = this.account.balanceSol;
    const quote = await this.account.buy(
      this.jupiter,
      this.config.solMint,
      tokenMint,
      entry.positionSol,
      closedPrice,
      "breakout-confirmed",
    );
    const snap = this.account.snapshot();

    this.strategyPosition = createPosition({
      tokenAddress: tokenMint,
      poolAddress,
      entryPrice: entry.entryPrice,
      positionSol: entry.positionSol,
      stopPrice: entry.stopPrice,
      targets: this.config.targets.map((t) => ({
        id: t.id,
        triggerPrice: entry.entryPrice * (1 + t.profitPct / 100),
        sellFraction: t.sellFraction,
      })),
      openedAt: candleTimeClose,
    });

    const tradeNo = this.store.state.stats.trades + 1;
    await this.store.save({
      balanceSol: snap.solBalance,
      realizedPnlSol: snap.realizedPnlSol,
      paperPosition: snap.position
        ? {
            ...snap.position,
            tokenAmountRaw: snap.position.tokenAmountRaw.toString(),
            originalTokenAmountRaw: snap.position.originalTokenAmountRaw.toString(),
          }
        : null,
      strategyPosition: this.strategyPosition,
      stats: { ...this.store.state.stats, trades: tradeNo },
      trades: snap.trades.map((t) => ({ ...t, tokenAmountRaw: t.tokenAmountRaw.toString() })),
    });
    const trade = snap.trades.at(-1)!;
    await this.store.recordTrade({
      eventId: trade.eventId,
      time: trade.time,
      side: "buy",
      tradeNo,
      tokenMint,
      tokenSymbol: token.symbol,
      poolAddress,
      dex: token.dex,
      chain: token.chain,
      requestedSol: trade.requestedSol,
      actualSol: trade.actualSol,
      tokenAmountRaw: trade.tokenAmountRaw.toString(),
      marketPriceUsd: closedPrice,
      router: trade.router,
      priceImpactPct: trade.priceImpactPct,
      requestId: trade.requestId,
      reason: "breakout-confirmed",
      balanceAfterSol: snap.solBalance,
      realizedPnlSol: snap.realizedPnlSol,
    });
    await telegram(
      paperOpenMessage({
        token,
        tradeNo,
        setupType: confirmed.type,
        entryPriceUsd: entry.entryPrice,
        stopPriceUsd: entry.stopPrice,
        triggerPriceUsd: confirmed.triggerPrice,
        positionSol: entry.positionSol,
        maxPositionSol: this.config.maxPositionSol,
        balanceBeforeSol: balanceBefore,
        balanceAfterSol: snap.solBalance,
        router: trade.router,
        priceImpactPct: trade.priceImpactPct,
        requestId: trade.requestId,
      }),
    ).catch((e) => console.error("Telegram open report failed:", e));

    console.log(
      `PAPER BUY ${token.symbol} in=${quote.inAmount.toString()} out=${quote.outAmount.toString()} router=${quote.router ?? "?"} balance=${this.account.balanceSol.toFixed(6)} SOL`,
    );
  }

  /**
   * Rotation: while flat, check each watchlist pool (15m, in-plan form)
   * for a confirmed setup. First ready entry wins and becomes the
   * tracked pool. Bounded by watchlist size to spare API credits.
   */
  private async evaluateWatchlist(): Promise<void> {
    for (const candidate of this.watchlist) {
      if (this.strategyPosition || this.account.openPosition) return;
      if (candidate.poolAddress === this.activePool.poolAddress) continue;
      if (candidate.eligibility !== "ready") continue;
      let candles: Candle[];
      try {
        candles = await getPoolCandles(this.paprika, candidate.poolAddress, {
          start: "-7d",
          interval: CANDLE_INTERVAL,
          limit: this.config.analysisWindowCandles,
        });
      } catch (error) {
        console.error(`Watch ${candidate.tokenSymbol} candles failed:`, error instanceof Error ? error.message : error);
        continue;
      }
      if (candles.length < 20) continue;
      const last = candles.at(-1)!;
      const analysis = analyzeMarket(candles, last.close, this.config.swingLookback, this.config.levelTolerancePct);
      const token = await this.resolveTokenContext(candidate.poolAddress, candidate.tokenAddress);
      let entered = false;
      try {
        entered = await this.tryEnter(
          candidate.poolAddress,
          candidate.tokenAddress,
          token,
          analysis,
          candles,
          last.timeClose,
          last.close,
          candidate,
        );
      } catch (error) {
        console.error(`Watch ${candidate.tokenSymbol} entry failed:`, error instanceof Error ? error.message : error);
        continue;
      }
      if (entered) {
        await this.switchActivePool(candidate.poolAddress, candidate.tokenAddress, last.timeClose);
        return;
      }
    }
    console.log(
      `Paper balance: ${this.account.balanceSol.toFixed(6)} SOL | Position: NONE | watchlist: ${this.watchlist.length} checked, no entry`,
    );
  }
}
