import type { BullishScanRow, SignalOutcomeRow } from "./supabase-public";

/**
 * Tabel bullish_scans berisi satu baris per coin per scan, jadi coin yang
 * bertahan di zona oversold muncul berulang. Di sini baris-baris itu
 * dikelompokkan per coin supaya dashboard menampilkan satu entri per coin
 * lengkap dengan jejak RSI-nya, bukan puluhan baris yang hampir sama.
 */

/**
 * Nasib satu coin di gate sinyal pada pembacaan terbaru. Kosakata sama dengan
 * pesan channel: hanya "sinyal" yang disiarkan sebagai sinyal baru, sisanya
 * "pantauan" (di channel tampil sebagai "Pantauan lain (bukan sinyal baru)").
 */
export type TrackStatus = "sinyal" | "posisi" | "cooldown" | "ditolak" | "pantauan";

export const STATUS_LABEL: Record<TrackStatus, string> = {
  sinyal: "Sinyal baru",
  posisi: "Posisi terbuka",
  cooldown: "Cooldown",
  ditolak: "Ditolak gate",
  pantauan: "Pantauan",
};

/**
 * @param signalIds id baris bullish_scans yang melahirkan posisi
 *   (signal_outcomes.signal_id menunjuk ke id baris audit gate).
 */
export function trackStatus(row: BullishScanRow, signalIds: ReadonlySet<number>): TrackStatus {
  if (signalIds.has(row.id)) return "sinyal";
  const alasan = row.tolak_alasan;
  if (!alasan) return "pantauan";
  if (alasan === "posisi_masih_terbuka" || alasan === "race_posisi_terbuka") return "posisi";
  if (alasan.startsWith("cooldown")) return "cooldown";
  return "ditolak";
}

export interface CoinTrack {
  symbol: string;
  /** Pembacaan terbaru untuk coin ini. */
  latest: BullishScanRow;
  /**
   * RSI dari yang terlama ke terbaru, satu titik per perubahan nilai. RSI
   * dihitung dari candle 1 jam yang sudah tutup, jadi nilainya sama selama
   * sejam penuh. Tanpa ini jejak per 5 menit hanya garis datar.
   */
  rsiSeries: number[];
  /** Nasib coin ini di gate sinyal pada pembacaan terbaru. */
  status: TrackStatus;
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
  /**
   * True kalau sinyal terakhir sudah lebih tua dari jendela hidup. Tabel
   * bullish_scans hanya terisi saat ada coin oversold, jadi "tidak ada baris
   * baru" berarti "tidak ada coin oversold sekarang", bukan "scan terakhir".
   */
  stale: boolean;
  /** Lebar jendela waktu data (jam). null = jendela kosong, tampilan jatuh balik ke baris terakhir. */
  windowHours: number | null;
}

/** Scan berjalan tiap 5 menit. Lewat dari ini berarti tidak ada coin oversold. */
export const LIVE_WINDOW_MS = 15 * 60_000;

/**
 * Baris dari satu scan biasanya berbagi scanned_at yang sama, tapi kita tidak
 * bergantung pada itu: baris yang jaraknya kurang dari jendela ini dari scan
 * terbaru dianggap satu batch.
 */
const BATCH_WINDOW_MS = 90_000;

/**
 * Satu scan menulis DUA baris untuk coin yang masuk kandidat gate: baris mentah
 * dari saveBullishScanResults, lalu baris audit dari try_insert_signal beberapa
 * detik kemudian (isinya sama, tapi ada TP/support dan alasan tolak). Tanpa ini
 * "count" dan sparkline RSI jadi dobel ("6x" padahal 3 scan).
 *
 * Baris satu coin yang jaraknya kurang dari BATCH_WINDOW_MS dari baris pertama
 * kelompoknya dianggap satu pembacaan. Scan berjalan tiap 5 menit dan satu
 * request maksimal 60 detik, jadi dua scan berbeda tidak pernah tergabung.
 * Yang dipertahankan baris terakhir (baris gate, yang lengkap).
 */
function collapseSameScan(rows: BullishScanRow[]): BullishScanRow[] {
  const bySym = new Map<string, BullishScanRow[]>();
  for (const row of rows) {
    const list = bySym.get(row.symbol);
    if (list) list.push(row);
    else bySym.set(row.symbol, [row]);
  }

  const out: BullishScanRow[] = [];
  bySym.forEach((list) => {
    const chrono = [...list].sort((a, b) => Date.parse(a.scanned_at) - Date.parse(b.scanned_at));
    let group: BullishScanRow[] = [];
    const flush = () => {
      if (group.length > 0) out.push(group[group.length - 1]);
      group = [];
    };
    for (const row of chrono) {
      if (group.length > 0 && Date.parse(row.scanned_at) - Date.parse(group[0].scanned_at) > BATCH_WINDOW_MS) flush();
      group.push(row);
    }
    flush();
  });
  return out;
}

