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
}

/** Sinyal bullish terbaru â jadi feed "Radar Live". */
export async function getLatestBullishScans(limit = 30) {
  const { data, error } = await supabasePublic
    .from("bullish_scans")
    .select("*")
    .order("scanned_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Gagal ambil bullish_scans: ${error.message}`);
  return (data ?? []) as BullishScanRow[];
}

/** Posisi yang masih terbuka â belum kena TP/SL/timeout. */
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

/** Riwayat sinyal yang sudah selesai â dasar hitung win rate. */
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
