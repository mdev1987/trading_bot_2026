#!/bin/sh
# oxmgr health probe for memecoin-paper-bot.
# The paper loop rewrites state/paper-state.json on every processed candle
# (closed 15m candles; position monitoring runs every poll cycle), while
# stdout is quiet when the setup is WATCH — so log mtime is NOT a liveness
# signal. Stale state (>30 min) means the loop is stuck or wedged on I/O.
# Missing file = fresh boot, pass so the first check does not kill startup.
STATE_FILE="/home/mdev/Programming/trading_bot_2026/state/paper-state.json"
test ! -f "$STATE_FILE" && exit 0
test -n "$(/usr/bin/find "$STATE_FILE" -mmin -30 2>/dev/null)"
