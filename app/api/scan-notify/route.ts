import { NextResponse } from "next/server";
import { scanBullishCoins, scanNearestToThreshold, getWeeklyCandlesFull, detectSupportResistanceLevels, findNearestResistanceLevels, type ScanResult } from "@/lib/indodax";
import { sendTelegramMessage } from "@/lib/telegram";
import { saveBullishScanResults, type BullishScanRow } from "@/lib/supabase";
import { openSignalViaGate, cancelUnannouncedSignal } from "@/lib/outcome";
import { formatChannelPrice, formatChannelPct } from "@/lib/channel-format";
import { buildHeartbeatMessage, isHeartbeatSlot } from "@/lib/heartbeat";

export const maxDuration = 60;

// Batas berapa kandidat oversold yang dicoba lewat gate per cycle. Dulu
// cuma nyoba top3 (RSI terendah) - kalau top3 itu KEBETULAN semua udah
// punya posisi open ("posisi_masih_terbuka"), notif gak pernah nyampe
// Telegram walaupun ada kandidat lain di bawahnya yang gak keblokir.
// Sekarang lanjut ke kandidat berikutnya kalau satu gagal, dibatasi
// MAX_ATTEMPTS supaya durasi request tetap wajar (maxDuration 60 detik).
const MAX_ATTEMPTS = 15;

// Toleransi buat mencocokkan harga resistance yang DIUSULKAN (sisi
// TypeScript, dari findNearestResistanceLevels) dengan TP yang BENERAN
// dipakai gate (gate.tp1/gate.tp2, sisi Postgres, SETELAH lolos validasi
// try_insert_signal: jarak 1.02x-1.20x harga & minimal 3x disentuh).
// Kalau beda, artinya gate MENOLAK usulan resistance dan diam-diam
// fallback ke persentase tetap (+5%/+10%) - label pesan harus ikut
// angka itu, bukan resistance yang diusulkan tapi ditolak.
const PRICE_MATCH_TOLERANCE = 0.0001;

function isSameLevel(a: number | undefined, b: number | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  return Math.abs(a - b) <= Math.abs(b) * PRICE_MATCH_TOLERANCE;
}

