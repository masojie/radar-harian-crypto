import { NextResponse } from "next/server";
import { getCoinPrice } from "@/lib/indodax";
import { buildCoinPriceMessage } from "@/lib/format";
import { sendTelegramMessage } from "@/lib/telegram";
import { analyzeSwing, SwingAnalysis } from "@/lib/indodax";

// Bentuk minimal dari update yang dikirim Telegram ke webhook kita.
// Telegram sebenarnya kirim lebih banyak field, tapi kita cuma butuh ini.
interface TelegramUpdate {
  message?: {
    chat: {
      id: number;
    };
    text?: string;
  };
}


function formatRupiah(n: number): string {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(n);
}

function buildSwingMessage(results: SwingAnalysis[]): string {
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
      `Harga: Rp ${formatRupiah(r.lastClose)}`,
      `RSI14: ${r.rsi14.toFixed(1)}${rsiWarning}`,
      `MACD: ${r.macdLine.toFixed(2)} vs Signal ${r.macdSignal.toFixed(2)}`,
      `Tren: ${r.trend}`,
      ""
    );
  }

  lines.push("_Data asli Indodax (Rupiah). Bukan saran finansial._");
  return lines.join("\n");
}

const SWING_PAIRS = ["BTCIDR", "ETHIDR", "SOLIDR"];

/**
 * Endpoint ini didaftarkan ke Telegram sebagai webhook. Telegram akan
 * POST ke sini setiap kali ada pesan baru masuk ke bot, termasuk
 * private chat.
 *
 * Command yang didukung sekarang:
 * - /harga <coin>   contoh: /harga btc, /harga sol
 * - /analisa         swing harian BTC, ETH, SOL sekaligus
 * - /analisa <coin>  swing harian untuk 1 coin spesifik, contoh: /analisa sui
 */
export async function POST(request: Request) {
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (webhookSecret) {
    const receivedSecret = request.headers.get(
      "x-telegram-bot-api-secret-token"
    );
    if (receivedSecret !== webhookSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let update: TelegramUpdate;
  try {
    update = await request.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  const chatId = update.message?.chat.id;
  const text = update.message?.text;

  if (!chatId || !text) {
    return NextResponse.json({ ok: true });
  }

  // Command /analisa: tanpa argumen = BTC/ETH/SOL default,
  // dengan argumen (contoh: /analisa sui) = analisis 1 coin spesifik saja
  const analisaMatch = text.match(/^\/analisa(?:@\w+)?(?:\s+(\S+))?/i);
  if (analisaMatch) {
    const coinArg = analisaMatch[1];
    const pairsToAnalyze = coinArg
      ? [`${coinArg.toUpperCase()}IDR`]
      : SWING_PAIRS;

    try {
      const results = await Promise.all(
        pairsToAnalyze.map((pair) => analyzeSwing(pair))
      );
      await sendTelegramMessage(buildSwingMessage(results), String(chatId));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error";
      console.error("Webhook /analisa gagal:", message);

      const notFoundMsg = coinArg
        ? `Coin *${coinArg.toUpperCase()}* tidak ditemukan di Indodax, atau data candle-nya belum cukup untuk dianalisis.`
        : "Gagal menjalankan analisa, coba lagi sebentar lagi.";

      await sendTelegramMessage(notFoundMsg, String(chatId)).catch(() => {});
    }
    return NextResponse.json({ ok: true });
  }

  const match = text.match(/^\/harga(?:@\w+)?(?:\s+(\S+))?/i);

  if (!match) {
    return NextResponse.json({ ok: true });
  }

  const coinArg = match[1];

  if (!coinArg) {
    await sendTelegramMessage(
      "Pakai format: `/harga btc` atau `/harga sol`",
      String(chatId)
    );
    return NextResponse.json({ ok: true });
  }

  try {
    const coin = await getCoinPrice(coinArg);

    if (!coin) {
      await sendTelegramMessage(
        `Coin *${coinArg.toUpperCase()}* tidak ditemukan di Indodax.`,
        String(chatId)
      );
      return NextResponse.json({ ok: true });
    }

    await sendTelegramMessage(buildCoinPriceMessage(coin), String(chatId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Webhook /harga gagal:", message);

    await sendTelegramMessage(
      "Gagal ambil data harga, coba lagi sebentar lagi.",
      String(chatId)
    ).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
