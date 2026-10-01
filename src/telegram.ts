import { Bot } from "grammy";
import { convert } from "telegram-markdown-v2";
import { config } from "./config.ts";

const bot = config.telegram.enabled ? new Bot(config.telegram.token) : null;
const MAX_MESSAGE_CHARS = 3900;

/** Split escaped text into sendable chunks. Exported for unit tests. */
export function splitMessage(text: string): string[] {
  if (text.length <= MAX_MESSAGE_CHARS) return [text];

  const chunks: string[] = [];
  let current = "";
  const pushLine = (line: string): void => {
    // A single line longer than the limit (e.g. a full contract address
    // repeated without newlines) must be hard-sliced — otherwise one chunk
    // would exceed Telegram's 4096-char limit and the send would fail.
    let rest = line;
    while (rest.length > MAX_MESSAGE_CHARS) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      let cut = MAX_MESSAGE_CHARS;
      // Never split a MarkdownV2 escape sequence: a chunk ending in a lone
      // backslash would unescape the next chunk's first char and fail the
      // whole send with a parse error.
      const trailing = rest.slice(0, cut).match(/\\+$/)?.[0].length ?? 0;
      if (trailing % 2 === 1) cut -= 1;
      chunks.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    const candidate = current ? `${current}\n${rest}` : rest;
    if (candidate.length > MAX_MESSAGE_CHARS && current) {
      chunks.push(current);
      current = rest;
    } else {
      current = candidate;
    }
  };
  for (const line of text.split("\n")) {
    pushLine(line);
  }
  if (current) chunks.push(current);
  return chunks;
}

export async function telegram(markdown: string): Promise<void> {
  if (!bot) return;

  const formatted = convert(markdown, "escape");
  for (const chunk of splitMessage(formatted)) {
    await bot.api.sendMessage(config.telegram.chatId, chunk, {
      parse_mode: "MarkdownV2",
      link_preview_options: { is_disabled: true },
    });
  }
}

export async function testTelegram(): Promise<void> {
  if (!bot) return;
  await bot.api.getMe();
}

/* ------------------------------------------------------------------ */
/* Paper-trading reports (Markdown source, escaped on send)            */
/* ------------------------------------------------------------------ */

export interface TokenContext {
  name: string;
  symbol: string;
  chain: string;
  dex: string;
  /** Contract address (token mint). */
  ca: string;
  poolAddress: string;
  /** Pool liquidity in USD, null when unknown. */
  liquidityUsd: number | null;
}

export interface OpenReport {
  token: TokenContext;
  tradeNo: number;
  setupType: string;
  entryPriceUsd: number;
  stopPriceUsd: number;
  triggerPriceUsd: number | null;
  positionSol: number;
  maxPositionSol: number;
  balanceBeforeSol: number;
  balanceAfterSol: number;
  router: string | null;
  priceImpactPct: number | null;
  requestId: string;
}

export interface PartialReport {
  token: TokenContext;
  tradeNo: number;
  fraction: number;
  soldSolNominal: number;
  receivedSol: number;
  remainingSol: number;
  newStopUsd: number | null;
  reason: string;
  balanceAfterSol: number;
}

export interface CloseReport {
  token: TokenContext;
  tradeNo: number;
  won: boolean;
  entryPriceUsd: number;
  exitPriceUsd: number;
  exitReason: string;
  pnlSol: number;
  pnlPct: number;
  durationMs: number;
  openedAt: string;
  closedAt: string;
  balanceBeforeSol: number;
  balanceAfterSol: number;
  wins: number;
  losses: number;
  realizedPnlSol: number;
  router: string | null;
  /** Optional signal-vs-execution note, e.g. quoted amounts vs signal prices. */
  executionNote?: string;
}

