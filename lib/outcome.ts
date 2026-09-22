// Pelacak hasil sinyal BUY: posisi dibuka lewat try_insert_signal() di
// Postgres (satu gate untuk semua proteksi - lihat openSignalViaGate),
// lalu dicek berkala pakai candle Indodax asli - kena TP atau SL duluan.
//
// Dua SL dilacak sekaligus (ketat -3% dan longgar -5%) supaya backtest
// bisa membandingkan keduanya dari sinyal yang SAMA, tanpa scan ulang.
//
// TP1/TP2 BISA berbasis resistance historis (bukan selalu 5%/10% tetap)
// - keputusan levelnya ada di try_insert_signal, bukan di file ini lagi.
// simulate() karena itu WAJIB pakai level yang benar-benar tersimpan di
// baris signal_outcomes, bukan hitung ulang dari persentase tetap -
// kalau tidak, hasil TP/SL yang disimulasikan bisa beda dari yang
// sebenarnya disiarkan ke Telegram.

import { getIntradayCandles, type Candle } from "@/lib/indodax";
import { supabaseAdmin } from "@/lib/supabase";

// Dipakai try_insert_signal sebagai FALLBACK kalau resistance tidak
// tersedia/tidak masuk akal jaraknya - lihat definisi fungsi di Supabase.
// Timeout 24 jam juga sudah di-hardcode di sana (now() + interval
// '24 hours'), bukan dari TIMEOUT_HOURS di bawah ini lagi - kalau mau
// ubah durasi timeout, ubah di DUA tempat (di sini untuk dokumentasi,
// dan di fungsi try_insert_signal untuk yang benar-benar berlaku).
export const SL_TIGHT_PCT = 0.03;
export const SL_WIDE_PCT = 0.05;
export const TP1_PCT = 0.05;
export const TP2_PCT = 0.1;
export const TP3_PCT = 0.15;
export const TIMEOUT_HOURS = 24;

export type Outcome = "tp1" | "tp2" | "tp3" | "sl" | "timeout";

export interface OpenSignalGateInput {
  symbol: string;
  rsi: number;
  price: number;
  rank?: number;
  buyPrice?: number;
  sellPrice?: number;
  tp1Res?: number;
  tp1Touches?: number;
  tp2Res?: number;
  tp2Touches?: number;
}

export interface GateResult {
  broadcasted: boolean;
  alasan?: string;
  tp1?: number;
  tp2?: number;
  tp3?: number;
  slTight?: number;
  slWide?: number;
}

/**
 * Buka posisi lewat try_insert_signal() di Postgres - SATU jalur untuk
 * insert bullish_scans + signal_outcomes sekaligus, dengan proteksi:
 * bad tick (deviasi median 12 scan terakhir), spread lebar/negatif,
 * blacklist symbol, posisi masih terbuka, cooldown 60 menit setelah
 * close, dan RSI sama belum update (dedup). TP1/TP2 dipilih di sana:
 * resistance kalau jaraknya masuk akal (1.02x-1.20x harga, >=3x
 * disentuh), fallback ke persentase tetap kalau tidak.
 *
 * Menggantikan openSignalIfNew() lama yang insert mentah ke
 * signal_outcomes dengan TP/SL fixed 5/10/15%, TANPA proteksi apa pun
 * di atas - itu sebabnya satu coin bisa buka-tutup posisi tiap 5-10
 * menit (tidak ada cooldown), dan TP yang dilacak beda dari TP yang
 * disiarkan ke Telegram (dua sumber independen sebelumnya, sekarang
 * satu).
 */
export async function openSignalViaGate(
  input: OpenSignalGateInput
): Promise<GateResult> {
  const { data, error } = await supabaseAdmin.rpc("try_insert_signal", {
    p_symbol: input.symbol,
    p_rsi: input.rsi,
    p_price: input.price,
    p_rank: input.rank ?? null,
    p_buy_price: input.buyPrice ?? null,
    p_sell_price: input.sellPrice ?? null,
    p_tp1_res: input.tp1Res ?? null,
    p_tp1_touches: input.tp1Touches ?? null,
    p_tp2_res: input.tp2Res ?? null,
    p_tp2_touches: input.tp2Touches ?? null,
  });

  if (error) {
    throw new Error(
      `Gagal panggil try_insert_signal untuk ${input.symbol}: ${error.message}`
    );
  }

  const r = (data ?? {}) as {
    should_broadcast?: boolean;
    alasan?: string;
    tp1?: number;
    tp2?: number;
    tp3?: number;
    sl_tight?: number;
    sl_wide?: number;
  };

  return {
    broadcasted: r.should_broadcast === true,
    alasan: r.alasan,
    tp1: r.tp1,
    tp2: r.tp2,
    tp3: r.tp3,
    slTight: r.sl_tight,
    slWide: r.sl_wide,
  };
}

interface SimResult {
  outcomeTight: Outcome;
  outcomeWide: Outcome;
  pnlTight: number;
  pnlWide: number;
  closedAtTight: number | null;
  closedAtWide: number | null;
  maxPrice: number;
  minPrice: number;
  allClosed: boolean;
}

export interface SimLevels {
  tp1: number;
  tp2: number;
  tp3: number;
  slTight: number;
  slWide: number;
}

/**
 * Simulasi berurutan candle demi candle terhadap level TP/SL yang
 * SUDAH TERSIMPAN di baris signal_outcomes (bisa resistance, bisa
 * fixed % - keputusan itu sudah final saat posisi dibuka lewat
 * openSignalViaGate). Kalau dalam SATU candle high menyentuh TP dan
 * low menyentuh SL sekaligus, urutan tidak bisa diketahui - diasumsikan
 * SL kena DULU (skenario terburuk) supaya hasil backtest tidak terlalu
 * optimis.
 */
