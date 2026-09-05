import { NextResponse } from "next/server";
import { scanBullishCoins } from "@/lib/indodax";
import { sendTelegramMessage } from "@/lib/telegram";

function formatRupiah(n: number): string {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(n);
}

/**
 * Endpoint ini dipanggil oleh SCHEDULER EKSTERNAL (bukan Vercel Cron -
 * plan Hobby Vercel cuma bisa cron 1x sehari, jadi kita pakai layanan
 * eksternal seperti cron-job.org yang bisa jadwal tiap menit).
 *
 * Endpoint ini scan semua coin, dan HANYA kirim pesan ke Telegram
 * kalau ada coin yang lolos kriteria bullish - supaya tidak spam
 * notif kosong tiap kali scheduler memanggil endpoint ini.
 *
 * Keamanan: wajib ada header Authorization: Bearer <CRON_SECRET>
 * yang cocok dengan env var CRON_SECRET, supaya orang lain di
 * internet tidak bisa sembarangan memicu endpoint ini (yang akan
 * menghabiskan kuota function Vercel dan bisa kena rate limit
 * Indodax kalau dipanggil berulang-ulang oleh pihak luar).
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const results = await scanBullishCoins();

    // Kalau tidak ada yang bullish, JANGAN kirim pesan - biar
    // Telegram kamu tidak dibanjiri notif "tidak ada apa-apa"
    // tiap kali scheduler jalan.
    if (results.length === 0) {
      return NextResponse.json({ ok: true, found: 0, notified: false });
    }

    const lines: string[] = ["\ud83d\udea8 *SCAN OTOMATIS - Momentum Bullish Terdeteksi*\n"];

    const top5 = results.slice(0, 5);
    top5.forEach((r, i) => {
      lines.push(
        `${i + 1}. \ud83d\udfe2 ${r.symbol}IDR - RSI ${r.rsi.toFixed(1)} - Rp ${formatRupiah(r.price)}`
      );
    });

    lines.push("");
    lines.push(
      `_Ditemukan ${results.length} coin bullish. Untuk detail lengkap salah satu, ketik /analisa <coin> di chat bot._`
    );
    lines.push(
      "_Ini deteksi momentum yang SUDAH mulai bergerak, bukan prediksi masa depan._"
    );

    await sendTelegramMessage(lines.join("\n"));

    return NextResponse.json({ ok: true, found: results.length, notified: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Scan otomatis gagal:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
