import { NextResponse } from "next/server";
import { getCoinPrice, getTopVolumeCoinsInRange } from "@/lib/indodax";
import { buildCoinPriceMessage, buildRadarMessage, formatVolumeSingkat } from "@/lib/format";
import { sendTelegramMessage } from "@/lib/telegram";
import { analyzeMultiTimeframe, MultiTimeframeSignal, calculateSpotLevels, SpotPositionLevels, scanBullishCoins, ScanResult, getWeeklyCandlesFull, detectSupportResistanceLevels, findNearestResistanceLevels, findNearestSupportLevels } from "@/lib/indodax";

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

function buildScanMessage(results: ScanResult[]): string {
  if (results.length === 0) {
    return [
      "\ud83d\udd0d *SCAN CEPAT - Coin Bullish (1H)*\n",
      "Tidak ada coin yang memenuhi kriteria bullish saat ini (EMA9>EMA50 dan RSI>=50).",
      "",
      "_Minimal volume: Rp 500 Jt. Coba lagi beberapa saat lagi._",
    ].join("\n");
  }

  const lines: string[] = ["\ud83d\udd0d *SCAN CEPAT - Coin Bullish (1H)*\n"];

  const top10 = results.slice(0, 10);
  top10.forEach((r, i) => {
    lines.push(`${i + 1}. \ud83d\udfe2 ${r.symbol}IDR - RSI ${r.rsi.toFixed(1)} - Rp ${formatRupiah(r.price)}`);
  });

  lines.push("");
  lines.push(`_Ditemukan ${results.length} coin bullish dari maksimal 50 coin yang di-scan (volume >= Rp 500 Jt)._`);
  lines.push("_Ini deteksi momentum yang SUDAH mulai bergerak, bukan prediksi masa depan. Untuk detail lengkap, ketik /analisa <coin>._");

  return lines.join("\n");
}

