// ===========================================================
// FILE BARU: app/api/analisa/route.ts
// Buat file baru di path ini (folder "analisa" di dalam app/api/)
// ===========================================================

import { NextResponse } from "next/server";
import { analyzeSwing, SwingAnalysis } from "@/lib/indodax";
import { sendTelegramMessage } from "@/lib/telegram";

// Daftar pair yang mau dianalisis. Tambah/kurangi sesuai kebutuhan.
const PAIRS_TO_ANALYZE = ["BTCIDR", "ETHIDR", "SOLIDR"];

function formatNumber(n: number): string {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(
    n
  );
}

function plainExplanation(rsi: number, trend: string): string {
  if (rsi >= 80) {
    return "\ud83d\udcac Sudah naik sangat tinggi dan rawan koreksi tajam. Kurang ideal untuk beli baru sekarang.";
  }
  if (rsi >= 70) {
    return "\ud83d\udcac Sudah naik cukup tinggi, rawan koreksi. Kalau punya profit, ini saat yang oke untuk ambil sebagian.";
  }
  if (rsi <= 20) {
    return "\ud83d\udcac Sudah turun sangat dalam, bisa jadi peluang pantulan, tapi juga bisa terus turun. Hati-hati.";
  }
  if (rsi <= 30) {
    return "\ud83d\udcac Sudah turun cukup dalam, mulai masuk area murah secara historis.";
  }
  if (trend === "bullish") {
    return "\ud83d\udcac Momentum masih sehat, belum terlalu panas atau dingin.";
  }
  if (trend === "bearish") {
    return "\ud83d\udcac Momentum sedang melemah, harga cenderung tertekan.";
  }
  return "\ud83d\udcac Momentum netral, belum ada arah kuat ke satu sisi.";
}

function buildAnalysisMessage(results: SwingAnalysis[]): string {
  const lines: string[] = ["\ud83d\udcca *ANALISA SWING HARIAN*\n"];

  for (const r of results) {
    const trendEmoji =
      r.trend === "bullish" ? "\ud83d\udfe2" : r.trend === "bearish" ? "\ud83d\udd34" : "\u26aa";
    const rsiWarning =
      r.rsiCondition === "overbought"
        ? " \u26a0\ufe0f overbought"
        : r.rsiCondition === "oversold"
        ? " \u26a0\ufe0f oversold"
        : "";

    lines.push(
      `${trendEmoji} *${r.symbol}*`,
      `Harga: Rp ${formatNumber(r.lastClose)}`,
      `EMA20: ${formatNumber(r.ema20)} | EMA50: ${formatNumber(r.ema50)}`,
      `RSI14: ${r.rsi14.toFixed(1)}${rsiWarning}`,
      `MACD: ${r.macdLine.toFixed(2)} vs Signal ${r.macdSignal.toFixed(2)}`,
      `Tren: ${r.trend}`,
      plainExplanation(r.rsi14, r.trend),
      ""
    );
  }

  lines.push(
    "_Data asli Indodax (Rupiah). Bukan saran finansial, analisis teknikal murni._"
  );

  return lines.join("\n");
}

/**
 * Endpoint ini bisa dipanggil manual (GET) untuk trigger analisis
 * dan langsung kirim hasilnya ke Telegram. Bisa juga dijadwalkan
 * lewat Vercel Cron kalau mau otomatis harian.
 *
 * Query param opsional: ?chat_id=xxx untuk override tujuan pesan.
 * Kalau tidak diisi, pakai TELEGRAM_CHAT_ID dari env.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const chatId =
    searchParams.get("chat_id") ??
    process.env.TELEGRAM_CHAT_ID ??
    "";

  if (!chatId) {
    return NextResponse.json(
      {
        error:
          "chat_id tidak diberikan dan TELEGRAM_CHAT_ID tidak diset di environment",
      },
      { status: 400 }
    );
  }

  try {
    const results = await Promise.all(
      PAIRS_TO_ANALYZE.map((pair) => analyzeSwing(pair))
    );

    const message = buildAnalysisMessage(results);
    await sendTelegramMessage(message, chatId);

    return NextResponse.json({ ok: true, results });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    console.error("Gagal jalankan analisa swing:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
