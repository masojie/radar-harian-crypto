// Redeploy trigger: refresh CRON_SECRET env var
import { NextResponse } from "next/server";
import { scanBullishCoins, scanNearestToThreshold, getWeeklyCandlesFull, detectSupportResistanceLevels, findNearestResistanceLevels } from "@/lib/indodax";
import { sendTelegramMessage } from "@/lib/telegram";
import { saveBullishScanResults, type BullishScanRow } from "@/lib/supabase";
import { openSignalIfNew } from "@/lib/outcome";

function formatRupiah(n: number): string {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(n);
}

// ============================================================
// HEARTBEAT: pesan senyap berkala saat TIDAK ada sinyal, supaya
// channel tidak terlihat mati ketika pasar sedang naik.
//
// Cron jalan tiap 5 menit, jadi jadwal ditentukan dari jam WIB:
// kirim hanya kalau jam WIB genap DAN menit 0-4. Itu tepat satu
// kali per 2 jam, tanpa tabel penyimpan status di database.
// ============================================================
const HEARTBEAT_EVERY_HOURS = 2;
const HEARTBEAT_WINDOW_MINUTES = 5; // sama dengan interval cron

function isHeartbeatSlot(now: Date): boolean {
  // WIB = UTC+7, tanpa daylight saving.
  const wib = new Date(now.getTime() + 7 * 3600 * 1000);
  const hour = wib.getUTCHours();
  const minute = wib.getUTCMinutes();
  return hour % HEARTBEAT_EVERY_HOURS === 0 && minute < HEARTBEAT_WINDOW_MINUTES;
}

function formatWibClock(now: Date): string {
  const wib = new Date(now.getTime() + 7 * 3600 * 1000);
  const hh = String(wib.getUTCHours()).padStart(2, "0");
  const mm = String(wib.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

async function sendHeartbeat(now: Date): Promise<boolean> {
  const summary = await scanNearestToThreshold(3);

  const lines: string[] = [
    "\u{1F493} *RADAR HIDUP - Belum Ada Sinyal*",
    "",
    `Scan ${formatWibClock(now)} WIB: ${summary.checkedCount} coin dicek, tidak ada yang RSI 1 jam di bawah 35.`,
  ];

  if (summary.nearest.length > 0) {
    lines.push("", "Terdekat ke ambang:");
    summary.nearest.forEach((r, i) => {
      lines.push(`${i + 1}. ${r.symbol} - RSI ${r.rsi.toFixed(1)}`);
    });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) {
    lines.push("", `\u26A1 [RadarView](${appUrl})`);
  }

  await sendTelegramMessage(lines.join("\n"), undefined, { silent: true });
  return true;
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
 * Pesan Telegram juga menyertakan LINK ke dashboard web (Tab Radar),
 * supaya orang yang lihat notif bisa langsung cek visualnya dengan
 * data real yang sama persis dengan yang baru disimpan ke Supabase -
 * bukan link statis, tapi mengarah ke halaman yang auto-refresh tiap
 * 60 detik dari tabel yang sama (bullish_scans). Kalau env var
 * NEXT_PUBLIC_APP_URL belum diset, baris link ini dilewati saja
 * (tidak menggagalkan pengiriman notif).
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
      // Tidak ada sinyal. Kirim heartbeat senyap tiap 2 jam saja.
      // Gagal kirim heartbeat TIDAK boleh membuat endpoint error ke
      // cron, jadi dibungkus try-catch terpisah.
      let heartbeatSent = false;
      const now = new Date();
      if (isHeartbeatSlot(now)) {
        try {
          heartbeatSent = await sendHeartbeat(now);
        } catch (hbError) {
          const hbMessage =
            hbError instanceof Error ? hbError.message : "Unknown heartbeat error";
          console.error("Scan-notify: gagal kirim heartbeat:", hbMessage);
        }
      }
      return NextResponse.json({
        ok: true,
        found: 0,
        notified: false,
        savedToDatabase: 0,
        heartbeatSent,
      });
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

    // Link ke dashboard - dilewati kalau env var belum diset, tidak
    // menggagalkan notif. Pakai format link Markdown karena
    // sendTelegramMessage sudah pakai parse_mode: "Markdown".
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (appUrl) {
      lines.push("");
      lines.push(`⚡ *RadarView* — [pantau live di sini](${appUrl})`);
    }

    // Telegram dikirim DULU - ini fungsi utama endpoint ini dan tidak
    // boleh terganggu oleh apapun yang terjadi di langkah penyimpanan.
    await sendTelegramMessage(lines.join("\n"));

    // Simpan ke Supabase SETELAH Telegram terkirim, dibungkus try-catch
    // terpisah. Kegagalan di sini hanya dicatat di log dan dilaporkan
    // lewat field savedToDatabase pada response - tidak pernah membuat
    // endpoint ini gagal atau melempar error ke scheduler eksternal.
    let savedToDatabase = 0;
    let positionsOpened = 0;
    try {
      const saved = await saveBullishScanResults(rowsToSave);
      savedToDatabase = saved.length;

      // Buka posisi outcome untuk tiap sinyal - HANYA kalau koin itu
      // belum punya posisi open (satu kejadian = satu posisi). Gagal di
      // sini tidak boleh membatalkan apa pun yang sudah terkirim.
      for (const s of saved) {
        try {
          const opened = await openSignalIfNew({
            signalId: s.id,
            symbol: s.symbol,
            signaledAt: s.scanned_at,
            entryPrice: s.price,
            rsi: s.rsi,
          });
          if (opened) positionsOpened++;
        } catch (posError) {
          console.error(`Gagal buka posisi outcome ${s.symbol}:`, posError);
        }
      }
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
      positionsOpened,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Scan otomatis gagal:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
