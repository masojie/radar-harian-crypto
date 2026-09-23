import { NextResponse } from "next/server";
import { getTopVolumeCoins, getIntradayCandles, type TopCoin } from "@/lib/indodax";
import { buildRadarMessage } from "@/lib/format";
import { sendTelegramMessage } from "@/lib/telegram";
import {
  saveBullishScanResults,
  type BullishScanRow,
} from "@/lib/supabase";
import {
  openSignalViaGate,
  SL_TIGHT_PCT,
  SL_WIDE_PCT,
  TP1_PCT,
  TP2_PCT,
  TP3_PCT,
} from "@/lib/outcome";

/**
 * Dipanggil scheduler eksternal (cron-job.org) tiap 5 menit.
 *
 * Scan coin Indodax: cek RSI dari candle 5 menit, filter coin
 * yang oversold (RSI < 40), dan kirim sinyal BUY ke Telegram
 * lewat openSignalViaGate() supaya posisi dilacak.
 *
 * Volume filter: 200–500 juta IDR (diatur di lib/indodax.ts).
 *
 * Keamanan: wajib header Authorization: Bearer <CRON_SECRET>.
 */
export const maxDuration = 60;

/**
 * Hitung RSI sederhana dari array harga close.
 * Pakai periode 14 candle × 5 menit = 70 menit lookback.
 */
function calcRsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50; // belum cukup data

  const relevant = closes.slice(-(period + 1));
  let gainSum = 0;
  let lossSum = 0;

  for (let i = 1; i < relevant.length; i++) {
    const diff = relevant[i] - relevant[i - 1];
    if (diff > 0) gainSum += diff;
    else lossSum += Math.abs(diff);
  }

  if (lossSum === 0) return 100;
  const rs = (gainSum / period) / (lossSum / period);
  return 100 - 100 / (1 + rs);
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    // 1. Ambil semua coin dalam range volume 200–500 juta.
    // Retry sekali kalau fetch ke Indodax gagal/flaky — 1x hiccup
    // jangan sampai bikin seluruh cycle scan (5 menit) gagal total.
    let allCoins: TopCoin[];
    try {
      allCoins = await getTopVolumeCoins(100);
    } catch (fetchErr) {
      console.error(
        "Scan-notify: fetch ticker_all gagal, retry sekali dalam 1.5 detik:",
        fetchErr instanceof Error ? fetchErr.message : fetchErr
      );
      await new Promise((resolve) => setTimeout(resolve, 1500));
      allCoins = await getTopVolumeCoins(100);
    }

    const oversold: Array<{
      symbol: string;
      rsi: number;
      price: number;
      buyPrice: number;
      sellPrice: number;
    }> = [];

    // 2. Untuk tiap coin, hitung RSI dari candle 5 menit
    for (const coin of allCoins) {
      try {
        const candles = await getIntradayCandles(coin.pairId, "5", 20);
        if (candles.length < 15) continue;

        const closes = candles.map((c) => c.close);
        const rsi = calcRsi(closes);

        if (rsi < 40) {
          oversold.push({
            symbol: coin.symbol,
            rsi: Math.round(rsi * 10) / 10,
            price: coin.lastPrice,
            buyPrice: coin.buyPrice,
            sellPrice: coin.sellPrice,
          });
        }
      } catch {
        // Skip coin yang gagal ambil candle — lanjut
      }
    }

    if (oversold.length === 0) {
      return NextResponse.json({
        ok: true,
        scanned: allCoins.length,
        oversold: 0,
        message: "Tidak ada coin oversold di range volume 200–500 juta",
      });
    }

    // 3. Urutkan RSI terendah dulu
    oversold.sort((a, b) => a.rsi - b.rsi);

    // 4. Simpan hasil scan ke Supabase (top 3 dapat TP berbasis resistance)
    const top3 = oversold.slice(0, 3);
    const bullRows: BullishScanRow[] = oversold.map((coin, idx) => ({
      symbol: coin.symbol,
      rsi: coin.rsi,
      price: coin.price,
      rank_in_scan: idx + 1,
      tp1_price: null,
      tp1_touches: null,
      tp2_price: null,
      tp2_touches: null,
      support_price: null,
      support_touches: null,
    }));

    let savedIds: Array<{
      id: number;
      symbol: string;
      scanned_at: string;
      price: number;
      rsi: number;
    }> = [];

    try {
      savedIds = await saveBullishScanResults(bullRows);
    } catch (dbError) {
      console.error(
        "Scan-notify: gagal simpan ke Supabase:",
        dbError instanceof Error ? dbError.message : dbError
      );
    }

    // 5. Buka sinyal lewat gate + notif Telegram untuk top 3
    const signalsOpened: string[] = [];
    const signalsSkipped: string[] = [];

    for (let i = 0; i < top3.length; i++) {
      const coin = top3[i];
      try {
        const gateResult = await openSignalViaGate({
          symbol: coin.symbol,
          rsi: coin.rsi,
          price: coin.price,
          rank: i + 1,
          buyPrice: coin.buyPrice,
          sellPrice: coin.sellPrice,
        });

        if (gateResult.broadcasted) {
          const tp1 = gateResult.tp1 ?? coin.price * (1 + TP1_PCT);
          const tp2 = gateResult.tp2 ?? coin.price * (1 + TP2_PCT);
          const tp3 = coin.price * (1 + TP3_PCT);
          const slTight =
            gateResult.slTight ?? coin.price * (1 - SL_TIGHT_PCT);
          const slWide = gateResult.slWide ?? coin.price * (1 - SL_WIDE_PCT);

          const format = (v: number) =>
            new Intl.NumberFormat("id-ID", {
              style: "currency",
              currency: "IDR",
              maximumFractionDigits: 0,
            }).format(v);

          const msg =
            `🚀 *SINYAL BUY — ${coin.symbol}*\n\n` +
            `💰 Harga: ${format(coin.price)}\n` +
            `📊 RSI: ${coin.rsi}\n\n` +
            `🎯 *TP1:* ${format(tp1)}\n` +
            `🎯 *TP2:* ${format(tp2)}\n` +
            `🎯 *TP3:* ${format(tp3)}\n\n` +
            `🛑 *SL Tight:* ${format(slTight)}\n` +
            `🛑 *SL Wide:* ${format(slWide)}\n\n` +
            `_Sinyal otomatis radar-harian-crypto_`;

          await sendTelegramMessage(msg);
          signalsOpened.push(coin.symbol);
        } else {
          signalsSkipped.push(
            `${coin.symbol} (${gateResult.alasan ?? "tidak diketahui"})`
          );
        }
      } catch (e) {
        signalsSkipped.push(
          `${coin.symbol} (error: ${e instanceof Error ? e.message : "unknown"})`
        );
      }
    }

    return NextResponse.json({
      ok: true,
      scanned: allCoins.length,
      oversold: oversold.length,
      top3: top3.map((c) => c.symbol),
      signalsOpened,
      signalsSkipped,
      savedToDatabase: savedIds.length > 0,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Scan-notify gagal:", message);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