const fmtSol = (v: number, dp = 4): string => v.toFixed(dp);
const fmtUsd = (v: number): string => `$${v.toFixed(8)}`;
const fmtSigned = (v: number, dp = 4): string => `${v >= 0 ? "+" : ""}${v.toFixed(dp)}`;
const fmtPct = (v: number): string => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
const shortAddr = (a: string): string => (a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function tokenBlock(t: TokenContext): string {
  const liq = t.liquidityUsd == null ? "n/a" : `$${t.liquidityUsd.toLocaleString()}`;
  return (
    `🪙 ${t.name} (${t.symbol})\n` +
    `⛓️ Chain: ${t.chain} | 🏦 DEX: ${t.dex}\n` +
    `📄 CA: \`${t.ca}\`\n` +
    `💧 Liquidity: ${liq}`
  );
}

export function paperOpenMessage(r: OpenReport): string {
  return (
    `🟢 PAPER BUY #${r.tradeNo} — ${r.token.symbol}\n\n` +
    tokenBlock(r.token) +
    `\n\n⚙️ Setup: ${r.setupType}` +
    `\n💵 Entry: ${fmtUsd(r.entryPriceUsd)}` +
    `\n🛑 Stop: ${fmtUsd(r.stopPriceUsd)}` +
    `\n🎯 Trigger: ${r.triggerPriceUsd == null ? "n/a" : fmtUsd(r.triggerPriceUsd)}` +
    `\n\n📦 Pos size: ${fmtSol(r.positionSol)} SOL (max ${fmtSol(r.maxPositionSol)})` +
    `\n💰 Balance: ${fmtSol(r.balanceBeforeSol)} → ${fmtSol(r.balanceAfterSol)} SOL` +
    `\n🔀 Router: ${r.router ?? "n/a"} | Impact: ${r.priceImpactPct == null ? "n/a" : fmtPct(r.priceImpactPct)}` +
    `\n🆔 \`${shortAddr(r.requestId)}\`` +
    `\n\n_no transaction sent — paper only_`
  );
}

export function paperPartialMessage(r: PartialReport): string {
  return (
    `🟡 PARTIAL TP #${r.tradeNo} — ${r.token.symbol}\n\n` +
    `📤 Sold ${(r.fraction * 100).toFixed(0)}% (${fmtSol(r.soldSolNominal)} SOL nominal → ${fmtSol(r.receivedSol)} SOL)` +
    `\n📦 Remaining: ${fmtSol(r.remainingSol)} SOL` +
    (r.newStopUsd != null ? `\n🛑 Stop → ${fmtUsd(r.newStopUsd)}` : "") +
    `\n💰 Balance: ${fmtSol(r.balanceAfterSol)} SOL` +
    `\n📝 ${r.reason}`
  );
}

export interface StartReport {
  token: TokenContext;
  mode: string;
  interval: string;
  pollMs: number;
  balanceSol: number;
  realizedPnlSol: number;
  riskPerTradePct: number;
  minPositionSol: number;
  maxPositionSol: number;
  targets: { id: string; profitPct: number; sellFraction: number }[];
  resumed: boolean;
  openPositionSol: number | null;
  startedAt: string;
}

export interface StopReport {
  token: TokenContext | null;
  reason: string;
  startedAt: string | null;
  stoppedAt: string;
  balanceSol: number;
  realizedPnlSol: number;
  openPositionSol: number | null;
  lastCandle: string | null;
  trades: number;
  wins: number;
  losses: number;
}

export function paperStartMessage(r: StartReport): string {
  const targets = r.targets.map((t) => `${t.id} +${t.profitPct}% ×${Math.round(t.sellFraction * 100)}%`).join(" | ");
  return (
    `🚀 PAPER BOT STARTED — ${r.token.symbol}\n\n` +
    tokenBlock(r.token) +
    `\n\n⚙️ Mode: ${r.mode} — _no transaction sent, paper only_` +
    `\n📊 Interval: ${r.interval} | 🔄 Poll: ${(r.pollMs / 1000).toFixed(0)}s` +
    `\n💰 Balance: ${fmtSol(r.balanceSol)} SOL | 📈 Realized: ${fmtSigned(r.realizedPnlSol)} SOL` +
    `\n⚖️ Risk: ${r.riskPerTradePct.toFixed(2)}% | 📦 Size: ${fmtSol(r.minPositionSol)}–${fmtSol(r.maxPositionSol)} SOL` +
    `\n🎯 Targets: ${targets}` +
    `\n♻️ State: ${r.resumed ? "resumed from disk" : "fresh boot"}` +
    (r.openPositionSol != null ? `\n📦 Open position: ${fmtSol(r.openPositionSol)} SOL` : "") +
    `\n\n📅 Started: ${r.startedAt}`
  );
}

export function paperStopMessage(r: StopReport): string {
  const label = r.token ? ` — ${r.token.symbol}` : "";
  const uptime =
    r.startedAt != null ? formatDuration(Date.parse(r.stoppedAt) - Date.parse(r.startedAt)) : "n/a";
  const total = r.wins + r.losses;
  const winRate = total > 0 ? (r.wins / total) * 100 : 0;
  return (
    `🛑 PAPER BOT STOPPED${label}\n\n` +
    (r.token ? tokenBlock(r.token) + `\n\n` : "") +
    `📝 Reason: ${r.reason}` +
    `\n⏱️ Uptime: ${uptime}` +
    `\n💰 Balance: ${fmtSol(r.balanceSol)} SOL | 📈 Realized: ${fmtSigned(r.realizedPnlSol)} SOL` +
    `\n📦 Open position: ${r.openPositionSol != null ? `${fmtSol(r.openPositionSol)} SOL` : "none"}` +
    `\n🕯️ Last candle: ${r.lastCandle ?? "n/a"}` +
    `\n🏆 Session: ${r.trades} trades | Win rate: ${winRate.toFixed(1)}% (${r.wins}W/${r.losses}L)` +
    `\n\n📅 Stopped: ${r.stoppedAt}` +
    `\n\n_paper only — no funds moved_`
  );
}

export function paperCloseMessage(r: CloseReport): string {
  const icon = r.won ? "💰" : "🔴";
  const total = r.wins + r.losses;
  const winRate = total > 0 ? (r.wins / total) * 100 : 0;
  return (
    `${icon} PAPER CLOSE #${r.tradeNo} — ${r.token.symbol} (${r.won ? "WIN" : "LOSS"})\n\n` +
    tokenBlock(r.token) +
    `\n\n💵 Entry: ${fmtUsd(r.entryPriceUsd)} → Exit: ${fmtUsd(r.exitPriceUsd)}` +
    `\n📝 Reason: ${r.exitReason}` +
    `\n⏱️ Duration: ${formatDuration(r.durationMs)} (${r.openedAt} → ${r.closedAt})` +
    `\n\n📊 PnL: ${fmtSigned(r.pnlSol)} SOL (${fmtPct(r.pnlPct)})` +
    `\n💰 Balance: ${fmtSol(r.balanceBeforeSol)} → ${fmtSol(r.balanceAfterSol)} SOL` +
    `\n🏆 Win rate: ${winRate.toFixed(1)}% (${r.wins}W/${r.losses}L of ${total})` +
    `\n📈 Realized total: ${fmtSigned(r.realizedPnlSol)} SOL` +
    `\n🔀 Router: ${r.router ?? "n/a"}` +
    (r.executionNote ? `\n⚖️ ${r.executionNote}` : "") +
    `\n\n_no transaction sent — paper only_`
  );
}
