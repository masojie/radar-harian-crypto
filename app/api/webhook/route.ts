import { NextResponse } from "next/server";
import { getCoinPrice } from "@/lib/indodax";
import { sendTelegramMessage, answerCallbackQuery } from "@/lib/telegram";

async function tgReply(chatId: number, text: string, replyMarkup?: Record<string, unknown>) {
  try {
    await sendTelegramMessage(text, String(chatId), replyMarkup ? { replyMarkup } : undefined);
  } catch (e: any) {
    console.error("TG reply fail:", e?.message);
  }
}

// Menu tombol utama — muncul di /start, /bantuan, dan hasil /radar.
const MAIN_KEYBOARD = {
  inline_keyboard: [
    [
      { text: "📡 Radar", callback_data: "cmd:radar" },
      { text: "📊 Analisa BTC", callback_data: "cmd:analisa:BTC" },
    ],
    [{ text: "ℹ️ Bantuan", callback_data: "cmd:bantuan" }],
  ],
};

// Tombol di bawah hasil /analisa: refresh coin yang sama + balik ke radar.
function analisaKeyboard(symbol: string) {
  return {
    inline_keyboard: [
      [
        { text: `🔄 Refresh ${symbol}`, callback_data: `cmd:analisa:${symbol}` },
        { text: "📡 Radar", callback_data: "cmd:radar" },
      ],
    ],
  };
}

function bantuanText() {
  return (
    "📋 *Daftar Perintah*\n\n" +
    "📡 /radar — Top 5 volume Indodax (200-500 jt)\n" +
    "📊 /analisa <symbol> — Analisa sinyal multi-timeframe\n" +
    "ℹ️ /bantuan — Tampilkan pesan ini\n\n" +
    "_Atau tinggal tap tombol di bawah 👇_"
  );
}

async function runRadar(chatId: number) {
  try {
    const { getTopVolumeCoinsInRange } = await import("@/lib/indodax");
    const { buildRadarMessage } = await import("@/lib/format");
    const coins = await getTopVolumeCoinsInRange(5);
    if (coins.length === 0) {
      await tgReply(chatId, "📡 Tidak ada coin dalam range volume Rp200-500 juta saat ini.", MAIN_KEYBOARD);
    } else {
      await tgReply(chatId, buildRadarMessage(coins), MAIN_KEYBOARD);
    }
  } catch (e: any) {
    await tgReply(chatId, "❌ Gagal: " + (e?.message || "unknown"));
  }
}

async function runAnalisa(chatId: number, symbolRaw: string) {
  const symbol = symbolRaw.toUpperCase();
  try {
    const { analyzeMultiTimeframe, calculateSpotLevels, scanBullishCoins } = await import("@/lib/indodax");
    const { buildAnalisaMessage } = await import("@/lib/format");
    const [mtf, levels, bullish] = await Promise.all([
      analyzeMultiTimeframe(symbol + "IDR"),
      calculateSpotLevels(symbol + "IDR", (await getCoinPrice(symbol))?.lastPrice ?? 0),
      scanBullishCoins(),
    ]);

    const coinScan = bullish.find((c: any) => c.symbol === symbol);
    const reply = buildAnalisaMessage(symbol, mtf, levels, coinScan);

    await tgReply(chatId, reply, analisaKeyboard(symbol));
  } catch (e: any) {
    await tgReply(chatId, "❌ Gagal analisa: " + (e?.message || "unknown"));
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as any;

    // --- Tombol inline ditekan ---
    const cb = body?.callback_query;
    if (cb?.data && cb?.message?.chat?.id) {
      const chatId = cb.message.chat.id as number;
      const [, action, param] = (cb.data as string).split(":");
      answerCallbackQuery(cb.id).catch(() => {});

      if (action === "radar") await runRadar(chatId);
      else if (action === "bantuan") await tgReply(chatId, bantuanText(), MAIN_KEYBOARD);
      else if (action === "analisa" && param) await runAnalisa(chatId, param);

      return NextResponse.json({ ok: true });
    }

    // --- Pesan teks biasa ---
    const msg = body?.message;
    if (!msg?.text || !msg?.chat?.id) return NextResponse.json({ ok: true });
    const chatId = msg.chat.id as number;
    const text = (msg.text as string).trim();
    const lower = text.toLowerCase();

    if (lower === "/start") {
      await tgReply(
        chatId,
        "🤖 *Radar Harian Crypto Bot*\n\nBot pemantau pasar crypto Indodax.\nFilter volume: Rp200-500 juta / 24 jam.\n\nPilih menu di bawah 👇, atau ketik perintah manual.",
        MAIN_KEYBOARD
      );
      return NextResponse.json({ ok: true });
    }

    if (lower === "/bantuan" || lower === "/help") {
      await tgReply(chatId, bantuanText(), MAIN_KEYBOARD);
      return NextResponse.json({ ok: true });
    }

    if (lower === "/radar") {
      await runRadar(chatId);
      return NextResponse.json({ ok: true });
    }

    if (lower.startsWith("/analisa")) {
      const parts = text.split(/\s+/);
      if (parts.length < 2) {
        await tgReply(chatId, "ℹ️ Gunakan: /analisa <coin>");
        return NextResponse.json({ ok: true });
      }
      await runAnalisa(chatId, parts[1]);
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
