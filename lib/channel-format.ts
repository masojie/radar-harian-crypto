import type { TopCoin } from "./indodax";
import { formatRupiah, formatVolumeSingkat } from "./format";

/**
 * Formatter pesan CHANNEL Telegram (radar harian + scan-notify).
 *
 * Harga dan volume diteruskan ke lib/format.ts, jadi channel, bot, dan
 * dashboard memakai aturan tampilan yang sama.
 */

/**
 * Harga untuk pesan channel. Dulu implementasinya terpisah dari bot, dan
 * perbaikan koin murah ("Rp 0") hanya masuk channel, jadi bot dan channel
 * beda tampilan. Sekarang meneruskan ke lib/format.ts: desimal adaptif (mulai
 * Rp1.000 tanpa desimal, di bawah itu sampai 4 desimal).
 */
export function formatChannelPrice(value: number): string {
  return formatRupiah(value);
}

/**
 * Persen bertanda untuk pesan channel. Nilai bulat tampil ringkas ("-5%"),
 * nilai lain 1 desimal dengan koma ("-4,7%").
 */
export function formatChannelPct(p: number): string {
  const rounded = Math.round(p * 10) / 10;
  const abs = Math.abs(rounded);
  const text = Number.isInteger(abs) ? String(abs) : abs.toFixed(1).replace(".", ",");
  return `${rounded < 0 ? "-" : "+"}${text}%`;
}

/**
 * Volume singkat untuk pesan channel, desimal berkoma ("Rp25,0 M"). Meneruskan
 * ke lib/format.ts supaya sama dengan balasan bot.
 */
export function formatChannelVolume(value: number): string {
  return formatVolumeSingkat(value);
}

// Escape karakter spesial Telegram Markdown (legacy): _ * ` [
function escapeMarkdown(text: string): string {
  return text.replace(/([_*`[])/g, "\\$1");
}

/**
 * Pesan radar harian untuk channel. Isi dan susunannya sama dengan
 * buildRadarMessage di lib/format.ts, bedanya hanya format harga dan volume.
 */
export function buildChannelRadarMessage(coins: TopCoin[]): string {
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
      `   Harga: ${formatChannelPrice(coin.lastPrice)}\n` +
      `   Volume 24 Jam: ${formatChannelVolume(coin.volumeIdr)}`
    );
  });

  return (
    `🔥 *RADAR HARIAN CRYPTO*\n` +
    `Top ${coins.length} Volume Indodax\n\n` +
    `🕐 ${waktuJakarta} WIB\n\n` +
    lines.join("\n\n") +
    `\n\n_Data: Indodax API, diurutkan berdasarkan volume transaksi 24 jam._\n\n` +
    `⚡ RadarView — [pantau live di sini](https://radar-harian-crypto.vercel.app/)`
  );
}
