const NETWORK = process.env.DEXPAPRIKA_NETWORK ?? "solana";

export const config = {
  dexPaprika: {
    apiKey: process.env.DEXPAPRIKA_API_KEY || undefined,
    network: NETWORK,
  },

  discovery: {
    newPoolLimit: 20,
  },

  jupiter: {
    apiKey: process.env.JUPITER_API_KEY || undefined,
  },

  telegram: {
    enabled: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
    token: process.env.TELEGRAM_BOT_TOKEN ?? "",
    chatId: process.env.TELEGRAM_CHAT_ID ?? "",
  },

  paths: {
    stateFile: process.env.PAPER_STATE_FILE ?? "state/paper-state.json",
    ledgerFile: process.env.LEDGER_FILE ?? "data/trades.duckdb",
  },
} as const;

export const tradingConfig = {
  accountBalanceSol: 1.0,

  riskPerTradePct: 1.0,

  minPositionSol: 0.02,
  maxPositionSol: 0.1,
} as const;

/**
 * Single source of truth for strategy parameters (SRT-derived values plus
 * engineering test parameters). All runners (backtest, paper-live) read
 * from here so values cannot drift between copies.
 */
export const strategyConfig = {
  swingLookback: 3,
  levelTolerancePct: 0.75,
  supportTolerancePct: 1.0,
  breakoutPct: 0.25,
  analysisWindowCandles: 672,
  /** Paper-test profit targets (engineering parameters, NOT SRT rules). */
  targets: [
    { id: "tp1", profitPct: 25, sellFraction: 0.25 },
    { id: "tp2", profitPct: 50, sellFraction: 0.5 },
  ],
} as const;
