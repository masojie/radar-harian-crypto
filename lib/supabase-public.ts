import { createClient } from "@supabase/supabase-js";

/**
 * Client Supabase untuk dashboard (server component, read-only).
 *
 * PENTING: pakai NEXT_PUBLIC_SUPABASE_ANON_KEY, BUKAN service role key.
 * Dashboard ini publik-facing, jadi harus dibatasi Row Level Security (RLS)
 * di Supabase: anon key cuma boleh SELECT, tidak boleh insert/update/delete.
 *
 * Jalankan sekali di Supabase SQL editor untuk tiap tabel yang dibaca dashboard:
 *
 *   alter table radar_scans enable row level security;
 *   alter table bullish_scans enable row level security;
 *   alter table signal_outcomes enable row level security;
 *
 *   create policy "public read radar_scans" on radar_scans
 *     for select using (true);
 *   create policy "public read bullish_scans" on bullish_scans
 *     for select using (true);
 *   create policy "public read signal_outcomes" on signal_outcomes
 *     for select using (true);
 *
 * Tanpa RLS + policy ini, anon key akan ditolak Supabase (default-nya deny-all).
 */
function getSupabasePublic() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL atau NEXT_PUBLIC_SUPABASE_ANON_KEY belum diset di environment variables"
    );
  }

  return createClient(url, anonKey, {
    auth: { persistSession: false },
  });
}

export const supabasePublic = getSupabasePublic();

export interface BullishScanRow {
  id: number;
  symbol: string;
  rsi: number;
  price: number;
  rank_in_scan: number;
  tp1_price: number | null;
  tp1_touches: number | null;
  tp2_price: number | null;
  tp2_touches: number | null;
  support_price: number | null;
  support_touches: number | null;
  /** TP final hasil validasi gate (sumber kebenaran tampilan). NULL untuk baris mentah dan baris sebelum 06 Okt 2026. */
  tp1_final: number | null;
  tp2_final: number | null;
  /** Asal TP final: "resistance", "fixed_5pct", atau "fixed_10pct". */
  tp1_sumber: string | null;
  tp2_sumber: string | null;
  /** Alasan gate menolak (mis. posisi_masih_terbuka). NULL = baris mentah atau lolos gate. */
  tolak_alasan: string | null;
  scanned_at: string;
}

export interface SignalOutcomeRow {
  id: number;
  signal_id: number;
  symbol: string;
  signaled_at: string;
  entry_price: number;
  rsi_at_signal: number;
  sl_tight_price: number;
  sl_wide_price: number;
  tp1_price: number;
  tp2_price: number;
  tp3_price: number;
  status: string;
  outcome_tight: string | null;
  outcome_wide: string | null;
  pnl_tight_pct: number | null;
  pnl_wide_pct: number | null;
  max_price: number | null;
  min_price: number | null;
  closed_at: string | null;
  /** Batas waktu posisi (24 jam sejak sinyal). Nama kolom di DB: expires_at. */
  expires_at: string;
  /** Volume transaksi 24 jam (IDR) saat sinyal masuk. NULL untuk sinyal lama sebelum kolom ini ada. */
  volume_at_signal: number | null;
}

/** Sinyal bullish terbaru Ã¢ÂÂ jadi feed "Radar Live". */
export async function getLatestBullishScans(limit = 30) {
  const { data, error } = await supabasePublic
    .from("bullish_scans")
    .select("*")
    .order("scanned_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Gagal ambil bullish_scans: ${error.message}`);
  return (data ?? []) as BullishScanRow[];
}

/** Lebar jendela data Radar (jam). */
export const RADAR_WINDOW_HOURS = 6;
/** Batas baris per request PostgREST (default Supabase). Urut terbaru dulu, jadi yang terpotong selalu yang paling lama. */
const RADAR_MAX_ROWS = 1000;

const BULLISH_COLUMNS =
  "id,symbol,rsi,price,rank_in_scan,tp1_price,tp1_touches,tp2_price,tp2_touches,support_price,support_touches,tp1_final,tp2_final,tp1_sumber,tp2_sumber,tolak_alasan,scanned_at";

export interface RadarFeed {
  rows: BullishScanRow[];
  /** Lebar jendela waktu yang dipakai. null = jendela kosong, jatuh balik ke 30 baris terakhir. */
  windowHours: number | null;
}

/**
 * Data Radar berdasarkan WAKTU, bukan jumlah baris. Dengan limit 30 baris,
 * satu scan (8 coin x 2 baris = 16 baris) sudah memakan separuh jatah, jadi
 * hitungan "Terdeteksi Nx" dan jejak RSI hanya mencakup sekitar 10 menit.
 */
export async function getRecentBullishScans(hours = RADAR_WINDOW_HOURS): Promise<RadarFeed> {
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();
  const { data, error } = await supabasePublic
    .from("bullish_scans")
    .select(BULLISH_COLUMNS)
    .gte("scanned_at", since)
    .order("scanned_at", { ascending: false })
    .limit(RADAR_MAX_ROWS);

  if (error) throw new Error(`Gagal ambil bullish_scans: ${error.message}`);
  const rows = (data ?? []) as unknown as BullishScanRow[];
  if (rows.length > 0) return { rows, windowHours: hours };

  // Sepi: tidak ada coin oversold dalam jendela. Pakai 30 baris terakhir
  // supaya halaman tetap menampilkan coin yang terakhir terdeteksi.
  return { rows: await getLatestBullishScans(30), windowHours: null };
}

/** Posisi yang masih terbuka Ã¢ÂÂ belum kena TP/SL/timeout. */
export async function getOpenSignals(limit = 50) {
  const { data, error } = await supabasePublic
    .from("signal_outcomes")
    .select("*")
    .eq("status", "open")
    .order("signaled_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Gagal ambil posisi open: ${error.message}`);
  return (data ?? []) as SignalOutcomeRow[];
}

/** Riwayat sinyal yang sudah selesai Ã¢ÂÂ dasar hitung win rate. */
export async function getClosedSignals(limit = 100) {
  const { data, error } = await supabasePublic
    .from("signal_outcomes")
    .select("*")
    .neq("status", "open")
    .order("closed_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Gagal ambil riwayat sinyal: ${error.message}`);
  return (data ?? []) as SignalOutcomeRow[];
}
