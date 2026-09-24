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
 * Bar visual 8-kotak buat skor EMA/RSI (0-8), contoh: 3 -> "▓▓▓░░░░░".
 * Dipakai buildAnalisaMessage biar skor gak cuma angka mentah "3/8".
 */
function scoreBar(score: number, total = 8): string {
  const filled = Math.max(0, Math.min(total, Math.round(score)));
  return "▓".repeat(filled) + "░".repeat(total - filled);
}

const SIGNAL_EMOJI: Record<MultiTimeframeSignal["signal"], string> = {
  BUY: "🟢",
  SELL: "🔴",
  TUNGGU: "🟡",
};

/**
 * Susun pesan balasan buat command /analisa <coin>.
 * Gabungin 3 sumber data (sinyal multi-timeframe, level TP/SL, hasil
 * scan radar) jadi satu pesan yang enak dibaca — emoji sinyal di judul
 * biar ketauan duluan sebelum baca detail, bar visual buat skor EMA/RSI,
 * dan alasan sinyal dikasih miring biar kebaca sebagai catatan, bukan
 * lanjutan data mentah.
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

  const lines = [
    `${signalEmoji} *Analisa ${safeSymbol}*`,
    `💰 ${formatRupiah(mtf.currentPrice)}`,
    ``,
    `*Sinyal: ${mtf.signal}*${mtf.confidence ? ` (keyakinan ${mtf.confidence})` : ""}`,
    `EMA     ${scoreBar(mtf.emaWeightedScore)}  ${mtf.emaWeightedScore}/8`,
    `RSI     ${scoreBar(mtf.rsiWeightedScore)}  ${mtf.rsiWeightedScore}/8`,
    `Volume 1h  ${mtf.volumeRatio1h.toFixed(1)}x${mtf.volumeConfirmed ? " ✅" : ""}`,
  ];

  if (coinScan) {
    lines.push(`🔍 Lolos scan radar — RSI ${coinScan.rsi.toFixed(1)}`);
  }

  lines.push(``, `_${escapeMarkdown(mtf.reason)}_`);

  const nearestSupport = srLevels?.support[0];
  const nearestResistance = srLevels?.resistance[0];
  if (nearestSupport || nearestResistance) {
    lines.push(``, `📍 *Support/Resistance* (mingguan)`);
    if (nearestSupport) {
      const jarak = ((mtf.currentPrice - nearestSupport.price) / mtf.currentPrice) * 100;
      lines.push(`Support     ${formatRupiah(nearestSupport.price)}  (${nearestSupport.touches}x sentuh, ${jarak.toFixed(1)}% di bawah)`);
    }
    if (nearestResistance) {
      const jarak = ((nearestResistance.price - mtf.currentPrice) / mtf.currentPrice) * 100;
      lines.push(`Resistance  ${formatRupiah(nearestResistance.price)}  (${nearestResistance.touches}x sentuh, ${jarak.toFixed(1)}% di atas)`);
    }
  }

  if (mtf.signal === "BUY") {
    lines.push(
      ``,
      `🎯 *Level TP/SL*`,
      `TP1  ${formatRupiah(levels.takeProfit1)}`,
      `TP2  ${formatRupiah(levels.takeProfit2)}`,
      `TP3  ${formatRupiah(levels.takeProfit3)}`,
      `SL ketat  ${formatRupiah(levels.stopLossTight)}`,
      `SL lebar  ${formatRupiah(levels.stopLossWide)}`
    );
  }

  return lines.join("\n");
}
