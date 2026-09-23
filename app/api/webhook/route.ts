import { NextResponse } from "next/server";
import { getTopVolumeCoins, type TopCoin } from "@/lib/indodax";
import { buildCoinPriceMessage } from "@/lib/format";
import { sendTelegramMessage } from "@/lib/telegram";

/**
 * Webhook Telegram Bot — terima pesan masuk & balas otomatis.
 *
 * Dipasang sekali lewat setWebhook Telegram API:
 * https://api.telegram.org/bot<TOKEN>/setWebhook?url=<DEPLOY_URL>/api/webhook
 *
 * Command yang didukung:
 * - /start    — sapaan pembuka
 * - /bantuan  — daftar command
 * - /harga <symbol>  — harga spot coin di Indodax
 * - /radar    — top 5 volume Indodax (range 200-500 jt)
 */

/** Cari coin spesifik dari ticker Indodax. */
async function findCoin(symbol: string): Promise<TopCoin | null> {
  const coins = await getTopVolumeCoins(100);
  const found = coins.find(
    (c) => c.symbol.toUpperCase() === symbol.toUpperCase()
  );
  return found ?? null;
}

/** Balas pesan ke pengirim lewat Telegram. */
async function reply(chatId: number, text: string, silent = false) {
  try {
    await sendTelegramMessage(text, String(chatId), { silent });
  } catch (e) {
    console.error(
      "Webhook: gagal balas ke",
      chatId,
      ":",
      e instanceof Error ? e.message : e
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      message?: {
        message_id?: number;
        chat?: { id?: number; type?: string };
        text?: string;
      };
    };

    const msg = body.message;
    if (!msg?.text || !msg?.chat?.id) {
      return NextResponse.json({ ok: true }); // bukan pesan teks — abaikan
    }

    const chatId = msg.chat.id;
    const text = msg.text.trim();
    const lower = text.toLowerCase();

    // ── /start ──
    if (lower === "/start") {
      await reply(
        chatId,
        `🤖 *Radar Harian Crypto Bot*\n\n` +
          `Bot pemantau pasar crypto Indodax.\n` +
          `Filter volume: Rp200–500 juta / 24 jam.\n\n` +
          `Ketik /bantuan untuk daftar perintah.`
      );
      return NextResponse.json({ ok: true });
    }

    // ── /bantuan ──
    if (lower === "/bantuan" || lower === "/help") {
      await reply(
        chatId,
        `📋 *Daftar Perintah*\n\n` +
          `/radar — Top 5 volume Indodax (200–500 jt)\n` +
          `/harga <symbol> — Cek harga coin\n` +
          `Contoh: /harga btc\n` +
          `/bantuan — Tampilkan pesan ini`
      );
      return NextResponse.json({ ok: true });
    }

    // ── /radar ──
    if (lower === "/radar") {
      try {
        const coins = await getTopVolumeCoins(5);
        if (coins.length === 0) {
          await reply(
            chatId,
            "📡 Tidak ada coin dalam range volume Rp200–500 juta saat ini."
          );
        } else {
          const { buildRadarMessage } = await import("@/lib/format");
          await reply(chatId, buildRadarMessage(coins));
        }
      } catch (e) {
        await reply(
          chatId,
          `❌ Gagal ambil data radar: ${e instanceof Error ? e.message : "unknown"}`
        );
      }
      return NextResponse.json({ ok: true });
    }

    // ── /harga <symbol> ──
    if (lower.startsWith("/harga")) {
      const parts = text.split(/\s+/);
      if (parts.length < 2) {
        await reply(
          chatId,
          "ℹ️ Gunakan: `/harga <symbol>`\\nContoh: `/harga btc`"
        );
        return NextResponse.json({ ok: true });
      }

      const symbol = parts[1];
      try {
        const coin = await findCoin(symbol);
        if (!coin) {
          await reply(
            chatId,
            `❌ Coin *${symbol.toUpperCase()}* tidak ditemukan di Indodax (atau di luar range volume Rp200–500 juta).`
          );
        } else {
          await reply(chatId, buildCoinPriceMessage(coin));
        }
      } catch (e) {
        await reply(
          chatId,
          `❌ Gagal ambil harga ${symbol.toUpperCase()}: ${e instanceof Error ? e.message : "unknown"}`
        );
      }
      return NextResponse.json({ ok: true });
    }

    // ── Pesan tidak dikenal ──
    await reply(
      chatId,
      `ℹ️ Perintah tidak dikenal. Ketik /bantuan untuk daftar perintah.`,
      true
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(
      "Webhook error:",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

/** GET: biar bisa dites lewat browser — tampilkan info bot. */
export async function GET() {
  return NextResponse.json({
    name: "Radar Harian Crypto Bot",
    filter: "Volume 200-500 juta IDR",
    commands: ["/start", "/bantuan", "/radar", "/harga <symbol>"],
    status: "online",
  });
}
