import type { BullishScanRow } from "./supabase-public";

/**
 * Tabel bullish_scans berisi satu baris per coin per scan, jadi coin yang
 * bertahan di zona oversold muncul berulang. Di sini baris-baris itu
 * dikelompokkan per coin supaya dashboard menampilkan satu entri per coin
 * lengkap dengan jejak RSI-nya, bukan puluhan baris yang hampir sama.
 */

export interface CoinTrack {
  symbol: string;
  /** Pembacaan terbaru untuk coin ini. */
  latest: BullishScanRow;
  /** RSI dari yang terlama ke terbaru. */
  rsiSeries: number[];
  /** Berapa kali coin ini terdeteksi di rentang data yang dimuat. */
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
  /** True kalau coin ini masih muncul di scan paling baru. */
  active: boolean;
  /** Perubahan harga sejak pertama terdeteksi, dalam persen. */
  priceChangePct: number;
}

export interface RadarView {
  /** Aktif dulu (RSI terendah di depan), lalu yang sudah lewat (terbaru di depan). */
  tracks: CoinTrack[];
  latestScanAt: string | null;
  activeCount: number;
  /** Jumlah baris mentah yang dikelompokkan. */
  sampleCount: number;
}

/**
 * Baris dari satu scan biasanya berbagi scanned_at yang sama, tapi kita tidak
 * bergantung pada itu: baris yang jaraknya kurang dari jendela ini dari scan
 * terbaru dianggap satu batch.
 */
const BATCH_WINDOW_MS = 90_000;

export function buildRadarView(rows: BullishScanRow[]): RadarView {
  if (rows.length === 0) {
    return { tracks: [], latestScanAt: null, activeCount: 0, sampleCount: 0 };
  }

  const times = rows.map((r) => Date.parse(r.scanned_at));
  const latestMs = Math.max(...times);
  const latestScanAt = rows[times.indexOf(latestMs)].scanned_at;

  const bySymbol = new Map<string, BullishScanRow[]>();
  for (const row of rows) {
    const list = bySymbol.get(row.symbol);
    if (list) list.push(row);
    else bySymbol.set(row.symbol, [row]);
  }

  const tracks: CoinTrack[] = [];
  bySymbol.forEach((list, symbol) => {
    const chrono = [...list].sort(
      (a, b) => Date.parse(a.scanned_at) - Date.parse(b.scanned_at)
    );
    const first = chrono[0];
    const latest = chrono[chrono.length - 1];

    tracks.push({
      symbol,
      latest,
      rsiSeries: chrono.map((r) => r.rsi),
      count: chrono.length,
      firstSeenAt: first.scanned_at,
      lastSeenAt: latest.scanned_at,
      active: latestMs - Date.parse(latest.scanned_at) <= BATCH_WINDOW_MS,
      priceChangePct:
        first.price > 0 ? ((latest.price - first.price) / first.price) * 100 : 0,
    });
  });

  tracks.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    if (a.active) return a.latest.rsi - b.latest.rsi;
    return Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt);
  });

  return {
    tracks,
    latestScanAt,
    activeCount: tracks.filter((t) => t.active).length,
    sampleCount: rows.length,
  };
}
