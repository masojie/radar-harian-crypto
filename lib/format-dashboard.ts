/**
 * Helper tampilan untuk dashboard. Semua angka memakai locale id-ID
 * (titik ribuan, koma desimal) supaya konsisten dengan harga Rupiah.
 */

export const RSI_DEEP = 25;
export const RSI_OVERSOLD = 35;

export function formatIDR(value: number): string {
  if (value >= 1000) {
    return new Intl.NumberFormat("id-ID", {
      maximumFractionDigits: 0,
    }).format(value);
  }
  // Coin harga kecil (di bawah Rp1.000) butuh desimal biar bedanya kelihatan
  return new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: 4,
  }).format(value);
}

/** Angka polos dengan jumlah desimal tetap, contoh: 27.83 -> "27,8". */
export function formatNumber(value: number, digits = 1): string {
  return new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatRsi(rsi: number): string {
  return formatNumber(rsi, 1);
}

/**
 * Persen dengan koma desimal. Nilai yang membulat ke nol tidak diberi tanda,
 * jadi tidak pernah muncul "-0,00%" berwarna merah.
 */
export function formatPct(value: number, withSign = true): string {
  const rounded = Math.round(value * 100) / 100;
  const abs = formatNumber(Math.abs(rounded), 2);
  if (rounded === 0) return `${abs}%`;
  if (rounded < 0) return `-${abs}%`;
  return `${withSign ? "+" : ""}${abs}%`;
}

export type Tone = "up" | "down" | "flat";

export function pctTone(value: number | null): Tone {
  if (value === null) return "flat";
  const rounded = Math.round(value * 100) / 100;
  if (rounded > 0) return "up";
  if (rounded < 0) return "down";
  return "flat";
}

/** Selisih persen dari satu harga ke harga lain. */
export function distancePct(from: number, to: number): number {
  return from > 0 ? ((to - from) / from) * 100 : 0;
}

/** Durasi ringkas dari milidetik: "25m", "2j 5m", "3h". */
export function formatSpan(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60_000));
  if (totalMin < 1) return "kurang dari 1m";
  if (totalMin < 60) return `${totalMin}m`;
  const hours = Math.floor(totalMin / 60);
  if (hours < 24) {
    const minutes = totalMin % 60;
    return minutes === 0 ? `${hours}j` : `${hours}j ${minutes}m`;
  }
  return `${Math.floor(hours / 24)}h`;
}

/** Berapa lama sejak waktu tertentu, tanpa kata "lalu": "32m", "8j", "2h". */
export function elapsedShort(iso: string): string {
  const diffSec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diffSec < 60) return "baru saja";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}j`;
  return `${Math.floor(diffHour / 24)}h`;
}

export function timeAgo(iso: string): string {
  const short = elapsedShort(iso);
  return short === "baru saja" ? short : `${short} lalu`;
}

/** Jam absolut WIB, contoh: "06.07 WIB". Dipakai sebagai keterangan tambahan. */
export function formatClock(iso: string): string {
  const time = new Date(iso).toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  });
  return `${time} WIB`;
}

export type RsiZone = "deep" | "oversold" | "neutral";

/** Kategori RSI untuk pewarnaan, bukan cuma angka mentah. */
export function rsiZone(rsi: number): RsiZone {
  if (rsi < RSI_DEEP) return "deep";
  if (rsi < RSI_OVERSOLD) return "oversold";
  return "neutral";
}

export function rsiZoneLabel(zone: RsiZone): string {
  if (zone === "deep") return "Sangat jenuh jual";
  if (zone === "oversold") return "Jenuh jual";
  return "Netral";
}