async function buildMultiTimeframeMessage(result: MultiTimeframeSignal): Promise<string> {
  const lines: string[] = [`\ud83d\udcca *ANALISA MULTI-TIMEFRAME - ${result.symbol}*\n`];

  lines.push(`Harga saat ini: Rp ${formatRupiah(result.currentPrice)}`);

  try {
    const coinInfo = await getCoinPrice(result.symbol);
    if (coinInfo) {
      lines.push(`Volume 24 Jam: ${formatVolumeSingkat(coinInfo.volumeIdr)}\n`);
    } else {
      lines.push("");
    }
  } catch (e) {
    lines.push("");
  }

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
    `*Voting tertimbang: EMA bullish ${result.emaWeightedScore}/8, RSI bullish ${result.rsiWeightedScore}/8*`
  );
  lines.push(
    `_(1h dan 30m diberi bobot lebih besar dari timeframe kecil)_`
  );
  const volumeIcon = result.volumeConfirmed ? "\u2705" : "\u26a0\ufe0f";
  lines.push(
    `*Volume 1h: ${result.volumeRatio1h.toFixed(1)}x rata-rata* ${volumeIcon} (syarat minimal 1.5x)\n`
  );

  const signalEmoji =
    result.signal === "BUY" ? "\ud83d\udfe2" : result.signal === "SELL" ? "\ud83d\udd34" : "\u23f8\ufe0f";
  lines.push(`${signalEmoji} *SINYAL: ${result.signal}*${result.confidence ? ` (Confidence: ${result.confidence})` : ""}`);
  lines.push(result.reason);
  lines.push("");

  // PENTING - logic SPOT: BUY = area masuk beli yang baik.
  // SELL BUKAN ajakan buka posisi short baru (itu cuma bisa di
  // futures/margin) - di SPOT, SELL berarti "kalau kamu SUDAH
  // PEGANG coin ini, pertimbangkan exit sekarang". TUNGGU tidak
  // dapat level apapun karena belum ada dasar konfirmasi kuat.
  if (result.signal === "BUY") {
    const levels: SpotPositionLevels = await calculateSpotLevels(
      result.symbol,
      result.currentPrice
    );

    lines.push(
      "*Referensi posisi BELI (bukan jaminan, selalu pakai manajemen risiko sendiri):*",
      `Entry: sekitar Rp ${formatRupiah(levels.entry)}`,
      `Stop Loss Ketat: sekitar Rp ${formatRupiah(levels.stopLossTight)} (-3%)`,
      `Stop Loss Longgar: sekitar Rp ${formatRupiah(levels.stopLossWide)} (-5%)`,
      `TP1: sekitar Rp ${formatRupiah(levels.takeProfit1)} (+5%)`,
      `TP2: sekitar Rp ${formatRupiah(levels.takeProfit2)} (+10%)`,
      `TP3: sekitar Rp ${formatRupiah(levels.takeProfit3)} (+15%)`,
      ""
    );

    // Fibonacci ditampilkan sebagai konteks pendukung - kalau TP1-3
    // kebetulan dekat dengan salah satu level ini, itu konfirmasi
    // tambahan, bukan basis utama penentuan TP.
    lines.push(
      "*Konteks Fibonacci (swing 1 jam terakhir):*",
      `Swing High: Rp ${formatRupiah(levels.fibonacci.swingHigh)}`,
      `Fib 61.8%: Rp ${formatRupiah(levels.fibonacci.level618)}`,
      `Fib 50%: Rp ${formatRupiah(levels.fibonacci.level500)}`,
      `Fib 38.2%: Rp ${formatRupiah(levels.fibonacci.level382)}`,
      `Swing Low: Rp ${formatRupiah(levels.fibonacci.swingLow)}`,
      ""
    );
  } else if (result.signal === "SELL") {
    lines.push(
      "\u26a0\ufe0f *Ini SPOT, bukan futures* - sinyal SELL berarti: kalau kamu SUDAH PEGANG coin ini, pertimbangkan exit/jual sekarang. Ini BUKAN ajakan buka posisi jual baru untuk yang belum punya coinnya.",
      ""
    );
  }

  // Support & Resistance mingguan - level besar dari struktur candle
  // 1 tahun terakhir, sudah terbukti dipantulkan berkali-kali (bukan
  // cuma persentase tetap dari harga sekarang).
  try {
    const weeklyCandles = await getWeeklyCandlesFull(result.symbol);
    const srLevels = detectSupportResistanceLevels(weeklyCandles, result.currentPrice);
    const nearestResistance = findNearestResistanceLevels(srLevels, result.currentPrice, 1);
    const nearestSupport = findNearestSupportLevels(srLevels, result.currentPrice, 1);

    if (nearestResistance.length > 0 || nearestSupport.length > 0) {
      lines.push("\ud83d\udccc *Support & Resistance (mingguan):*");
      if (nearestResistance.length > 0) {
        const r = nearestResistance[0];
        const pct = ((r.price - result.currentPrice) / result.currentPrice) * 100;
        lines.push(`\ud83d\udd34 Resistance: Rp ${formatRupiah(r.price)}`);
        lines.push(`   +${pct.toFixed(1)}% \u00b7 ${r.touches}x sentuh`);
      }
      if (nearestSupport.length > 0) {
        const s = nearestSupport[0];
        const pct = ((s.price - result.currentPrice) / result.currentPrice) * 100;
        lines.push(`\ud83d\udfe2 Support: Rp ${formatRupiah(s.price)}`);
        lines.push(`   ${pct.toFixed(1)}% \u00b7 ${s.touches}x sentuh`);
      }
      lines.push("");
      lines.push("\ud83d\udfe9 EMA naik / RSI oversold \u00b7 \ud83d\udfe5 sebaliknya");
      lines.push("");
    }
  } catch (e) {
    // Kalau gagal ambil data mingguan, skip blok ini tanpa gagalkan seluruh pesan.
  }

  lines.push(
    "_Data asli Indodax (Rupiah). Cocokkan indikator EMA9, EMA50, RSI14 di app Indodax kamu (chart > pilih timeframe 1m/5m/15m/30m/1h > indikator EMA & RSI) untuk verifikasi. Bukan saran finansial._"
  );
  lines.push("");
  lines.push(`\ud83d\udcc8 [Lihat chart di Indodax](https://indodax.com/chart/${result.symbol}?theme=dark)`);

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
 * - /scan             scan cepat semua coin, cari yang bullish (1H)
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

  // Command /radar: top 5 coin volume 200-500jt IDR, buat cek cepat
  // tanpa perlu sebut nama coin.
  if (/^\/radar(?:@\w+)?/i.test(text)) {
    try {
      const coins = await getTopVolumeCoinsInRange(5);
      if (coins.length === 0) {
        await sendTelegramMessage(
          "\ud83d\udce1 Tidak ada coin dalam range volume Rp200-500 juta saat ini.",
          String(chatId)
        );
      } else {
        await sendTelegramMessage(buildRadarMessage(coins), String(chatId));
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error";
      console.error("Webhook /radar gagal:", message);
      await sendTelegramMessage(
        "Gagal ambil data radar, coba lagi sebentar lagi.",
        String(chatId)
      ).catch(() => {});
    }
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
      const message = await buildMultiTimeframeMessage(result);
      await sendTelegramMessage(message, String(chatId));
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

  // Command /scan: scan cepat semua coin, cari yang momentumnya
  // sudah mulai bullish di timeframe 1 jam. Tidak butuh argumen.
  if (/^\/scan(?:@\w+)?/i.test(text)) {
    try {
      const results = await scanBullishCoins();
      await sendTelegramMessage(buildScanMessage(results), String(chatId));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error";
      console.error("Webhook /scan gagal:", message);
      await sendTelegramMessage(
        "Gagal menjalankan scan, coba lagi sebentar lagi.",
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
      "`/radar` - top 5 coin volume Rp200-500 juta 24 jam",
      "`/harga <coin>` - cek harga saat ini",
      "Contoh: `/harga btc`",
      "`/analisa <coin>` - analisis multi-timeframe lengkap",
      "Contoh: `/analisa sol`",
      "`/scan` - scan cepat semua coin, cari yang momentumnya sudah mulai bullish (timeframe 1 jam)\n",
      "*1) /radar - lihat coin yang lagi ramai*",
      "Menampilkan 5 coin dengan volume transaksi 24 jam antara Rp200-500 juta di Indodax, diurutkan dari volume terbesar. Cocok buat cari coin yang mulai ramai ditransaksikan tapi belum terlalu besar (masih ada ruang gerak harga).\n",
      "*2) /analisa <coin> - baca kartu sinyalnya*",
      "Bot mengecek 5 timeframe sekaligus: 1 menit, 5 menit, 15 menit, 30 menit, dan 1 jam. Di tiap timeframe, dihitung 2 indikator:",
      "- EMA9 vs EMA50 (arah tren pendek): \u2705 = EMA9 di atas EMA50 (bullish), \u274c = sebaliknya",
      "- RSI14 (momentum): \u2705 = RSI \u226550 (bullish), \u274c = di bawah 50\n",
      "Kalau minimal 3 dari 5 timeframe searah bullish di EMA MAUPUN RSI (dengan bobot 1h & 30m lebih besar), sinyal *BUY* keluar. Simetris untuk *SELL*. Kalau belum cukup konfirmasi, bot bilang *TUNGGU* - artinya jangan entry dulu, tunggu sinyal lebih jelas.\n",
      "Baris *Volume 1h* menunjukkan rasio volume jam terakhir dibanding rata-rata. \u2705 kalau \u22651.5x (ada minat beli/jual ekstra), \u26a0\ufe0f kalau di bawah itu (sinyal kurang didukung volume, lebih rawan palsu).\n",
      "*3) Support & Resistance (mingguan)*",
      "Muncul di bagian bawah /analisa. Ini BUKAN dari 5 timeframe di atas, tapi dari struktur candle mingguan 1 tahun terakhir - level harga yang sudah terbukti dipantulkan minimal 3x (support = lantai harga, resistance = atap harga).",
      "\ud83d\udd34 Resistance = harga di atas harga sekarang yang sering jadi batas atas",
      "\ud83d\udfe2 Support = harga di bawah harga sekarang yang sering jadi batas bawah",
      "Persentase di bawahnya = jarak dari harga sekarang. Semakin sering disentuh (Nx sentuh), semakin kuat level itu dianggap.\n",
      "*4) Level TP/SL (kalau sinyal BUY)*",
      "Entry, Stop Loss (ketat -3% / lebar -5%), dan Take Profit 1-3 (+5%/+10%/+15%) dari harga saat ini - referensi manajemen risiko, bukan patokan mutlak.\n",
      "*Apa itu Konteks Fibonacci?*",
      "Fibonacci menandai level harga di mana koreksi biasanya berhenti, dihitung dari swing high/low candle 1 jam terakhir. Fungsinya:",
      "1. Menilai entry: kalau harga sekarang dekat Fib 50%/61.8%, itu tandanya sudah koreksi cukup dalam - biasanya area beli lebih menarik",
      "2. Menilai TP: TP yang masih di bawah Swing High itu realistis (minta harga ulang rekor lama). TP di atas Swing High lebih ambisius (minta rekor baru)",
      "3. Alternatif SL: Fib 61.8% sering dipakai sebagai referensi teknikal - kalau harga break di bawah situ, banyak trader anggap tren naik sudah batal",
      "Fibonacci ini pelengkap penilaian, BUKAN opsi entry terpisah - entry tetap satu, di harga saat ini.\n",
      "*Link \"Lihat chart di Indodax\"*",
      "Ada di bagian atas hasil /analisa, langsung buka chart TradingView coin itu di Indodax buat verifikasi visual.\n",
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
