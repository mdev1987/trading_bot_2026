import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import type { PaperPosition } from "./account";
import type { Position as StrategyPosition } from "../strategy/position";

export interface SerializedPaperPosition extends Omit<PaperPosition, "tokenAmountRaw"> {
  tokenAmountRaw: string;
}

export interface PersistedState {
  balanceSol: number;
  realizedPnlSol: number;
  paperPosition: SerializedPaperPosition | null;
  strategyPosition: StrategyPosition | null;
  stats: { trades: number; wins: number; losses: number };
  lastProcessedCandle: string;
}

export interface LedgerRow {
  time: string;
  side: "buy" | "sell";
  tradeNo: number;
  tokenMint: string;
  tokenSymbol: string;
  poolAddress: string;
  dex: string;
  chain: string;
  requestedSol: number;
  actualSol: number;
  tokenAmountRaw: string;
  marketPriceUsd: number;
  router: string | null;
  priceImpactPct: number | null;
  requestId: string;
  reason: string;
  balanceAfterSol: number;
  realizedPnlSol: number;
}

const DEFAULT_STATE: PersistedState = {
  balanceSol: 1.0,
  realizedPnlSol: 0,
  paperPosition: null,
  strategyPosition: null,
  stats: { trades: 0, wins: 0, losses: 0 },
  lastProcessedCandle: "",
};

const num = (v: number): string => (Number.isFinite(v) ? String(v) : "NULL");
const str = (v: string | null): string =>
  v == null ? "NULL" : `'${v.replace(/'/g, "''")}'`;

/** lowdb JSON state (open positions, balance, stats) + DuckDB trade ledger. */
export class PaperStore {
  private readonly db: Low<PersistedState>;
  private duck: DuckDBInstance | null = null;
  private conn: DuckDBConnection | null = null;

  constructor(
    private readonly stateFile: string,
    private readonly ledgerFile: string,
  ) {
    mkdirSync(dirname(stateFile), { recursive: true });
    mkdirSync(dirname(ledgerFile), { recursive: true });
    this.db = new Low<PersistedState>(new JSONFile<PersistedState>(stateFile), DEFAULT_STATE);
  }

  async init(): Promise<PersistedState> {
    await this.db.read();
    this.db.data ||= structuredClone(DEFAULT_STATE);
    this.duck = await DuckDBInstance.create(this.ledgerFile);
    this.conn = await this.duck.connect();
    await this.conn.run(`
      CREATE TABLE IF NOT EXISTS paper_trades(
        time TEXT, side TEXT, trade_no INTEGER,
        token_mint TEXT, token_symbol TEXT, pool_address TEXT, dex TEXT, chain TEXT,
        requested_sol DOUBLE, actual_sol DOUBLE, token_amount_raw TEXT,
        market_price_usd DOUBLE, router TEXT, price_impact_pct DOUBLE,
        request_id TEXT, reason TEXT,
        balance_after_sol DOUBLE, realized_pnl_sol DOUBLE
      )`);
    return this.db.data;
  }

  get state(): PersistedState {
    return this.db.data;
  }

  async save(patch: Partial<PersistedState>): Promise<void> {
    Object.assign(this.db.data, patch);
    await this.db.write();
  }

  async recordTrade(row: LedgerRow): Promise<void> {
    if (!this.conn) throw new Error("PaperStore not initialised");
    await this.conn.run(
      `INSERT INTO paper_trades VALUES (${[
        str(row.time),
        str(row.side),
        num(row.tradeNo),
        str(row.tokenMint),
        str(row.tokenSymbol),
        str(row.poolAddress),
        str(row.dex),
        str(row.chain),
        num(row.requestedSol),
        num(row.actualSol),
        str(row.tokenAmountRaw),
        num(row.marketPriceUsd),
        str(row.router),
        row.priceImpactPct == null ? "NULL" : num(row.priceImpactPct),
        str(row.requestId),
        str(row.reason),
        num(row.balanceAfterSol),
        num(row.realizedPnlSol),
      ].join(",")})`,
    );
  }

  async close(): Promise<void> {
    this.conn?.closeSync();
    this.duck?.closeSync();
    this.conn = null;
    this.duck = null;
  }
}
