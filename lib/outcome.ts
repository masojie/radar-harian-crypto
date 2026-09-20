// Pelacak hasil sinyal BUY: tiap sinyal RSI<35 dibuka sebagai "posisi",
// lalu dicek berkala pakai candle Indodax asli - kena TP atau SL duluan.
//
// Dua SL dilacak sekaligus (ketat -3% dan longgar -5%) supaya backtest
// bisa membandingkan keduanya dari sinyal yang SAMA, tanpa scan ulang.
//
// TP 5/10/15% sama dengan calculateSpotLevels() di lib/indodax.ts.

import { getIntradayCandles, type Candle } from "@/lib/indodax";
import { supabaseAdmin } from "@/lib/supabase";

export const SL_TIGHT_PCT = 0.03;
export const SL_WIDE_PCT = 0.05;
export const TP1_PCT = 0.05;
export const TP2_PCT = 0.1;
export const TP3_PCT = 0.15;
export const TIMEOUT_HOURS = 24;
// Sinyal baru untuk koin yang sama dianggap KEJADIAN YANG SAMA selama
// posisi lamanya masih open. Tanpa ini, 1 koin yang terus RSI<35
// tercatat puluhan kali dan menggelembungkan jumlah sinyal.

export type Outcome = "tp1" | "tp2" | "tp3" | "sl" | "timeout";

export interface OpenSignalInput {
  signalId: number;
  symbol: string;
  signaledAt: string;
  entryPrice: number;
  rsi: number;
}

/**
 * Buka posisi baru untuk sinyal, KECUALI koin itu masih punya posisi open.
 * Mengembalikan true kalau posisi baru benar-benar dibuka.
 */
export async function openSignalIfNew(input: OpenSignalInput): Promise<boolean> {
  const { data: existing, error: checkError } = await supabaseAdmin
    .from("signal_outcomes")
    .select("id")
    .eq("symbol", input.symbol)
    .eq("status", "open")
    .limit(1);

  if (checkError) {
    throw new Error(`Gagal cek posisi open ${input.symbol}: ${checkError.message}`);
  }
  if (existing && existing.length > 0) return false;

  const e = input.entryPrice;
  const expires = new Date(
    new Date(input.signaledAt).getTime() + TIMEOUT_HOURS * 3600 * 1000
  ).toISOString();

  const { error } = await supabaseAdmin.from("signal_outcomes").insert({
    signal_id: input.signalId,
    symbol: input.symbol,
    signaled_at: input.signaledAt,
    entry_price: e,
    rsi_at_signal: input.rsi,
    sl_tight_price: e * (1 - SL_TIGHT_PCT),
    sl_wide_price: e * (1 - SL_WIDE_PCT),
    tp1_price: e * (1 + TP1_PCT),
    tp2_price: e * (1 + TP2_PCT),
    tp3_price: e * (1 + TP3_PCT),
    expires_at: expires,
  });

  if (error) {
    throw new Error(`Gagal buka posisi ${input.symbol}: ${error.message}`);
  }
  return true;
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

/**
 * Simulasi berurutan candle demi candle. Kalau dalam SATU candle
 * high menyentuh TP dan low menyentuh SL sekaligus, urutan tidak bisa
 * diketahui - diasumsikan SL kena DULU (skenario terburuk) supaya
 * hasil backtest tidak terlalu optimis.
 */
export function simulate(
  candles: Candle[],
  entry: number,
  expiresAtSec: number,
  nowSec: number
): SimResult {
  const slT = entry * (1 - SL_TIGHT_PCT);
  const slW = entry * (1 - SL_WIDE_PCT);
  const tp1 = entry * (1 + TP1_PCT);
  const tp2 = entry * (1 + TP2_PCT);
  const tp3 = entry * (1 + TP3_PCT);

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

  const pnl = (o: Outcome | null): number => {
    if (o === "tp1") return TP1_PCT * 100;
    if (o === "tp2") return TP2_PCT * 100;
    if (o === "tp3") return TP3_PCT * 100;
    return NaN;
  };

  const finalT: Outcome | null = outT ?? (expired ? "timeout" : null);
  const finalW: Outcome | null = outW ?? (expired ? "timeout" : null);

  const pnlT =
    finalT === "sl" ? -SL_TIGHT_PCT * 100
    : finalT === "timeout" ? ((lastClose - entry) / entry) * 100
    : pnl(finalT);
  const pnlW =
    finalW === "sl" ? -SL_WIDE_PCT * 100
    : finalW === "timeout" ? ((lastClose - entry) / entry) * 100
    : pnl(finalW);

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
 * Cek semua posisi open: tarik candle 5 menit sejak sinyal, simulasikan,
 * tulis hasilnya. Mengembalikan ringkasan untuk response endpoint.
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

      const r = simulate(candles, Number(row.entry_price), expiresSec, nowSec);

      const update: Record<string, unknown> = {
        max_price: r.maxPrice,
        min_price: r.minPrice,
        last_checked_at: new Date().toISOString(),
      };

      if (r.allClosed) {
        const closeSec = Math.max(r.closedAtTight ?? 0, r.closedAtWide ?? 0) || nowSec;
        // status hanya penanda posisi sudah selesai. Hasil yang dipakai
        // backtest ada di outcome_tight dan outcome_wide (dua SL berbeda
        // bisa menghasilkan akhir berbeda dari sinyal yang sama).
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
