import { NextResponse } from "next/server";
import { getTopVolumeCoins } from "@/lib/indodax";
import { sendTelegramMessage } from "@/lib/telegram";
import { saveBullishScanResults, type BullishScanRow } from "@/lib/supabase";
import { openSignalViaGate, SL_TIGHT_PCT, SL_WIDE_PCT, TP1_PCT, TP2_PCT, TP3_PCT } from "@/lib/outcome";

export const maxDuration = 60;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== "Bearer " + cronSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const allCoins = await getTopVolumeCoins(30);

    const oversold: Array<{
      symbol: string; rsi: number; price: number;
      buyPrice: number; sellPrice: number;
    }> = [];

    const nowSec = Math.floor(Date.now() / 1000);
    const fromSec = nowSec - 7200;

    const candlePromises = allCoins.map(async (coin) => {
      try {
        const res = await fetch(
          "https://indodax.com/api/tradingview/history?symbol=" +
            encodeURIComponent(coin.pairId) +
            "&resolution=5&from=" + fromSec + "&to=" + nowSec,
          { cache: "no-store", signal: AbortSignal.timeout(5000) }
        );
        if (!res.ok) return null;
        const json = await res.json() as any;
        if (!json.c || json.c.length < 15) return null;
        const closes: number[] = json.c;

        let gain = 0; let loss = 0;
        const period = 14;
        const slice = closes.slice(-(period + 1));
        for (let i = 1; i < slice.length; i++) {
          const diff = slice[i] - slice[i - 1];
          if (diff > 0) gain += diff; else loss += Math.abs(diff);
        }
        if (loss === 0) return { coin, rsi: 100 };
        const rs = gain / period / (loss / period);
        const rsi = 100 - 100 / (1 + rs);
        return { coin, rsi };
      } catch { return null; }
    });

    const results = await Promise.all(candlePromises);

    for (const r of results) {
      if (r && r.rsi < 40) {
        oversold.push({
          symbol: r.coin.symbol,
          rsi: Math.round(r.rsi * 10) / 10,
          price: r.coin.lastPrice,
          buyPrice: r.coin.buyPrice,
          sellPrice: r.coin.sellPrice,
        });
      }
    }

    if (oversold.length === 0) {
      return NextResponse.json({
        ok: true, scanned: allCoins.length, oversold: 0,
        message: "Tidak ada coin oversold di range 200-500 juta",
      });
    }

    oversold.sort((a, b) => a.rsi - b.rsi);
    const top3 = oversold.slice(0, 3);

    const bullRows: BullishScanRow[] = oversold.map((coin, idx) => ({
      symbol: coin.symbol, rsi: coin.rsi, price: coin.price,
      rank_in_scan: idx + 1,
      tp1_price: null, tp1_touches: null,
      tp2_price: null, tp2_touches: null,
      support_price: null, support_touches: null,
    }));

    try { await saveBullishScanResults(bullRows); } catch (e: any) {
      console.error("Scan-notify DB:", e?.message);
    }

    const opened: string[] = [];
    const skipped: string[] = [];

    for (let i = 0; i < top3.length; i++) {
      const coin = top3[i];
      try {
        const gate = await openSignalViaGate({
          symbol: coin.symbol, rsi: coin.rsi, price: coin.price,
          rank: i + 1, buyPrice: coin.buyPrice, sellPrice: coin.sellPrice,
        });

        if (gate.broadcasted) {
          const tp1 = gate.tp1 ?? coin.price * (1 + TP1_PCT);
          const tp2 = gate.tp2 ?? coin.price * (1 + TP2_PCT);
          const tp3 = coin.price * (1 + TP3_PCT);
          const slT = gate.slTight ?? coin.price * (1 - SL_TIGHT_PCT);
          const slW = gate.slWide ?? coin.price * (1 - SL_WIDE_PCT);

          const f = (v: number) =>
            new Intl.NumberFormat("id-ID", {
              style: "currency", currency: "IDR", maximumFractionDigits: 0,
            }).format(v);

          const msg =
            "🚀 *SINYAL BUY - " + coin.symbol + "*\n\n" +
            "💰 Harga: " + f(coin.price) + "\n" +
            "📊 RSI: " + coin.rsi + "\n\n" +
            "🎯 *TP1:* " + f(tp1) + "\n" +
            "🎯 *TP2:* " + f(tp2) + "\n" +
            "🎯 *TP3:* " + f(tp3) + "\n\n" +
            "🛑 *SL Tight:* " + f(slT) + "\n" +
            "🛑 *SL Wide:* " + f(slW) + "\n\n" +
            "_Vol: 200-500 jt IDR | Sinyal otomatis_";

          await sendTelegramMessage(msg);
          opened.push(coin.symbol);
        } else {
          skipped.push(coin.symbol + " (" + (gate.alasan || "?") + ")");
        }
      } catch (e: any) {
        skipped.push(coin.symbol + " (err)");
      }
    }

    return NextResponse.json({
      ok: true, scanned: allCoins.length, oversold: oversold.length,
      top3: top3.map((c) => c.symbol), opened, skipped,
    });
  } catch (error: any) {
    console.error("Scan-notify fail:", error?.message);
    return NextResponse.json({ ok: false, error: error?.message }, { status: 500 });
  }
}
