import type { CandidateToken } from "../models";
import type { Candle } from "../market/ohlcv";
import { analyzeMarket } from "../strategy/structure";
import { detectSetup } from "../strategy/setup";
import { confirmSetup } from "../strategy/confirmation";
import { createEntryDecision } from "../strategy/entry";
import { createPosition, managePosition, type Position } from "../strategy/position";
import type { BacktestConfig, BacktestResult, BacktestTrade } from "./types";

function pnlPct(entryPrice: number, exitPrice: number): number {
  return ((exitPrice - entryPrice) / entryPrice) * 100;
}

function pnlSol(positionSol: number, percentage: number): number {
  return (positionSol * percentage) / 100;
}

function emptyResult(balance: number): BacktestResult {
  return {
    startingBalanceSol: balance,
    endingBalanceSol: balance,
    totalPnlSol: 0,
    totalPnlPct: 0,
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    winRatePct: 0,
    maxDrawdownSol: 0,
    maxDrawdownPct: 0,
    totalCostsSol: 0,
    trades: [],
  };
}

export function runBacktest(
  token: CandidateToken,
  candles: Candle[],
  config: BacktestConfig,
): BacktestResult {
  if (candles.length === 0) {
    return emptyResult(config.startingBalanceSol);
  }

  let balance = config.startingBalanceSol;
  let peakEquity = balance;
  let maxDrawdownSol = 0;
  let maxDrawdownPct = 0;

  // Mark-to-market equity: settled balance + open position value.
  // Without this, drawdown ignores unrealized losses while in a trade.
  const equity = () => {
    if (position !== null && activeTrade !== null && activeTrade.entryPrice > 0) {
      const last = candles[candleIndex]!;
      const mtm = position.remainingSizeSol * (last.close / activeTrade.entryPrice);
      return balance + mtm;
    }
    return balance;
  };

  const trackDrawdown = () => {
    const eq = equity();
    if (eq > peakEquity) {
      peakEquity = eq;
      return;
    }
    const ddSol = peakEquity - eq;
    const ddPct = peakEquity > 0 ? (ddSol / peakEquity) * 100 : 0;
    if (ddSol > maxDrawdownSol) maxDrawdownSol = ddSol;
    if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;
  };

  let position: Position | null = null;
  let activeTrade: BacktestTrade | null = null;
  const trades: BacktestTrade[] = [];
  let candleIndex = 0;
  let exitedThisCandle = false;
  let totalCostsSol = 0;

  const costRate = (config.costPerSideBps ?? 0) / 10_000;

  for (let i = 0; i < candles.length; i++) {
    candleIndex = i;
    exitedThisCandle = false;
    const candle = candles[i]!;

    /*
     * Only candles through `i` are visible.
     * This prevents look-ahead. A swing pivot only becomes
     * visible after `swingLookback` confirmation bars exist
     * inside the window.
     */
    const startIndex = Math.max(0, i - config.analysisWindowCandles + 1);
    const window = candles.slice(startIndex, i + 1);

    if (window.length < 20) {
      continue;
    }

    const currentPrice = candle.close;
    const analysis = analyzeMarket(window, currentPrice, config.swingLookback, config.levelTolerancePct);

    /*
     * EXISTING POSITION (full OHLC bar: stop-first on intrabar ambiguity).
     */
    if (position !== null && activeTrade !== null) {
      const trade = activeTrade;
      const update = managePosition(
        position,
        { price: candle.close, high: candle.high, low: candle.low },
        analysis,
      );
      position = update.position;

      trade.maxPrice = Math.max(trade.maxPrice, candle.high);
      trade.barsHeld++;

      for (const action of update.actions) {
        if (action.type === "partial-take-profit") {
          const profitPct = pnlPct(trade.entryPrice, action.price);
          const realized = pnlSol(action.quantitySol, profitPct);
          const cost = (action.quantitySol + realized) * costRate;
          trade.realizedPnlSol += realized - cost;
          balance += realized - cost;
          totalCostsSol += cost;
          trade.partialExits++;
        }

        if (action.type === "full-exit") {
          const profitPct = pnlPct(trade.entryPrice, action.price);
          const realized = pnlSol(action.quantitySol, profitPct);
          const cost = (action.quantitySol + realized) * costRate;
          trade.realizedPnlSol += realized - cost;
          balance += realized - cost;
          totalCostsSol += cost;

          trade.exitTime = candle.timeClose;
          trade.exitPrice = action.price;
          trade.exitReason = action.reason;
          trade.pnlSol = trade.realizedPnlSol;
          trade.pnlPct =
            trade.positionSol > 0 ? (trade.pnlSol / trade.positionSol) * 100 : 0;

          trades.push(trade);
          activeTrade = null;
          position = null;
          exitedThisCandle = true;
        }

        // stop-moved: no balance change.
      }
    }

    /*
     * NO POSITION → SEARCH FOR ENTRY (never re-enter on an exit candle).
     */
    if (position === null && activeTrade === null && !exitedThisCandle) {
      const setup = detectSetup(analysis, {
        supportTolerancePct: config.supportTolerancePct,
        breakoutPct: config.breakoutPct,
        enableRangeBreak: config.enableRangeBreak,
      });

      const confirmed = confirmSetup(setup, currentPrice);

      if (confirmed.status !== "confirmed") {
        trackDrawdown();
        continue;
      }

      const entry = createEntryDecision(confirmed, balance, {
        riskPerTradePct: config.riskPerTradePct,
        minPositionSol: config.minPositionSol,
        maxPositionSol: config.maxPositionSol,
      });

      if (entry.status !== "ready") {
        continue;
      }

      /*
       * INTRABAR SAFETY: entered on a closed-candle breakout,
       * but if this same candle also traded below the stop,
       * intra-candle order is unknown. Reject the ambiguous entry.
       */
      if (candle.low <= entry.stopPrice) {
        continue;
      }

      const entryCost = entry.positionSol * costRate;
      balance -= entryCost;
      totalCostsSol += entryCost;

      const targets = config.targets.map((target) => ({
        id: target.id,
        triggerPrice: entry.entryPrice * (1 + target.profitPct / 100),
        sellFraction: target.sellFraction,
      }));

      position = createPosition({
        tokenAddress: token.tokenAddress,
        poolAddress: token.poolAddress,
        entryPrice: entry.entryPrice,
        positionSol: entry.positionSol,
        stopPrice: entry.stopPrice,
        targets,
        openedAt: candle.timeClose,
      });

      activeTrade = {
        tokenAddress: token.tokenAddress,
        poolAddress: token.poolAddress,
        entryTime: candle.timeClose,
        entryPrice: entry.entryPrice,
        positionSol: entry.positionSol,
        initialStopPrice: entry.stopPrice,
        exitTime: null,
        exitPrice: null,
        pnlSol: 0,
        pnlPct: 0,
        exitReason: null,
        partialExits: 0,
        realizedPnlSol: 0,
        maxPrice: candle.high,
        barsHeld: 0,
      };
    }

    trackDrawdown();
  }

  /*
   * Close an unfinished trade at the final candle.
   * Forced end-of-data exit, not a strategy signal.
   */
  if (position !== null && activeTrade !== null) {
    const last = candles.at(-1);
    if (last) {
      const remaining = position.remainingSizeSol;
      if (remaining > 0) {
        const profit = pnlPct(activeTrade.entryPrice, last.close);
        const realized = pnlSol(remaining, profit);
        const cost = (remaining + realized) * costRate;
        activeTrade.realizedPnlSol += realized - cost;
        balance += realized - cost;
        totalCostsSol += cost;
      }
      activeTrade.exitTime = last.timeClose;
      activeTrade.exitPrice = last.close;
      activeTrade.exitReason = "end-of-data";
      activeTrade.pnlSol = activeTrade.realizedPnlSol;
      activeTrade.pnlPct =
        activeTrade.positionSol > 0
          ? (activeTrade.pnlSol / activeTrade.positionSol) * 100
          : 0;
      trades.push(activeTrade);
      activeTrade = null;
      position = null;
    }
  }

  // The forced exit changed equity: track it before finalizing.
  trackDrawdown();

  const winningTrades = trades.filter((t) => t.pnlSol > 0).length;
  const losingTrades = trades.filter((t) => t.pnlSol < 0).length;
  const totalPnlSol = balance - config.startingBalanceSol;
  const totalPnlPct =
    config.startingBalanceSol > 0 ? (totalPnlSol / config.startingBalanceSol) * 100 : 0;

  return {
    startingBalanceSol: config.startingBalanceSol,
    endingBalanceSol: balance,
    totalPnlSol,
    totalPnlPct,
    totalTrades: trades.length,
    winningTrades,
    losingTrades,
    winRatePct: trades.length > 0 ? (winningTrades / trades.length) * 100 : 0,
    maxDrawdownSol,
    maxDrawdownPct,
    totalCostsSol,
    trades,
  };
}
