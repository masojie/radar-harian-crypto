import type { TopCoin, MultiTimeframeSignal, SpotPositionLevels, ScanResult, PriceLevel } from "./indodax";

/**
 * Escape karakter yang punya makna spesial di Telegram Markdown (legacy mode),
 * biar data dari luar (symbol koin) gak pernah bisa merusak format pesan
 * atau bikin Telegram nolak seluruh pesan karena entity gak valid.
 *
 * Karakter yang perlu di-escape di mode "Markdown" (bukan MarkdownV2):
 * _ * ` [
 * Referensi: https://core.telegram.org/bots/api#markdown-style
 */
function escapeMarkdown(text: string): string {
  return text.replace(/([_*`[])/g, "\\$1");
}

/**
 * Format angka jadi Rupiah yang gampang dibaca, contoh: 117136000 -> "Rp117.136.000"
 */
export function formatRupiah(value: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Format volume gede jadi lebih ringkas buat dibaca di HP, contoh:
 * 25831203178 -> "Rp25,8 M" (miliar)
 */
export function formatVolumeSingkat(value: number): string {
  if (value >= 1_000_000_000_000) {
    return `Rp${(value / 1_000_000_000_000).toFixed(1)} T`;
  }
  if (value >= 1_000_000_000) {
    return `Rp${(value / 1_000_000_000).toFixed(1)} M`;
  }
  if (value >= 1_000_000) {
    return `Rp${(value / 1_000_000).toFixed(1)} Jt`;
  }
  return formatRupiah(value);
}

/**
 * Susun teks pesan buat dikirim ke Telegram, format Markdown.
 * Dipisah dari logic Telegram-nya sendiri biar gampang diubah
 * tampilannya tanpa nyentuh kode pengiriman.
 */
export function buildRadarMessage(coins: TopCoin[]): string {
  const now = new Date();
  const waktuJakarta = now.toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    dateStyle: "medium",
    timeStyle: "short",
  });

  const lines = coins.map((coin, index) => {
    const rank = index + 1;
    const safeSymbol = escapeMarkdown(coin.symbol);
    return (
      `${rank}. *${safeSymbol}*\n` +
      `   Harga: ${formatRupiah(coin.lastPrice)}\n` +
      `   Volume 24 Jam: ${formatVolumeSingkat(coin.volumeIdr)}`
    );
  });

  return (
    `📡 *Radar Harian Crypto — Top ${coins.length} Volume Indodax*\n` +
    `🕐 ${waktuJakarta} WIB\n\n` +
    lines.join("\n\n") +
    `\n\n_Data: Indodax API, diurutkan berdasarkan volume transaksi 24 jam._`
  );
}


/**
 * Susun pesan balasan buat command /harga <coin>.
 * Dipakai webhook, jadi harus tetap enak dibaca meskipun cuma satu coin
 * (beda dari buildRadarMessage yang emang buat daftar top N).
 */
export function buildCoinPriceMessage(coin: TopCoin): string {
  const now = new Date();
  const waktuJakarta = now.toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    `💰 *${coin.symbol}*\n` +
    `🕐 ${waktuJakarta} WIB\n\n` +
    `Harga: ${formatRupiah(coin.lastPrice)}\n` +
    `Beli: ${formatRupiah(coin.buyPrice)}\n` +
    `Jual: ${formatRupiah(coin.sellPrice)}\n` +
    `Volume 24 Jam: ${formatVolumeSingkat(coin.volumeIdr)}`
  );
}


/**
 * Bar dua warna 8-kotak buat skor bullish vs bearish (bobot total 8):
 * hijau = bobot bullish, merah = sisanya (bearish). Contoh 3 -> "🟩🟩🟩🟥🟥🟥🟥🟥".
 *
 * Sengaja emoji kotak, bukan karakter blok "▓░": font Telegram merender
 * blok itu jadi pola titik yang kontrasnya lemah (8/8 dan 0/8 susah
 * dibedakan sekilas). Emoji kotak jelas di tema gelap maupun terang, dan
 * dua warna langsung nunjukin skor "8 vs 0" yang ada di teks alasan.
 */
function dualBar(bullishScore: number, total = 8): string {
  const green = Math.max(0, Math.min(total, Math.round(bullishScore)));
  return "🟩".repeat(green) + "🟥".repeat(total - green);
}

const SIGNAL_EMOJI: Record<MultiTimeframeSignal["signal"], string> = {
  BUY: "🟢",
  SELL: "🔴",
  TUNGGU: "🟡",
};

/** RSI ke teks 1 desimal; "-" kalau belum valid (candle kurang -> NaN). */
function formatRsi(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : "-";
}

/** Selisih persen dari harga acuan ke target, dengan tanda. Contoh: "+5%" / "-3%". */
function signedPercent(from: number, to: number, digits: number): string {
  if (!(from > 0)) return "";
  const pct = ((to - from) / from) * 100;
  return `${pct >= 0 ? "+" : "-"}${Math.abs(pct).toFixed(digits)}%`;
}

/** Keterangan satu level S/R: jarak dari harga sekarang + berapa kali disentuh. */
function levelNote(currentPrice: number, level: PriceLevel): string {
  return [signedPercent(currentPrice, level.price, 1), `${level.touches}x sentuh`]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Tabel per-timeframe (1m/5m/15m/30m/1h) dalam blok kode biar kolomnya
 * rata. Isinya ASCII saja — di blok monospace, emoji/simbol lebar bikin
 * kolom geser. Data ini sebelumnya sudah dihitung analyzeMultiTimeframe()
 * tapi cuma tampil sebagai skor gabungan.
 */
function timeframeTable(votes: MultiTimeframeSignal["votes"]): string {
  const header = `${"TF".padEnd(4)}${"EMA".padEnd(7)}${"RSI".padStart(5)}`;
  const rows = votes.map(
    (v) =>
      `${v.label.padEnd(4)}${(v.emaBullish ? "naik" : "turun").padEnd(7)}${formatRsi(v.rsiValue).padStart(5)}`
  );
  return ["```", header, ...rows, "```"].join("\n");
}

/**
 * Blok Entry + TP/SL (blok kode, kolom rata). Persen dihitung dari harga
 * entry: TP dan SL di sini persentase tetap (+5/+10/+15%, -3/-5%), BUKAN
 * level resistance/support dari chart — persennya sengaja ditampilkan
 * biar itu keliatan jelas.
 */
function levelsBlock(levels: SpotPositionLevels): string {
  const entry = levels.entry;
  const rows: Array<[string, string, string]> = [
    ["Entry", formatRupiah(entry), ""],
    ["TP1", formatRupiah(levels.takeProfit1), signedPercent(entry, levels.takeProfit1, 0)],
    ["TP2", formatRupiah(levels.takeProfit2), signedPercent(entry, levels.takeProfit2, 0)],
    ["TP3", formatRupiah(levels.takeProfit3), signedPercent(entry, levels.takeProfit3, 0)],
    ["SL ketat", formatRupiah(levels.stopLossTight), signedPercent(entry, levels.stopLossTight, 0)],
    ["SL lebar", formatRupiah(levels.stopLossWide), signedPercent(entry, levels.stopLossWide, 0)],
  ];
  const priceWidth = Math.max(...rows.map((r) => r[1].length));
  const body = rows.map(([label, price, pct]) =>
    `${label.padEnd(9)}${price.padStart(priceWidth)}  ${pct.padStart(4)}`.trimEnd()
  );
  return ["```", ...body, "```"].join("\n");
}

/**
 * Susun pesan balasan buat command /analisa <coin>.
 * Gabungin 3 sumber data (sinyal multi-timeframe, level TP/SL, hasil
 * scan radar) jadi satu kartu: verdict + coin + harga di baris pertama,
 * dua bar warna (EMA/RSI) yang nunjukin kenapa sinyalnya begitu, tabel
 * per-timeframe, alasan sinyal (miring), tangga support/resistance
 * mingguan, dan blok TP/SL kalau sinyalnya BUY.
 *
 * Parse mode Telegram-nya Markdown legacy: entity gak boleh nested, dan
 * escape di dalam entity gak didukung. Makanya teks dinamis (symbol,
 * alasan) di-escape lewat escapeMarkdown dan angka/simbol lain dijaga
 * bebas dari karakter _ * ` [.
 */
export function buildAnalisaMessage(
  symbol: string,
  mtf: MultiTimeframeSignal,
  levels: SpotPositionLevels,
  coinScan?: ScanResult,
  srLevels?: { support: PriceLevel[]; resistance: PriceLevel[] }
): string {
  const safeSymbol = escapeMarkdown(symbol);
  const signalEmoji = SIGNAL_EMOJI[mtf.signal];
  const confidence = mtf.confidence ? ` · keyakinan ${mtf.confidence}` : "";

  const lines = [
    `${signalEmoji} *${safeSymbol}* — *${mtf.signal}*${confidence}`,
    `💰 ${formatRupiah(mtf.currentPrice)}`,
    ``,
    `*EMA*  ${dualBar(mtf.emaWeightedScore)}  *${mtf.emaWeightedScore}/8*`,
    `*RSI*  ${dualBar(mtf.rsiWeightedScore)}  *${mtf.rsiWeightedScore}/8*`,
    `*Volume 1h*  ${mtf.volumeRatio1h.toFixed(1)}x ${mtf.volumeConfirmed ? "✅" : "⚠️"}`,
  ];

  if (coinScan) {
    lines.push(`🔍 Lolos scan radar — RSI ${coinScan.rsi.toFixed(1)}`);
  }

  if (mtf.votes.length > 0) {
    lines.push(``, `🕒 *Per timeframe*`, timeframeTable(mtf.votes));
  }

  lines.push(``, `💬 _${escapeMarkdown(mtf.reason)}_`);

  // Tangga level mingguan: resistance di atas, support di bawah (urutan
  // kayak di chart). Baris jarak dipisah biar baris utama gak wrap di HP
  // waktu harganya panjang (contoh Rp355.021).
  const nearestSupport = srLevels?.support[0];
  const nearestResistance = srLevels?.resistance[0];
  if (nearestSupport || nearestResistance) {
    lines.push(``, `📍 *Support & Resistance* (mingguan)`);
    if (nearestResistance) {
      lines.push(
        `🔴 Resistance  ${formatRupiah(nearestResistance.price)}`,
        `      _${levelNote(mtf.currentPrice, nearestResistance)}_`
      );
    }
    if (nearestSupport) {
      lines.push(
        `🟢 Support  ${formatRupiah(nearestSupport.price)}`,
        `      _${levelNote(mtf.currentPrice, nearestSupport)}_`
      );
    }
  }

  if (mtf.signal === "BUY") {
    lines.push(``, `🎯 *Level TP/SL*`, levelsBlock(levels));
  }

  lines.push(``, `_🟩 EMA naik / RSI oversold · 🟥 sebaliknya_`);

  return lines.join("\n");
}
