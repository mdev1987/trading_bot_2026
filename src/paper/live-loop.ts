import { DexPaprikaData } from "../dexpaprika";
import { JupiterPaperBroker } from "../execution/jupiter-paper";
import { PaperAccount } from "./account";
import { PaperStore } from "./store";
import { analyzeMarket } from "../strategy/structure";
import { detectSetup } from "../strategy/setup";
import { confirmSetup } from "../strategy/confirmation";
import { createEntryDecision } from "../strategy/entry";
import { createPosition, managePosition, type Position } from "../strategy/position";
import type { Candle } from "../market/ohlcv";
import { config } from "../config";
import {
  telegram,
  paperOpenMessage,
  paperPartialMessage,
  paperCloseMessage,
  type TokenContext,
} from "../telegram";

const INTERVAL_MS = 15_000;
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

    // Recover persisted state (open position, balance, stats).
    const persisted = await this.store.init();
    if (persisted.balanceSol !== this.config.startingBalanceSol || persisted.paperPosition) {
      this.account.restoreState({
        solBalance: persisted.balanceSol,
        realizedPnlSol: persisted.realizedPnlSol,
        position: persisted.paperPosition,
      });
    }
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

    while (this.running) {
      try {
        await this.tick();
      } catch (error) {
        console.error("Paper loop error:", error instanceof Error ? error.message : error);
      }
      await Bun.sleep(INTERVAL_MS);
    }
  }

  stop(): void {
    this.running = false;
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

    // Drop the still-forming candle: only closed candles confirm signals,
    // consistent with the closed-candle replay assumption.
    const maybeForming = rows.at(-1)!;
    if (new Date(maybeForming.time_close).getTime() > Date.now()) {
      rows.pop();
    }

    const closed = rows.at(-1);
    if (!closed) return;
    if (closed.time_close === this.lastProcessedCandle) return;
    this.lastProcessedCandle = closed.time_close;
    await this.store.save({ lastProcessedCandle: closed.time_close });

    console.log(`[${closed.time_close}] close=$${closed.close.toFixed(8)}`);

    const candles: Candle[] = rows.map((r) => ({
      timeOpen: r.time_open,
      timeClose: r.time_close,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume,
    }));

    await this.processStrategy(candles, closed.close);
  }

  private async processStrategy(candles: Candle[], currentPrice: number): Promise<void> {
    const token = this.token!;
    const analysis = analyzeMarket(candles, currentPrice, this.config.swingLookback, this.config.levelTolerancePct);

    // Manage an open strategy position first. Jupiter is quoted only on actionable SELL.
    if (this.strategyPosition) {
      const openedAt = this.account.openPosition?.openedAt ?? new Date().toISOString();
      const update = managePosition(this.strategyPosition, currentPrice, analysis);
      this.strategyPosition = update.position.status === "closed" ? null : update.position;

      for (const action of update.actions) {
        if (action.type === "partial-take-profit" || action.type === "full-exit") {
          const balanceBefore = this.account.balanceSol;
          const realizedBefore = this.account.snapshot().realizedPnlSol;
          const fraction =
            action.type === "full-exit"
              ? 1
              : Math.min(1, action.quantitySol / (update.position.originalSizeSol || action.quantitySol));
          const quote = await this.account.sell(
            this.jupiter,
            this.config.solMint,
            this.config.tokenMint,
            fraction,
            currentPrice,
            action.reason,
          );
          const snap = this.account.snapshot();
          console.log(
            `PAPER SELL ${action.type} out=${quote.outAmount.toString()} lamports router=${quote.router ?? "?"} (${action.reason})`,
          );
          if (action.type === "full-exit") {
            this.strategyPosition = null;
          }

          const trade = snap.trades.at(-1)!;
          const tradeNo = this.store.state.stats.trades;
          await this.store.recordTrade({
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
            marketPriceUsd: currentPrice,
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
            const closedAt = new Date().toISOString();
            await telegram(
              paperCloseMessage({
                token,
                tradeNo,
                won,
                entryPriceUsd: update.position.entryPrice,
                exitPriceUsd: currentPrice,
                exitReason: action.reason,
                pnlSol: pnl,
                pnlPct:
                  update.position.originalSizeSol > 0 ? (pnl / update.position.originalSizeSol) * 100 : 0,
                durationMs: Date.parse(closedAt) - Date.parse(openedAt),
                openedAt,
                closedAt,
                balanceBeforeSol: balanceBefore,
                balanceAfterSol: snap.solBalance,
                wins: stats.wins + (won ? 1 : 0),
                losses: stats.losses + (won ? 0 : 1),
                realizedPnlSol: snap.realizedPnlSol,
                router: trade.router,
              }),
            ).catch((e) => console.error("Telegram close report failed:", e));
          } else {
            await this.store.save({
              balanceSol: snap.solBalance,
              realizedPnlSol: snap.realizedPnlSol,
              paperPosition: snap.position
                ? { ...snap.position, tokenAmountRaw: snap.position.tokenAmountRaw.toString() }
                : null,
              strategyPosition: this.strategyPosition,
            });
            await telegram(
              paperPartialMessage({
                token,
                tradeNo,
                fraction,
                soldSolNominal: trade.requestedSol,
                receivedSol: trade.actualSol,
                remainingSol: snap.position?.remainingSizeSol ?? 0,
                newStopUsd: update.position.currentStopPrice,
                reason: action.reason,
                balanceAfterSol: snap.solBalance,
              }),
            ).catch((e) => console.error("Telegram partial report failed:", e));
          }

          if (action.type === "full-exit") {
            this.strategyPosition = null;
          }
        } else if (action.type === "stop-moved") {
          console.log(`Stop moved -> $${update.position.currentStopPrice.toFixed(8)} (${action.reason})`);
          const snap = this.account.snapshot();
          await this.store.save({
            balanceSol: snap.solBalance,
            realizedPnlSol: snap.realizedPnlSol,
            paperPosition: snap.position
              ? { ...snap.position, tokenAmountRaw: snap.position.tokenAmountRaw.toString() }
              : null,
            strategyPosition: this.strategyPosition,
          });
        }
      }
    }

    // No position -> look for a confirmed entry. Jupiter quoted only on CONFIRMED.
    if (!this.strategyPosition && !this.account.openPosition) {
      const setup = detectSetup(analysis, {
        supportTolerancePct: this.config.supportTolerancePct,
        breakoutPct: this.config.breakoutPct,
      });
      const confirmed = confirmSetup(setup, currentPrice);

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
        currentPrice,
        "breakout-confirmed",
      );
      const snap = this.account.snapshot();

      this.strategyPosition = createPosition({
        tokenAddress: this.config.tokenMint,
        poolAddress: this.config.poolAddress,
        entryPrice: entry.entryPrice,
        positionSol: entry.positionSol,
        stopPrice: entry.stopPrice,
        targets: [
          { id: "tp1", triggerPrice: entry.entryPrice * 1.25, sellFraction: 0.25 },
          { id: "tp2", triggerPrice: entry.entryPrice * 1.5, sellFraction: 0.5 },
        ],
      });

      const tradeNo = this.store.state.stats.trades + 1;
      await this.store.save({
        balanceSol: snap.solBalance,
        realizedPnlSol: snap.realizedPnlSol,
        paperPosition: snap.position
          ? { ...snap.position, tokenAmountRaw: snap.position.tokenAmountRaw.toString() }
          : null,
        strategyPosition: this.strategyPosition,
        stats: { ...this.store.state.stats, trades: tradeNo },
      });
      const trade = snap.trades.at(-1)!;
      await this.store.recordTrade({
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
        marketPriceUsd: currentPrice,
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

    console.log(
      `Paper balance: ${this.account.balanceSol.toFixed(6)} SOL | Position: ${this.account.openPosition ? `OPEN remaining=${this.account.openPosition.remainingSizeSol.toFixed(6)} SOL` : "NONE"}`,
    );
  }
}