// Heartbeat senyap: tanda radar hidup saat tidak ada sinyal baru yang disiarkan.
// Gagal kirim heartbeat TIDAK boleh membuat endpoint error ke cron, jadi
// dibungkus sendiri.
async function maybeSendHeartbeat(now: Date, bullish: ScanResult[]): Promise<boolean> {
  if (!isHeartbeatSlot(now)) return false;
  try {
    const nearest = bullish.length === 0 ? await scanNearestToThreshold(3) : undefined;
    await sendTelegramMessage(buildHeartbeatMessage({ now, bullish, nearest }), undefined, { silent: true });
    return true;
  } catch (e: any) {
    console.error("Scan-notify: gagal kirim heartbeat:", e?.message);
    return false;
  }
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== "Bearer " + cronSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV !== "development") {
    // Fail-closed (sama seperti route /api/radar): CRON_SECRET belum di-set di
    // production = salah konfigurasi, tolak. Dulu dibiarkan lolos, jadi kalau env
    // ini terhapus endpoint jadi kebuka untuk siapa saja.
    console.error("CRON_SECRET belum di-set, endpoint ditolak demi keamanan.");
    return NextResponse.json({ error: "Server misconfigured: CRON_SECRET is not set" }, { status: 500 });
  }

  try {
    const bullish = await scanBullishCoins();

    if (bullish.length === 0) {
      const heartbeatSent = await maybeSendHeartbeat(new Date(), bullish);
      return NextResponse.json({ ok: true, count: 0, heartbeatSent });
    }

    const bullRows: BullishScanRow[] = bullish.map((coin, idx) => ({
      symbol: coin.symbol,
      rsi: coin.rsi,
      price: coin.price,
      rank_in_scan: idx + 1,
      tp1_price: null, tp1_touches: null, tp2_price: null, tp2_touches: null,
      support_price: null, support_touches: null,
    }));

    try { await saveBullishScanResults(bullRows); } catch (e: any) {
      console.error("DB save fail:", e?.message);
    }

    const attempts = Math.min(bullish.length, MAX_ATTEMPTS);
    let broadcasted = false;

    for (let i = 0; i < attempts; i++) {
      const coin = bullish[i];
      try {
        const weekly = await getWeeklyCandlesFull(coin.symbol + "IDR");
        const levels = detectSupportResistanceLevels(weekly, coin.price);
        const resistances = findNearestResistanceLevels(levels, coin.price, 3);
        const supports = levels.filter((l: any) => l.type === "support" && l.price < coin.price).sort((a: any, b: any) => b.price - a.price).slice(0, 1);

        const tp1Res = resistances.length >= 1 ? resistances[0].price : undefined;
        const tp1Touches = resistances.length >= 1 ? resistances[0].touches : undefined;
        const tp2Res = resistances.length >= 2 ? resistances[1].price : undefined;
        const tp2Touches = resistances.length >= 2 ? resistances[1].touches : undefined;
        const supportRes = supports.length >= 1 ? supports[0].price : undefined;
        const supportTouches = supports.length >= 1 ? supports[0].touches : undefined;

        const gate = await openSignalViaGate({
          symbol: coin.symbol, rsi: coin.rsi, price: coin.price,
          rank: i + 1,
          tp1Res, tp1Touches, tp2Res, tp2Touches,
          supportRes, supportTouches,
          volumeIdr: coin.volumeIdr,
        });

        if (gate.broadcasted && gate.tp1 !== undefined && gate.tp2 !== undefined) {
          const f = formatChannelPrice;

          // PENTING: pesan HARUS pakai gate.tp1/gate.tp2 (angka final yang
          // beneran tersimpan di signal_outcomes dan dilacak
          // checkOpenOutcomes), BUKAN resistances[i].price (usulan mentah
          // sebelum divalidasi try_insert_signal). BUG LAMA: kalau usulan
          // resistance ditolak gate (jarak gak masuk akal / kurang dari 3x
          // disentuh), try_insert_signal diam-diam fallback ke fixed
          // 5%/10%, tapi pesan tetap nampilin angka resistance yang
          // DITOLAK itu - user baca TP yang gak pernah benar-benar
          // dilacak/berlaku (kejadian nyata di data: TP1 "+660%" tampil
          // di pesan padahal yang tersimpan sistem cuma +5%).
          const tp1FromResistance = isSameLevel(gate.tp1, tp1Res);
          const tp2FromResistance = isSameLevel(gate.tp2, tp2Res);

          let msg = "🚨 *SCAN OTOMATIS - Momentum Bullish Terdeteksi*\n\n";
          msg += "1. 🟢 " + coin.symbol + " - RSI " + coin.rsi.toFixed(1) + " - " + f(coin.price) + "\n";
          msg +=
            "   TP1" + (tp1FromResistance ? " (resistance terdekat)" : " (+5% dari entry)") + ":\n   " +
            f(gate.tp1) +
            (tp1FromResistance && tp1Touches !== undefined ? " (" + tp1Touches + "x disentuh)" : "") +
            "\n\n";
          msg +=
            "   TP2" + (tp2FromResistance ? " (resistance berikutnya)" : " (+10% dari entry)") + ":\n   " +
            f(gate.tp2) +
            (tp2FromResistance && tp2Touches !== undefined ? " (" + tp2Touches + "x disentuh)" : "") +
            "\n\n";
          // SL = batas rugi yang dipakai statistik dashboard (skenario SL lebar).
          // Angkanya HARUS gate.slWide (yang tersimpan dan dilacak), bukan
          // dihitung ulang di sini, dan persennya diturunkan dari harga supaya
          // tidak bisa beda dari yang dilacak. Tanpa baris ini subscriber tidak
          // pernah tahu level SL, padahal hasil di dashboard mengandaikannya.
          if (gate.slWide !== undefined && coin.price > 0) {
            msg +=
              "   SL (" + formatChannelPct((gate.slWide / coin.price - 1) * 100) + " dari entry):\n   " +
              f(gate.slWide) +
              "\n\n";
          }
          if (supports.length >= 1) msg += "   Entry (support terdekat):\n   " + f(supports[0].price) + " (" + supports[0].touches + "x disentuh)\n\n";

          // Koin bullish lain buat konteks doang, BUKAN sinyal baru. Yang
          // urutannya di atas koin ini sudah ditolak gate (umumnya posisinya
          // masih terbuka dari sinyal sebelumnya), jadi jangan tampil seperti
          // sinyal (nomor + 🟢): beri judul yang jelas. Tanpa TP/Entry biar
          // gak ketuker sama level koin yang benar-benar disiarkan di atas.
          const others = bullish.filter((c) => c.symbol !== coin.symbol).slice(0, 2);
          if (others.length > 0) {
            msg += "Pantauan lain (bukan sinyal baru):\n";
            others.forEach((c) => {
              msg += "· " + c.symbol + " - RSI " + c.rsi.toFixed(1) + " - " + f(c.price) + "\n";
            });
          }

          msg += "\nDitemukan " + bullish.length + " coin bullish. TP1/TP2 dari level resistance historis kalau tervalidasi (jarak wajar & minimal 3x disentuh), fallback ke +5%/+10% kalau tidak. Entry dari level support historis (candle mingguan, minimal 3x disentuh). Untuk detail lengkap salah satu, ketik /analisa <coin> di chat bot.\n";
          msg += "Ini deteksi momentum yang SUDAH mulai bergerak, bukan prediksi masa depan.\n\n⚡ RadarView — [pantau live di sini](https://radar-harian-crypto.vercel.app)";
          try {
            await sendTelegramMessage(msg);
          } catch (sendError: any) {
            // Posisi sudah terlanjur masuk DB tapi siarannya gagal. Batalkan posisi
            // itu supaya tidak jadi "posisi hantu" (terbuka 24 jam tanpa pernah
            // diumumkan), lalu berhenti: Telegram kemungkinan sedang bermasalah dan
            // cycle 5 menit berikutnya mencoba lagi. Dulu loop lanjut ke kandidat
            // berikutnya, bisa menumpuk sampai MAX_ATTEMPTS posisi hantu.
            console.error("Kirim Telegram gagal untuk " + coin.symbol + ":", sendError?.message);
            try {
              await cancelUnannouncedSignal(gate.outcomeId, gate.scanId);
            } catch (cancelError: any) {
              console.error("Batalkan posisi gagal untuk " + coin.symbol + ":", cancelError?.message);
            }
            return NextResponse.json({ ok: false, error: "telegram_send_failed", symbol: coin.symbol, count: bullish.length });
          }
          broadcasted = true;
          break;
        }
      } catch (e: any) {
        console.error("Signal fail for " + coin.symbol + ":", e?.message);
      }
    }

    // Tidak ada sinyal yang disiarkan di scan ini (semua kandidat ditolak gate):
    // channel tidak menerima apa pun, jadi pakai slot heartbeat supaya tetap kelihatan hidup.
    const heartbeatSent = broadcasted ? false : await maybeSendHeartbeat(new Date(), bullish);
    return NextResponse.json({ ok: true, count: bullish.length, top3: bullish.slice(0, 3).map((c: any) => c.symbol), heartbeatSent });
  } catch (error: any) {
    console.error("Scan-notify fail:", error?.message);
    return NextResponse.json({ ok: false, error: error?.message }, { status: 500 });
  }
}
