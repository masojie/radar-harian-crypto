import { createClient } from "@supabase/supabase-js";

/**
 * Client Supabase khusus server-side (API routes, cron job).
 *
 * Pakai SUPABASE_SERVICE_ROLE_KEY, bukan anon key, karena route ini
 * jalan di server (bukan browser) dan perlu izin insert tanpa
 * terikat Row Level Security. JANGAN pernah import file ini dari
 * kode yang jalan di client/browser - key ini harus tetap rahasia.
 *
 * Environment variable yang dibutuhkan (sudah diset di Vercel):
 * - NEXT_PUBLIC_SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 */
function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY belum diset di environment variables"
    );
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
}

export const supabaseAdmin = getSupabaseAdmin();

/**
 * Bentuk satu baris yang disimpan ke tabel radar_scans.
 * Nama field sengaja snake_case supaya cocok langsung dengan
 * nama kolom di Postgres (Supabase tidak auto-convert).
 */
export interface RadarScanRow {
  pair_id: string;
  symbol: string;
  last_price: number;
  buy_price: number;
  sell_price: number;
  volume_idr: number;
  rank_in_scan: number;
}

/**
 * Simpan hasil satu kali scan ke tabel radar_scans.
 * scanned_at diisi otomatis oleh Postgres (default NOW()), jadi
 * semua baris dari satu pemanggilan cron akan punya timestamp yang
 * sama persis - berguna untuk mengelompokkan hasil per scan nanti.
 *
 * Kegagalan simpan ke database TIDAK menghentikan alur utama -
 * pesan Telegram tetap harus terkirim walau penyimpanan gagal.
 * Errornya dilempar ke pemanggil supaya bisa di-log, bukan
 * langsung throw dan membatalkan seluruh request.
 */
export async function saveScanResults(rows: RadarScanRow[]): Promise<void> {
  const { error } = await supabaseAdmin.from("radar_scans").insert(rows);

  if (error) {
    throw new Error(`Gagal simpan hasil scan ke Supabase: ${error.message}`);
  }
}
