// Redeploy trigger: refresh CRON_SECRET env var
import { NextResponse } from "next/server";
import { scanBullishCoins, getWeeklyCandlesFull, detectSupportResistanceLevels, findNearestResistanceLevels } from "@/lib/indodax";
import { sendTelegramMessage } from "@/lib/telegram";
import { saveBullishScanResults, type BullishScanRow } from "@/lib/supabase";

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
 * Untuk 3 coin teratas (bukan semua top-5, demi menghindari timeout
 * function serverless), ditambahkan TP1/TP2 berbasis level resistance
 * historis (dari candle mingguan) - lebih berbasis fakta area yang
 * SUDAH TERBUKTI jadi titik pasar berbalik, dibanding sekadar
 * persentase tetap.
 *
 * Hasil scan JUGA disimpan ke Supabase (tabel bullish_scans) supaya
 * ada histori kapan saja momentum bullish terdeteksi sepanjang hari -
 * berguna untuk analisis pola nanti (misal: coin apa yang paling
 * sering muncul, jam berapa biasanya bullish terdeteksi). Penyimpanan
 * ini TIDAK BOLEH menghalangi notifikasi Telegram: kalau Supabase
 * bermasalah, pesan tetap harus terkirim seperti biasa.
 *
 * Keamanan: wajib ada header Authorization: Bearer <CRON_SECRET>
 * yang cocok dengan env var CRON_SECRET, supaya orang lain di
 * internet tidak bisa sembarangan memicu endpoint ini.
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

    if (results.length === 0) {
      return NextResponse.json({ ok: true, found: 0, notified: false, savedToDatabase: 0 });
    }

    const lines: string[] = ["🚨 *SCAN OTOMATIS - Momentum Bullish Terdeteksi*\n"];

    const top5 = results.slice(0, 5);
    const RESISTANCE_DETAIL_COUNT = 3; // batasi supaya tidak timeout

    // Dikumpulkan paralel dengan proses kirim pesan, supaya nanti bisa
    // disimpan ke Supabase dengan data resistance yang sama persis
    // dengan yang dikirim ke Telegram (satu sumber kebenaran).
    const rowsToSave: BullishScanRow[] = [];

    for (let i = 0; i < top5.length; i++) {
      const r = top5[i];
      lines.push(
        `${i + 1}. 🟢 ${r.symbol}IDR - RSI ${r.rsi.toFixed(1)} - Rp ${formatRupiah(r.price)}`
      );

      const row: BullishScanRow = {
        symbol: r.symbol,
        rsi: r.rsi,
        price: r.price,
        rank_in_scan: i + 1,
        tp1_price: null,
        tp1_touches: null,
        tp2_price: null,
        tp2_touches: null,
      };

      // Tambahkan TP1/TP2 berbasis resistance untuk 3 coin teratas saja
      if (i < RESISTANCE_DETAIL_COUNT) {
        try {
          const pairSymbol = `${r.symbol}IDR`;
          const weeklyCandles = await getWeeklyCandlesFull(pairSymbol);
          const levels = detectSupportResistanceLevels(weeklyCandles, r.price);
          const nearestResistances = findNearestResistanceLevels(levels, r.price, 2);

          if (nearestResistances.length >= 1) {
            lines.push(
              `   TP1 (resistance terdekat): Rp ${formatRupiah(nearestResistances[0].price)} (${nearestResistances[0].touches}x disentuh)`
            );
            row.tp1_price = nearestResistances[0].price;
            row.tp1_touches = nearestResistances[0].touches;
          }
          if (nearestResistances.length >= 2) {
            lines.push(
              `   TP2 (resistance berikutnya): Rp ${formatRupiah(nearestResistances[1].price)} (${nearestResistances[1].touches}x disentuh)`
            );
            row.tp2_price = nearestResistances[1].price;
            row.tp2_touches = nearestResistances[1].touches;
          }
        } catch (levelError) {
          // Kalau deteksi level gagal untuk satu coin (misal data
          // histori tidak cukup), lewati saja - jangan gagalkan
          // seluruh scan cuma karena satu coin bermasalah.
          console.error(`Gagal deteksi level untuk ${r.symbol}:`, levelError);
        }
      }

      rowsToSave.push(row);
    }

    lines.push("");
    lines.push(
      `_Ditemukan ${results.length} coin bullish. TP1/TP2 dihitung dari level resistance historis (candle mingguan, minimal 3x disentuh). Untuk detail lengkap salah satu, ketik /analisa <coin> di chat bot._`
    );
    lines.push(
      "_Ini deteksi momentum yang SUDAH mulai bergerak, bukan prediksi masa depan._"
    );

    // Telegram dikirim DULU - ini fungsi utama endpoint ini dan tidak
    // boleh terganggu oleh apapun yang terjadi di langkah penyimpanan.
    await sendTelegramMessage(lines.join("\n"));

    // Simpan ke Supabase SETELAH Telegram terkirim, dibungkus try-catch
    // terpisah. Kegagalan di sini hanya dicatat di log dan dilaporkan
    // lewat field savedToDatabase pada response - tidak pernah membuat
    // endpoint ini gagal atau melempar error ke scheduler eksternal.
    let savedToDatabase = 0;
    try {
      await saveBullishScanResults(rowsToSave);
      savedToDatabase = rowsToSave.length;
    } catch (dbError) {
      const dbMessage =
        dbError instanceof Error ? dbError.message : "Unknown database error";
      console.error("Scan-notify: gagal simpan ke Supabase (Telegram tetap terkirim):", dbMessage);
    }

    return NextResponse.json({
      ok: true,
      found: results.length,
      notified: true,
      savedToDatabase,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Scan otomatis gagal:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