/** Satu titik per perubahan nilai RSI (lihat CoinTrack.rsiSeries). */
function rsiSteps(chrono: BullishScanRow[]): number[] {
  const out: number[] = [];
  for (const row of chrono) {
    const last = out[out.length - 1];
    if (last === undefined || Math.abs(row.rsi - last) > 1e-6) out.push(row.rsi);
  }
  return out;
}

export interface RadarViewOptions {
  /** id baris bullish_scans yang melahirkan posisi (signal_outcomes.signal_id). */
  signalIds?: ReadonlySet<number>;
  windowHours?: number | null;
}

export function buildRadarView(
  rows: BullishScanRow[],
  nowMs: number = Date.now(),
  options: RadarViewOptions = {}
): RadarView {
  const signalIds = options.signalIds ?? new Set<number>();
  const windowHours = options.windowHours ?? null;
  if (rows.length === 0) {
    return { tracks: [], latestScanAt: null, activeCount: 0, sampleCount: 0, stale: true, windowHours };
  }

  const readings = collapseSameScan(rows);
  const times = readings.map((r) => Date.parse(r.scanned_at));
  const latestMs = Math.max(...times);
  const latestScanAt = readings[times.indexOf(latestMs)].scanned_at;

  const bySymbol = new Map<string, BullishScanRow[]>();
  for (const row of readings) {
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
      rsiSeries: rsiSteps(chrono),
      status: trackStatus(latest, signalIds),
      count: chrono.length,
      firstSeenAt: first.scanned_at,
      lastSeenAt: latest.scanned_at,
      // Aktif = ikut batch scan terbaru DAN batch itu masih segar. Tanpa cek
      // jam sekarang, coin dari 5 jam lalu tampil seolah masih oversold.
      active:
        latestMs - Date.parse(latest.scanned_at) <= BATCH_WINDOW_MS &&
        nowMs - latestMs <= LIVE_WINDOW_MS,
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
    sampleCount: readings.length,
    stale: nowMs - latestMs > LIVE_WINDOW_MS,
    windowHours,
  };
}

export interface TargetRow {
  name: string;
  price: number;
  note: string;
}

export interface TrackTargets {
  /** "posisi" = angka posisi yang sedang dilacak, "gate" = TP final hasil gate, "none" = belum ada. */
  source: "posisi" | "gate" | "none";
  rows: TargetRow[];
}

function tpNote(sumber: string | null, touches: number | null, fixedPct: number): string {
  if (sumber === "resistance") {
    return touches !== null && touches > 0 ? `resistance mingguan, ${touches}x disentuh` : "resistance mingguan";
  }
  return `+${fixedPct}% dari harga`;
}

/**
 * Target untuk kartu utama Radar. TIDAK PERNAH memakai tp1_price/tp2_price
 * mentah: itu usulan resistance yang bisa ditolak gate (contoh nyata UCJL:
 * usulan +465%, yang benar-benar dilacak +5%). Urutan sumber:
 * 1. posisi terbuka coin itu (angka yang dilacak sistem),
 * 2. TP final hasil gate pada baris terbaru,
 * 3. tidak ada (baris lama sebelum kolom TP final ada).
 */
export function buildTargets(
  track: CoinTrack,
  openBySymbol: ReadonlyMap<string, SignalOutcomeRow>
): TrackTargets {
  const rows: TargetRow[] = [];
  let source: TrackTargets["source"] = "none";
  const open = track.status === "posisi" ? openBySymbol.get(track.symbol) : undefined;
  const l = track.latest;

  if (open) {
    source = "posisi";
    rows.push(
      { name: "TP1", price: open.tp1_price, note: "target posisi terbuka" },
      { name: "TP2", price: open.tp2_price, note: "target posisi terbuka" }
    );
  } else if (l.tp1_final !== null && l.tp2_final !== null) {
    source = "gate";
    rows.push(
      { name: "TP1", price: l.tp1_final, note: tpNote(l.tp1_sumber, l.tp1_touches, 5) },
      { name: "TP2", price: l.tp2_final, note: tpNote(l.tp2_sumber, l.tp2_touches, 10) }
    );
  }

  if (l.support_price !== null) {
    rows.push({
      name: "Entry",
      price: l.support_price,
      note: l.support_touches !== null ? `support mingguan, ${l.support_touches}x disentuh` : "support mingguan",
    });
  }
  return { source, rows };
}
