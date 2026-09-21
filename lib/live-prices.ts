/**
 * Harga live spot Indodax untuk tab Posisi Aktif.
 *
 * Sebelumnya harga diambil dari baris terakhir bullish_scans. Tabel itu
 * hanya terisi saat ada coin RSI < 35, jadi harga sebuah coin bisa basi
 * belasan jam dan angka "berjalan" di dashboard jadi bohong. Endpoint ini
 * publik, gratis, dan dipakai juga oleh bot (lib/indodax.ts).
 *
 * Kalau Indodax gagal dijawab, kembalikan map kosong. Pemanggil harus
 * menampilkan "-" (bukan angka lama yang menyesatkan).
 */
export interface LivePrices {
  prices: Map<string, number>;
  /** Waktu server Indodax (ms), null kalau gagal. */
  fetchedAt: number | null;
}

export async function getLivePrices(symbols: string[]): Promise<LivePrices> {
  const prices = new Map<string, number>();
  if (symbols.length === 0) return { prices, fetchedAt: null };

  try {
    const res = await fetch("https://indodax.com/api/ticker_all", {
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return { prices, fetchedAt: null };

    const json = (await res.json()) as {
      tickers?: Record<string, { last?: string; server_time?: number }>;
    };
    const tickers = json.tickers ?? {};
    let serverTime: number | null = null;

    for (const symbol of symbols) {
      const t = tickers[`${symbol.toLowerCase()}_idr`];
      const last = t?.last !== undefined ? Number(t.last) : NaN;
      if (Number.isFinite(last) && last > 0) {
        prices.set(symbol, last);
        if (typeof t?.server_time === "number") serverTime = t.server_time * 1000;
      }
    }
    return { prices, fetchedAt: serverTime };
  } catch {
    return { prices, fetchedAt: null };
  }
}
