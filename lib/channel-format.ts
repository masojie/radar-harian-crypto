import type { TopCoin } from "./indodax";

/**
 * Formatter khusus pesan CHANNEL Telegram (radar harian + scan-notify).
 *
 * Sengaja dipisah dari lib/format.ts, karena file itu juga dipakai bot/webhook
 * (balasan command). Perbaikan tampilan di sisi channel di sini tidak mengubah
 * balasan bot sama sekali.
 */

/**
 * Harga Rupiah untuk pesan channel dengan desimal adaptif, aturan sama dengan
 * dashboard (formatIDR): mulai Rp1.000 tanpa desimal (tampilan persis seperti
 * sebelumnya), di bawah itu sampai 4 desimal.
 *
 * Kenapa: sebelumnya pesan channel selalu maximumFractionDigits: 0. Koin murah
 * (SHIB, BONK, BTRNEW: sekitar Rp0,06 sampai Rp0,11) tampil "Rp 0", dan
 * TP1/TP2 koin di bawah sekitar Rp100 ikut kebulat sehingga persen yang
 * terlihat meleset dari yang benar-benar dilacak.
 */
export function formatChannelPrice(value: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    // Dikunci eksplisit: default digit IDR bergantung versi ICU/Node (ICU lama
    // bisa memaksa ",00"), jadi jangan diandalkan.
    minimumFractionDigits: 0,
    maximumFractionDigits: value >= 1000 ? 0 : 4,
  }).format(value);
}

/**
 * Volume singkat untuk pesan channel. Satuan dan ambangnya sama dengan
 * formatVolumeSingkat di lib/format.ts (yang juga dipakai bot, jadi tidak
 * diubah), bedanya desimal pakai koma sesuai format Indonesia: "Rp25,0 M",
 * bukan "Rp25.0 M". Di format Indonesia titik itu pemisah ribuan, jadi
 * "25.0" mudah terbaca salah dan tidak konsisten dengan harga di pesan yang sama.
 */
export function formatChannelVolume(value: number): string {
  const satuan = (n: number) => n.toFixed(1).replace(".", ",");
  if (value >= 1_000_000_000_000) return `Rp${satuan(value / 1_000_000_000_000)} T`;
  if (value >= 1_000_000_000) return `Rp${satuan(value / 1_000_000_000)} M`;
  if (value >= 1_000_000) return `Rp${satuan(value / 1_000_000)} Jt`;
  return formatChannelPrice(value);
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
