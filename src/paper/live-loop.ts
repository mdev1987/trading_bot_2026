import { DexPaprikaData } from "../dexpaprika";
import { JupiterPaperBroker } from "../execution/jupiter-paper";
import { PaperAccount } from "./account";
import { PaperStore } from "./store";
import { analyzeMarket } from "../strategy/structure";
import { detectSetup } from "../strategy/setup";
import { confirmSetup } from "../strategy/confirmation";
import { createEntryDecision } from "../strategy/entry";
import { createPosition, managePosition, type MonitorBar, type Position } from "../strategy/position";
import type { Candle } from "../market/ohlcv";
import { config } from "../config";
import {
  telegram,
  paperOpenMessage,
  paperPartialMessage,
  paperCloseMessage,
  paperStartMessage,
  paperStopMessage,
  type TokenContext,
} from "../telegram";

const CANDLE_INTERVAL = "15m" as const;

const QUOTE_SYMBOLS = new Set(["SOL", "WSOL", "USDC", "USDT"]);

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

  constructor(
    private readonly config: LivePaperConfig,
    jupiterApiKey: string | undefined,
  ) {
    this.jupiter = new JupiterPaperBroker(jupiterApiKey ?? "");
    this.account = new PaperAccount(config.startingBalanceSol);
    this.store = new PaperStore(config.paths.stateFile, config.paths.ledgerFile);
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

    this.token = await this.resolveTokenContext();
    this.running = true;

    console.log("================================");
    console.log(" Module 13 - Live Paper Strategy");
    console.log("================================");
    console.log("Mode: paper-jupiter");
    console.log("Transactions: DISABLED");
    console.log(`Pool: ${this.config.poolAddress}`);
    console.log(`Token: ${this.token.symbol} (${this.token.dex})`);
    console.log(`Interval: ${CANDLE_INTERVAL}`);
    console.log();

    this.startedAt = new Date().toISOString();
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
        startedAt: this.startedAt,
      }),
    )
      .then(() => console.log("Telegram start report sent"))
      .catch((e) => console.error("Telegram start report failed:", e));

    while (this.running) {
      try {
        await this.tick();
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

  private async resolveTokenContext(): Promise<TokenContext> {
    const fallback: TokenContext = {
      name: "Unknown",
      symbol: "UNKNOWN",
      chain: this.paprika.network,
      dex: "unknown",
      ca: this.config.tokenMint,
      poolAddress: this.config.poolAddress,
      liquidityUsd: null,
    };
    try {
      const pool = await this.paprika.getPool(this.config.poolAddress);
      const dex = pool.dex_name ?? fallback.dex;
      const meme = (pool.tokens ?? []).find(
        (t) => !QUOTE_SYMBOLS.has((t.symbol ?? "").trim().toUpperCase()),
      );
      return {
        name: meme?.name ?? fallback.name,
        symbol: meme?.symbol ?? fallback.symbol,
        chain: this.paprika.network,
        dex,
        ca: this.config.tokenMint,
        poolAddress: this.config.poolAddress,
        liquidityUsd: null,
      };
    } catch (error) {
      console.error("Token context lookup failed, using fallback:", error instanceof Error ? error.message : error);
      return fallback;
    }
  }

  private async tick(): Promise<void> {
    // Relative window stays inside the plan's history (same form as the
    // working Module 6-10 calls). Absolute ISO ranges can 403.
    const rows = await this.paprika.getPoolOHLCV(this.config.poolAddress, {
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

    // Live monitor bar: forming candle when present, else the closed candle.
    // Stops/targets react to intrabar wicks; entries still need closed closes.
    const monitor: MonitorBar = lastIsForming
      ? { price: lastRow.close, high: lastRow.high, low: lastRow.low }
      : { price: closed.close, high: closed.high, low: closed.low };

    // A throw anywhere below leaves lastProcessedCandle untouched, so the
    // candle is retried next cycle instead of being silently skipped.
    await this.processStrategy(candles, closed.close, monitor, isNewClosedCandle);

    if (isNewClosedCandle) {
      this.lastProcessedCandle = closed.time_close;
      await this.store.save({ lastProcessedCandle: closed.time_close });
      console.log(`[${closed.time_close}] close=$${closed.close.toFixed(8)}`);
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
        const quote = await this.jupiter.quote(this.config.tokenMint, this.config.solMint, amount);
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
            this.config.tokenMint,
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
            tokenMint: this.config.tokenMint,
            tokenSymbol: token.symbol,
            poolAddress: this.config.poolAddress,
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
    // Jupiter quoted only on CONFIRMED.
    if (isNewClosedCandle && !this.strategyPosition && !this.account.openPosition) {
      const setup = detectSetup(analysis, {
        supportTolerancePct: this.config.supportTolerancePct,
        breakoutPct: this.config.breakoutPct,
      });
      const confirmed = confirmSetup(setup, closedPrice);

      if (confirmed.status !== "confirmed") {
        console.log(`Setup: ${confirmed.type} ${confirmed.status} | balance=${this.account.balanceSol.toFixed(6)} SOL`);
        return;
      }

      const entry = createEntryDecision(confirmed, this.account.balanceSol, {
        riskPerTradePct: this.config.riskPerTradePct,
        minPositionSol: this.config.minPositionSol,
        maxPositionSol: this.config.maxPositionSol,
      });

      if (entry.status !== "ready") {
        console.log(`Entry not ready: ${entry.reasons.join(",")}`);
        return;
      }

      const balanceBefore = this.account.balanceSol;
      const quote = await this.account.buy(
        this.jupiter,
        this.config.solMint,
        this.config.tokenMint,
        entry.positionSol,
        closedPrice,
        "breakout-confirmed",
      );
      const snap = this.account.snapshot();

      this.strategyPosition = createPosition({
        tokenAddress: this.config.tokenMint,
        poolAddress: this.config.poolAddress,
        entryPrice: entry.entryPrice,
        positionSol: entry.positionSol,
        stopPrice: entry.stopPrice,
        targets: this.config.targets.map((t) => ({
          id: t.id,
          triggerPrice: entry.entryPrice * (1 + t.profitPct / 100),
          sellFraction: t.sellFraction,
        })),
        openedAt: candles.at(-1)!.timeClose,
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
        tokenMint: this.config.tokenMint,
        tokenSymbol: token.symbol,
        poolAddress: this.config.poolAddress,
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
        `PAPER BUY in=${quote.inAmount.toString()} out=${quote.outAmount.toString()} router=${quote.router ?? "?"} balance=${this.account.balanceSol.toFixed(6)} SOL`,
      );
      return;
    }

    if (!isNewClosedCandle) return;
    console.log(
      `Paper balance: ${this.account.balanceSol.toFixed(6)} SOL | Position: ${this.account.openPosition ? `OPEN remaining=${this.account.openPosition.remainingSizeSol.toFixed(6)} SOL` : "NONE"}`,
    );
  }
}