export function simulate(
  candles: Candle[],
  entry: number,
  levels: SimLevels,
  expiresAtSec: number,
  nowSec: number
): SimResult {
  const { tp1, tp2, tp3, slTight: slT, slWide: slW } = levels;

  let outT: Outcome | null = null;
  let outW: Outcome | null = null;
  let closeT: number | null = null;
  let closeW: number | null = null;
  let maxP = entry;
  let minP = entry;

  for (const c of candles) {
    maxP = Math.max(maxP, c.high);
    minP = Math.min(minP, c.low);

    if (outT === null) {
      if (c.low <= slT) { outT = "sl"; closeT = c.time; }
      else if (c.high >= tp3) { outT = "tp3"; closeT = c.time; }
      else if (c.high >= tp2) { outT = "tp2"; closeT = c.time; }
      else if (c.high >= tp1) { outT = "tp1"; closeT = c.time; }
    }
    if (outW === null) {
      if (c.low <= slW) { outW = "sl"; closeW = c.time; }
      else if (c.high >= tp3) { outW = "tp3"; closeW = c.time; }
      else if (c.high >= tp2) { outW = "tp2"; closeW = c.time; }
      else if (c.high >= tp1) { outW = "tp1"; closeW = c.time; }
    }
    if (outT !== null && outW !== null) break;
  }

  const expired = nowSec >= expiresAtSec;
  const lastClose = candles.length ? candles[candles.length - 1].close : entry;
  const pnlOf = (target: number): number => ((target - entry) / entry) * 100;

  const finalT: Outcome | null = outT ?? (expired ? "timeout" : null);
  const finalW: Outcome | null = outW ?? (expired ? "timeout" : null);

  const pnlFor = (o: Outcome | null, slValue: number): number => {
    if (o === "sl") return pnlOf(slValue);
    if (o === "tp1") return pnlOf(tp1);
    if (o === "tp2") return pnlOf(tp2);
    if (o === "tp3") return pnlOf(tp3);
    if (o === "timeout") return pnlOf(lastClose);
    return NaN;
  };

  const pnlT = pnlFor(finalT, slT);
  const pnlW = pnlFor(finalW, slW);

  return {
    outcomeTight: (finalT ?? "timeout") as Outcome,
    outcomeWide: (finalW ?? "timeout") as Outcome,
    pnlTight: pnlT,
    pnlWide: pnlW,
    closedAtTight: closeT,
    closedAtWide: closeW,
    maxPrice: maxP,
    minPrice: minP,
    allClosed: finalT !== null && finalW !== null,
  };
}

/**
 * Cek semua posisi open: tarik candle 5 menit sejak sinyal, simulasikan
 * terhadap TP/SL yang tersimpan di baris itu sendiri, tulis hasilnya.
 * Mengembalikan ringkasan untuk response endpoint.
 */
export async function checkOpenOutcomes(): Promise<{
  checked: number;
  closed: number;
  errors: string[];
}> {
  const { data: rows, error } = await supabaseAdmin
    .from("signal_outcomes")
    .select("*")
    .eq("status", "open")
    .order("signaled_at", { ascending: true })
    .limit(60);

  if (error) throw new Error(`Gagal ambil posisi open: ${error.message}`);

  const nowSec = Math.floor(Date.now() / 1000);
  const errors: string[] = [];
  let closed = 0;

  for (const row of rows ?? []) {
    try {
      const signaledSec = Math.floor(new Date(row.signaled_at).getTime() / 1000);
      const expiresSec = Math.floor(new Date(row.expires_at).getTime() / 1000);
      const spanMin = Math.max(30, Math.ceil((nowSec - signaledSec) / 60));
      const candleCount = Math.ceil(spanMin / 5) + 6;

      const raw = await getIntradayCandles(`${row.symbol}IDR`, "5", candleCount);
      const candles = raw
        .filter((c) => c.time >= signaledSec)
        .sort((a, b) => a.time - b.time);

      if (candles.length === 0) {
        errors.push(`${row.symbol}: tidak ada candle sejak sinyal`);
        continue;
      }

      const r = simulate(
        candles,
        Number(row.entry_price),
        {
          tp1: Number(row.tp1_price),
          tp2: Number(row.tp2_price),
          tp3: Number(row.tp3_price),
          slTight: Number(row.sl_tight_price),
          slWide: Number(row.sl_wide_price),
        },
        expiresSec,
        nowSec
      );

      const update: Record<string, unknown> = {
        max_price: r.maxPrice,
        min_price: r.minPrice,
        last_checked_at: new Date().toISOString(),
      };

      if (r.allClosed) {
        const closeSec = Math.max(r.closedAtTight ?? 0, r.closedAtWide ?? 0) || nowSec;
        update.status =
          r.outcomeTight === "sl" ? "sl_tight"
          : r.outcomeWide === "sl" ? "sl_wide"
          : r.outcomeTight === "timeout" ? "timeout"
          : r.outcomeTight;
        update.outcome_tight = r.outcomeTight;
        update.outcome_wide = r.outcomeWide;
        update.pnl_tight_pct = r.pnlTight;
        update.pnl_wide_pct = r.pnlWide;
        update.closed_at = new Date(closeSec * 1000).toISOString();
        closed++;
      }

      const { error: upErr } = await supabaseAdmin
        .from("signal_outcomes")
        .update(update)
        .eq("id", row.id);
      if (upErr) errors.push(`${row.symbol}: ${upErr.message}`);
    } catch (e) {
      errors.push(`${row.symbol}: ${e instanceof Error ? e.message : "error"}`);
    }
  }

  return { checked: rows?.length ?? 0, closed, errors };
}
