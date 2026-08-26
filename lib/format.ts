import type { TopCoin } from "./indodax";

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
