# trading_bot_2026 — Memecoin Paper-Trading Bot (Solana)

Bun + TypeScript bot implementing an SRT-derived memecoin strategy
(Phase 2/3 revival setups) through Modules 1–13. Paper trading only:
no transaction is ever signed or sent.

## Pipeline

```text
DexPaprika discovery/OHLCV (Modules 1–5)
  → market structure: swings, HH/HL, trend, S/R (Module 6)
  → setup detection: reversal / continuation, WATCH / CONFIRMED (Module 7)
  → confirmation + structural position sizing (Module 8)
  → position management: partial TP, structural trailing, failure exit (Module 9)
  → historical replay / backtest (Module 10)
  → Jupiter paper quotes + virtual wallet (Modules 11–12)
  → live paper loop (Module 13)
```

Jupiter `/swap/v2/order` is quote-only (`taker` omitted, guarded by
`transactionPresent` checks). DexPaprika is the monitoring source;
Jupiter is quoted only on actionable entry/exit.

## Setup

```bash
cp .env.example .env   # then fill in keys
bun install
```

## Commands

```bash
bun run start               # Module 10 historical replay (technical test)
bun run paper-live          # Module 13 live paper loop (daemon target)
bun run paper-jupiter       # Module 12 BUY→SELL virtual-account test
bun run quote-jupiter       # Module 11 live quote check
bun run simulate            # Module 9 position state-machine walkthrough
bun run simulate-execution  # historical execution-model fixtures
bun test                    # unit tests (account, position, structure, backtest)
bun run tsc --noEmit        # typecheck
```

## State & data (gitignored, machine-local)

- `state/paper-state.json` — lowdb: balance, open positions, stats, last candle
- `data/trades.duckdb` — DuckDB ledger of every paper trade (analysis source)

## Deploy

```bash
oxmgr apply ./oxfile.toml
oxmgr logs memecoin-paper-bot -f
./scripts/ox-health.sh; echo $?
```
