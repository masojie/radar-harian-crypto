import { NextResponse } from "next/server";
import { getCoinPrice } from "@/lib/indodax";
import { buildCoinPriceMessage } from "@/lib/format";
import { sendTelegramMessage } from "@/lib/telegram";

async function tgReply(chatId: number, text: string) {
  try { await sendTelegramMessage(text, String(chatId)); } catch (e: any) {
    console.error("TG reply fail:", e?.message);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as any;
    const msg = body?.message;
    if (!msg?.text || !msg?.chat?.id) return NextResponse.json({ ok: true });
    const chatId = msg.chat.id as number;
    const text = (msg.text as string).trim();
    const lower = text.toLowerCase();

    if (lower === "/start") {
      await tgReply(chatId, "🤖 *Radar Harian Crypto Bot*\n\nBot pemantau pasar crypto Indodax.\nFilter volume: Rp200-500 juta / 24 jam.\n\n/radar — Top volume Indodax\n/harga <coin> — Cek harga\n/analisa <coin> — Analisa sinyal\n/bantuan — Bantuan");
      return NextResponse.json({ ok: true });
    }

    if (lower === "/bantuan" || lower === "/help") {
      await tgReply(chatId, "📋 *Daftar Perintah*\n\n/radar — Top 5 volume Indodax (200-500 jt)\n/harga <symbol> — Cek harga coin\n/analisa <symbol> — Analisa sinyal multi-timeframe\n/bantuan — Tampilkan pesan ini");
      return NextResponse.json({ ok: true });
    }

    if (lower === "/radar") {
      try {
        const { getTopVolumeCoinsInRange } = await import("@/lib/indodax");
        const { buildRadarMessage } = await import("@/lib/format");
        const coins = await getTopVolumeCoinsInRange(5);
        if (coins.length === 0) {
          await tgReply(chatId, "📡 Tidak ada coin dalam range volume Rp200-500 juta saat ini.");
        } else {
          await tgReply(chatId, buildRadarMessage(coins));
        }
      } catch (e: any) {
        await tgReply(chatId, "❌ Gagal: " + (e?.message || "unknown"));
      }
      return NextResponse.json({ ok: true });
    }

    if (lower.startsWith("/harga")) {
      const parts = text.split(/\s+/);
      if (parts.length < 2) {
        await tgReply(chatId, "ℹ️ Gunakan: /harga <coin>\nContoh: /harga btc");
        return NextResponse.json({ ok: true });
      }
      const symbol = parts[1];
      try {
        const coin = await getCoinPrice(symbol);
        if (!coin) {
          await tgReply(chatId, "❌ *" + symbol.toUpperCase() + "* tidak ditemukan di Indodax.");
        } else {
          await tgReply(chatId, buildCoinPriceMessage(coin));
        }
      } catch (e: any) {
        await tgReply(chatId, "❌ Gagal: " + (e?.message || "unknown"));
      }
      return NextResponse.json({ ok: true });
    }

    if (lower.startsWith("/analisa")) {
      const parts = text.split(/\s+/);
      if (parts.length < 2) {
        await tgReply(chatId, "ℹ️ Gunakan: /analisa <coin>");
        return NextResponse.json({ ok: true });
      }
      const symbol = parts[1].toUpperCase();
      try {
        const { analyzeMultiTimeframe, calculateSpotLevels, scanBullishCoins, getWeeklyCandlesFull, detectSupportResistanceLevels, findNearestResistanceLevels } = await import("@/lib/indodax");
        const { buildAnalisaMessage } = await import("@/lib/format");
        const [mtf, levels, bullish] = await Promise.all([
          analyzeMultiTimeframe(symbol + "IDR"),
          calculateSpotLevels(symbol + "IDR", (await getCoinPrice(symbol))?.lastPrice ?? 0),
          scanBullishCoins(),
        ]);

        const coinScan = bullish.find((c: any) => c.symbol === symbol);
        const reply = buildAnalisaMessage(symbol, mtf, levels, coinScan);

        await tgReply(chatId, reply);
      } catch (e: any) {
        await tgReply(chatId, "❌ Gagal analisa: " + (e?.message || "unknown"));
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("Webhook error:", error?.message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ name: "Radar Harian Crypto Bot", filter: "Volume 200-500 juta IDR", status: "online" });
}
