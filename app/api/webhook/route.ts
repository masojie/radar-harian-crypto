import { NextResponse } from "next/server";
import { getCoinPrice } from "@/lib/indodax";
import { buildCoinPriceMessage } from "@/lib/format";
import { sendTelegramMessage } from "@/lib/telegram";
import { analyzeMultiTimeframe, MultiTimeframeSignal } from "@/lib/indodax";

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

function buildMultiTimeframeMessage(result: MultiTimeframeSignal): string {
  const lines: string[] = [`\ud83d\udcca *ANALISA MULTI-TIMEFRAME - ${result.symbol}*\n`];

  lines.push(`Harga saat ini: Rp ${formatRupiah(result.currentPrice)}\n`);

  // Tampilkan vote per timeframe supaya user bisa cocokkan sendiri
  // di app Indodax mereka - transparansi ini yang bikin sinyal bisa
  // diverifikasi, bukan cuma diterima mentah.
  lines.push("*Detail per timeframe (EMA9/EMA50, RSI14):*");
  for (const v of result.votes) {
    const emaIcon = v.emaBullish ? "\u2705" : "\u274c";
    const rsiIcon = v.rsiBullish ? "\u2705" : "\u274c";
    lines.push(
      `${v.label}: EMA ${emaIcon} | RSI ${v.rsiValue.toFixed(1)} ${rsiIcon}`
    );
  }
  lines.push("");

  lines.push(
    `*Voting: EMA bullish ${result.emaBullishCount}/5, RSI bullish ${result.rsiBullishCount}/5*\n`
  );

  const signalEmoji =
    result.signal === "BUY" ? "\ud83d\udfe2" : result.signal === "SELL" ? "\ud83d\udd34" : "\u23f8\ufe0f";
  lines.push(`${signalEmoji} *SINYAL: ${result.signal}*`);
  lines.push(result.reason);
  lines.push("");

  // Level entry/exit/SL hanya ditampilkan kalau sinyal valid
  // (BUY atau SELL) - kalau TUNGGU, menampilkan angka entry
  // justru menyesatkan karena belum ada dasar konfirmasi kuat.
  if (result.signal === "BUY") {
    const entry = result.currentPrice;
    const sl = entry * 0.99; // SL sekitar 1% di bawah entry
    const tp = entry * 1.05; // TP sekitar 5% di atas entry (tengah dari rentang 4-6%)
    lines.push(
      "*Referensi posisi (bukan jaminan, selalu pakai manajemen risiko sendiri):*",
      `Entry (beli): sekitar Rp ${formatRupiah(entry)}`,
      `Stop Loss: sekitar Rp ${formatRupiah(sl)} (-1%)`,
      `Take Profit: sekitar Rp ${formatRupiah(tp)} (+5%)`,
      ""
    );
  } else if (result.signal === "SELL") {
    const entry = result.currentPrice;
    const sl = entry * 1.01; // SL sekitar 1% di atas entry untuk posisi sell
    const tp = entry * 0.95; // TP sekitar 5% di bawah entry
    lines.push(
      "*Referensi posisi (bukan jaminan, selalu pakai manajemen risiko sendiri):*",
      `Entry (jual): sekitar Rp ${formatRupiah(entry)}`,
      `Stop Loss: sekitar Rp ${formatRupiah(sl)} (+1%)`,
      `Take Profit: sekitar Rp ${formatRupiah(tp)} (-5%)`,
      ""
    );
  }

  lines.push(
    "_Data asli Indodax (Rupiah). Cocokkan indikator EMA9, EMA50, RSI14 di app Indodax kamu (chart > pilih timeframe 1m/5m/15m/30m/1h > indikator EMA & RSI) untuk verifikasi. Bukan saran finansial._"
  );

  return lines.join("\n");
}

