import type { DexPaprikaData } from "../dexpaprika";

export interface Candle {
  timeOpen: string;
  timeClose: string;

  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export async function getPoolCandles(
  paprika: DexPaprikaData,
  poolAddress: string,
  options: {
    start: string;
    end?: string;
    interval: "1m" | "5m" | "10m" | "15m" | "30m" | "1h" | "6h" | "12h" | "24h";
    limit?: number;
    inversed?: boolean;
  },
): Promise<Candle[]> {
  const rows = await paprika.getPoolOHLCV(poolAddress, options);

  return rows
    .map((row) => ({
      timeOpen: row.time_open,
      timeClose: row.time_close,

      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
    }))
    .filter(
      (candle) =>
        Number.isFinite(candle.open) &&
        Number.isFinite(candle.high) &&
        Number.isFinite(candle.low) &&
        Number.isFinite(candle.close) &&
        candle.high >= candle.low &&
        candle.high >= candle.open &&
        candle.high >= candle.close &&
        candle.low <= candle.open &&
        candle.low <= candle.close,
    )
    .sort((a, b) => Date.parse(a.timeOpen) - Date.parse(b.timeOpen));
}
