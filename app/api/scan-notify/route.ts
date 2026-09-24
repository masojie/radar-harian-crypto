import { NextResponse } from "next/server";
import { scanBullishCoins, scanNearestToThreshold, getWeeklyCandlesFull, detectSupportResistanceLevels, findNearestResistanceLevels } from "@/lib/indodax";
import { sendTelegramMessage } from "@/lib/telegram";
import { saveBullishScanResults, type BullishScanRow } from "@/lib/supabase";
import { openSignalViaGate } from "@/lib/outcome";

export const maxDuration = 60;

// Batas berapa kandidat oversold yang dicoba lewat gate per cycle. Dulu
// cuma nyoba top3 (RSI terendah) - kalau top3 itu KEBETULAN semua udah
// punya posisi open ("posisi_masih_terbuka"), notif gak pernah nyampe
// Telegram walaupun ada kandidat lain di bawahnya yang gak keblokir.
// Sekarang lanjut ke kandidat berikutnya kalau satu gagal, dibatasi
// MAX_ATTEMPTS supaya durasi request tetap wajar (maxDuration 60 detik).
const MAX_ATTEMPTS = 15;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== "Bearer " + cronSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const bullish = await scanBullishCoins();

    if (bullish.length === 0) {
      return NextResponse.json({ ok: true, count: 0 });
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
        });

        if (gate.broadcasted) {
          const f = (v: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(v);
          let msg = "🚨 *SCAN OTOMATIS - Momentum Bullish Terdeteksi*\n\n";
          msg += "1. 🟢 " + coin.symbol + " - RSI " + coin.rsi.toFixed(1) + " - " + f(coin.price) + "\n";
          if (resistances.length >= 2) msg += "   TP1 (resistance terdekat): " + f(resistances[0].price) + " (" + resistances[0].touches + "x disentuh)\n   TP2 (resistance berikutnya): " + f(resistances[1].price) + " (" + resistances[1].touches + "x disentuh)\n";
          if (supports.length >= 1) msg += "   Entry (support terdekat): " + f(supports[0].price) + " (" + supports[0].touches + "x disentuh)\n";

          // Kandidat lain buat konteks doang (tanpa TP/Entry, biar gak
          // ketuker sama level punya coin yang benar-benar disiarkan di
          // atas) - ambil dari sisa bullish, kecualikan coin yang barusan.
          const others = bullish.filter((c) => c.symbol !== coin.symbol).slice(0, 2);
          others.forEach((c, k) => {
            msg += (k + 2) + ". 🟢 " + c.symbol + " - RSI " + c.rsi.toFixed(1) + " - " + f(c.price) + "\n";
          });

          msg += "\nDitemukan " + bullish.length + " coin bullish. TP1/TP2 dari level resistance historis, Entry dari level support historis (candle mingguan, minimal 3x disentuh). Untuk detail lengkap salah satu, ketik /analisa <coin> di chat bot.\n";
          msg += "Ini deteksi momentum yang SUDAH mulai bergerak, bukan prediksi masa depan.\n\n⚡ [RadarView — pantau live di sini](https://radar-harian-crypto.vercel.app)";
          await sendTelegramMessage(msg);
          break;
        }
      } catch (e: any) {
        console.error("Signal fail for " + coin.symbol + ":", e?.message);
      }
    }

    return NextResponse.json({ ok: true, count: bullish.length, top3: bullish.slice(0, 3).map((c: any) => c.symbol) });
  } catch (error: any) {
    console.error("Scan-notify fail:", error?.message);
    return NextResponse.json({ ok: false, error: error?.message }, { status: 500 });
  }
}
