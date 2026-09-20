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

export function formatPct(value: number, withSign = true): string {
  const sign = withSign && value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

export function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return "baru saja";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m lalu`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}j lalu`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}h lalu`;
}

/** Kategori RSI untuk pewarnaan — bukan cuma angka mentah. */
export function rsiZone(rsi: number): "deep" | "oversold" | "neutral" {
  if (rsi < 25) return "deep";
  if (rsi < 35) return "oversold";
  return "neutral";
}