function plainExplanation(rsi: number, trend: string): string {
  if (rsi >= 80) {
    return "\ud83d\udcac Sudah naik sangat tinggi dan rawan koreksi tajam. Kurang ideal untuk beli baru sekarang.";
  }
  if (rsi >= 70) {
    return "\ud83d\udcac Sudah naik cukup tinggi, rawan koreksi. Kalau punya profit, ini saat yang oke untuk ambil sebagian.";
  }
  if (rsi <= 20) {
    return "\ud83d\udcac Sudah turun sangat dalam, bisa jadi peluang pantulan, tapi juga bisa terus turun. Hati-hati.";
  }
  if (rsi <= 30) {
    return "\ud83d\udcac Sudah turun cukup dalam, mulai masuk area murah secara historis.";
  }
  if (trend === "bullish") {
    return "\ud83d\udcac Momentum masih sehat, belum terlalu panas atau dingin.";
  }
  if (trend === "bearish") {
    return "\ud83d\udcac Momentum sedang melemah, harga cenderung tertekan.";
  }
  return "\ud83d\udcac Momentum netral, belum ada arah kuat ke satu sisi.";
}

const SWING_PAIRS = ["BTCIDR", "ETHIDR", "SOLIDR"];

/**
 * Endpoint ini didaftarkan ke Telegram sebagai webhook. Telegram akan
 * POST ke sini setiap kali ada pesan baru masuk ke bot, termasuk
 * private chat.
 *
 * Command yang didukung sekarang:
 * - /harga <coin>   contoh: /harga btc, /harga sol
 * - /analisa <coin>  analisis multi-timeframe (1m,5m,15m,30m,1h)
 *                     untuk 1 coin, contoh: /analisa btc
 * - /help            panduan lengkap command dan cara verifikasi
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

  // Command /analisa <coin>: WAJIB ada argumen coin, karena sistem
  // multi-timeframe ini menganalisis 5 timeframe sekaligus untuk
  // 1 coin - jauh lebih berat dari analisa harian sebelumnya.
  const analisaMatch = text.match(/^\/analisa(?:@\w+)?(?:\s+(\S+))?/i);
  if (analisaMatch) {
    const coinArg = analisaMatch[1];

    if (!coinArg) {
      await sendTelegramMessage(
        "Pakai format: `/analisa btc` atau `/analisa sol`. Ketik /help untuk panduan lengkap.",
        String(chatId)
      );
      return NextResponse.json({ ok: true });
    }

    const pairSymbol = `${coinArg.toUpperCase()}IDR`;

    try {
      const result = await analyzeMultiTimeframe(pairSymbol);
      await sendTelegramMessage(
        buildMultiTimeframeMessage(result),
        String(chatId)
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error";
      console.error("Webhook /analisa gagal:", message);

      await sendTelegramMessage(
        `Coin *${coinArg.toUpperCase()}* tidak ditemukan di Indodax, atau data candle-nya belum cukup untuk dianalisis multi-timeframe.`,
        String(chatId)
      ).catch(() => {});
    }
    return NextResponse.json({ ok: true });
  }

  // Command /help: panduan command dan cara verifikasi indikator
  if (/^\/help(?:@\w+)?/i.test(text)) {
    const helpMessage = [
      "\ud83d\udcd6 *PANDUAN RADAR CRYPTO*\n",
      "*Command yang tersedia:*",
      "`/harga <coin>` - cek harga saat ini",
      "Contoh: `/harga btc`\n",
      "`/analisa <coin>` - analisis multi-timeframe lengkap",
      "Contoh: `/analisa sol`\n",
      "*Cara kerja /analisa:*",
      "Bot mengecek 5 timeframe sekaligus: 1 menit, 5 menit, 15 menit, 30 menit, dan 1 jam.",
      "Di tiap timeframe, dihitung 2 indikator:",
      "- EMA9 vs EMA50 (arah tren pendek)",
      "- RSI14 (momentum, bullish jika \u226550)\n",
      "Kalau minimal 3 dari 5 timeframe searah bullish di EMA MAUPUN RSI, sinyal *BUY* keluar. Simetris untuk *SELL*. Kalau belum cukup konfirmasi, bot akan bilang *TUNGGU*.\n",
      "*Cara mencocokkan sendiri di app Indodax:*",
      "1. Buka chart coin yang mau dicek",
      "2. Ganti timeframe candle ke 1m/5m/15m/30m/1h",
      "3. Tambahkan indikator EMA dengan periode 9 dan 50",
      "4. Tambahkan indikator RSI dengan periode 14",
      "5. Bandingkan dengan hasil yang bot kasih\n",
      "\u26a0\ufe0f Bot ini alat bantu analisis teknikal, bukan jaminan profit. Selalu pakai manajemen risiko sendiri.",
    ].join("\n");

    await sendTelegramMessage(helpMessage, String(chatId));
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
