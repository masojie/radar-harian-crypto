import { NextResponse } from "next/server";
import { getCoinPrice } from "@/lib/indodax";
import { buildCoinPriceMessage } from "@/lib/format";
import { sendTelegramMessage } from "@/lib/telegram";

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

/**
 * Endpoint ini didaftarkan ke Telegram sebagai webhook. Telegram akan
 * POST ke sini setiap kali ada pesan baru masuk ke bot, termasuk
 * private chat.
 *
 * Command yang didukung sekarang:
 * - /harga <coin>   contoh: /harga btc, /harga sol
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
