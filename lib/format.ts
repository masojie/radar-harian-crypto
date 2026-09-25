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


const SIGNAL_EMOJI: Record<MultiTimeframeSignal["signal"], string> = {
  BUY: "🟢",
  SELL: "🔴",
  TUNGGU: "🟡",
};

/**
 * Format angka desimal gaya Indonesia (koma, bukan titik), contoh: 58.4 -> "58,4".
 */
function idNum(value: number, digits = 1): string {
  return value.toLocaleString("id-ID", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/**
 * Bar ASCII buat skor (dari total 8), contoh 6 -> "▬▬▬▬▬▬░░".
 * Dipakai di dalam satu blok kode gede, jadi sengaja karakter ASCII biasa
 * (bukan emoji kotak) supaya lebar kolomnya rata di font monospace.
 */
function asciiBar(score: number, total = 8): string {
  const filled = Math.max(0, Math.min(total, Math.round(score)));
  return "▬".repeat(filled) + "░".repeat(total - filled);
}

/** Label kata dari skor 0-8, biar gak cuma angka doang buat orang awam. */
function scoreLabel(score: number, total = 8): string {
  if (score >= total * 0.75) return "kuat";
  if (score <= total * 0.25) return "lemah";
  return "netral";
}

/** RSI ke teks 1 desimal (gaya Indonesia); "-" kalau belum valid (candle kurang -> NaN). */
function formatRsi(value: number): string {
  return Number.isFinite(value) ? idNum(value, 1) : "-";
}

/** Selisih persen dari harga acuan ke target, dengan tanda. Contoh: "+5%" / "-3%". */
function signedPercent(from: number, to: number, digits: number): string {
  if (!(from > 0)) return "";
  const pct = ((to - from) / from) * 100;
  return `${pct >= 0 ? "+" : "-"}${idNum(Math.abs(pct), digits)}%`;
}

/** Keterangan satu level S/R: jarak dari harga sekarang + berapa kali level itu tertahan. */
function levelNote(currentPrice: number, level: PriceLevel): string {
  return [signedPercent(currentPrice, level.price, 1), `${level.touches}x tertahan`]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Susun pesan balasan buat command /analisa <coin>.
 * Seluruh kartu jadi satu blok kode (monospace): garis pohon (├ └) buat
 * ngelompokin data, bar ASCII buat skor, dan kalimat alasan sinyal apa
 * adanya — bukan cuma istilah teknis. Chart-nya sekarang tombol inline
 * terpisah (lihat app/api/webhook/route.ts), bukan link di teks.
 *
 * Karena semuanya di dalam satu blok ``` , Telegram gak parse entity
 * apapun di isinya — makanya symbol/alasan gak perlu (dan gak boleh)
 * di-escapeMarkdown lagi di sini, beda dari tampilan sebelum blok-kode ini.
 */
export function buildAnalisaMessage(
  symbol: string,
  mtf: MultiTimeframeSignal,
  levels: SpotPositionLevels,
  coinScan?: ScanResult,
  srLevels?: { support: PriceLevel[]; resistance: PriceLevel[] }
): string {
  const waktuJakarta = new Date().toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    dateStyle: "medium",
    timeStyle: "short",
  });

  const lines = [
    symbol,
    `${formatRupiah(mtf.currentPrice)} · ${SIGNAL_EMOJI[mtf.signal]} ${mtf.signal}${mtf.confidence ? ` · keyakinan ${mtf.confidence}` : ""}`,
    ``,
    mtf.reason,
    ``,
    `Skor`,
    `├ EMA      ${asciiBar(mtf.emaWeightedScore)} ${mtf.emaWeightedScore}/8  ${scoreLabel(mtf.emaWeightedScore)}`,
    `├ RSI      ${asciiBar(mtf.rsiWeightedScore)} ${mtf.rsiWeightedScore}/8  ${scoreLabel(mtf.rsiWeightedScore)}`,
    `└ Volume   ${idNum(mtf.volumeRatio1h, 1)}x ${mtf.volumeConfirmed ? "✅" : "⚠️"}  ${mtf.volumeConfirmed ? "ramai" : "sepi"}`,
  ];

  if (coinScan) {
    lines.push(``, `Lolos scan radar — RSI ${idNum(coinScan.rsi, 1)}`);
  }

  if (mtf.votes.length > 0) {
    lines.push(``, `Per timeframe`);
    mtf.votes.forEach((v, i) => {
      const branch = i === mtf.votes.length - 1 ? "└" : "├";
      lines.push(`${branch} ${v.label.padEnd(4)} ${(v.emaBullish ? "naik " : "turun")} ${formatRsi(v.rsiValue).padStart(5)}`);
    });
  }

  const nearestSupport = srLevels?.support[0];
  const nearestResistance = srLevels?.resistance[0];
  if (nearestSupport || nearestResistance) {
    const srRows: string[] = [];
    if (nearestResistance) {
      srRows.push(`Atas   ${formatRupiah(nearestResistance.price)} · ${levelNote(mtf.currentPrice, nearestResistance)}`);
    }
    if (nearestSupport) {
      srRows.push(`Bawah  ${formatRupiah(nearestSupport.price)} · ${levelNote(mtf.currentPrice, nearestSupport)}`);
    }
    lines.push(``, `Level mingguan`);
    srRows.forEach((row, i) => {
      lines.push(`${i === srRows.length - 1 ? "└" : "├"} ${row}`);
    });
  }

  if (mtf.signal === "BUY") {
    lines.push(
      ``,
      `Level TP/SL`,
      `├ Entry           ${formatRupiah(levels.entry)}`,
      `├ TP1/2/3         ${signedPercent(levels.entry, levels.takeProfit1, 0)} / ${signedPercent(levels.entry, levels.takeProfit2, 0)} / ${signedPercent(levels.entry, levels.takeProfit3, 0)}`,
      `└ SL ketat/lebar  ${signedPercent(levels.entry, levels.stopLossTight, 0)} / ${signedPercent(levels.entry, levels.stopLossWide, 0)}`
    );
  }

  lines.push(``, `data Indodax ${waktuJakarta} WIB`);

  return "```\n" + lines.join("\n") + "\n```";
}
