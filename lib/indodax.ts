// Ambil dan olah data dari API publik Indodax.
// Endpoint ini gratis, gak butuh API key, rate limit 180 request/menit.

const INDODAX_SUMMARIES_URL = "https://indodax.com/api/summaries";

// Bentuk satu entri ticker dari response /api/summaries.
// Semua field dari Indodax berupa string, jadi kita convert ke number
// pas dipakai buat sorting/perhitungan.
interface IndodaxTicker {
  high: string;
  low: string;
  vol_btc?: string;
  vol_idr: string;
  last: string;
  buy: string;
  sell: string;
  server_time: number;
  name?: string;
}

interface IndodaxSummariesResponse {
  tickers: Record<string, IndodaxTicker>;
  prices_24h?: Record<string, string>;
}

// Bentuk yang lebih enak dipakai di kode kita sendiri —
// pair_id sudah nempel di objeknya, angka sudah di-convert.
export interface TopCoin {
  pairId: string; // contoh: "btc_idr"
  symbol: string; // contoh: "BTC" (diambil dari pairId, huruf besar)
  lastPrice: number;
  buyPrice: number;
  sellPrice: number;
  volumeIdr: number;
}

/**
 * Panggil /api/summaries, urutkan berdasarkan volume 24 jam (vol_idr)
 * dari yang terbesar, dan kembalikan N teratas.
 *
 * Kenapa vol_idr, bukan vol_btc atau sejenisnya: vol_idr sudah dalam
 * satuan Rupiah untuk SEMUA pair, jadi bisa dibandingkan apple-to-apple
 * antar koin yang beda-beda. vol_btc/vol_eth/dst itu satuan koin itu
 * sendiri, gak bisa dibandingkan langsung antar pair berbeda.
 */
export async function getTopVolumeCoins(limit = 5): Promise<TopCoin[]> {
  const res = await fetch(INDODAX_SUMMARIES_URL, {
    // Next.js: jangan cache di level fetch, karena kita udah atur
    // frekuensi update lewat cron job di level yang lebih atas.
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(
      `Indodax API gagal merespons: ${res.status} ${res.statusText}`
    );
  }

  const data: IndodaxSummariesResponse = await res.json();

  const allTickers = Object.entries(data.tickers).map(([pairId, ticker]) => {
    // pairId formatnya "btc_idr" -> symbol "BTC".
    //
    // Kenapa gak pakai pairId.split("_")[0]: itu keliru untuk token
    // yang namanya sendiri mengandung underscore (mis. "some_token_idr"
    // akan salah jadi "SOME", bukan "SOME_TOKEN"). Karena semua pair
    // Indodax selalu diakhiri "_idr" (base currency selalu Rupiah),
    // yang benar adalah membuang suffix itu secara eksplisit, apa pun
    // isi bagian depannya.
    const symbol = pairId.endsWith("_idr")
      ? pairId.slice(0, -"_idr".length).toUpperCase()
      : pairId.toUpperCase(); // fallback jaga-jaga kalau ada pair non-IDR di masa depan

    return {
      pairId,
      symbol,
      lastPrice: Number(ticker.last),
      buyPrice: Number(ticker.buy),
      sellPrice: Number(ticker.sell),
      volumeIdr: Number(ticker.vol_idr),
    } satisfies TopCoin;
  });

  // Urutkan descending berdasarkan volume Rupiah, ambil N teratas.
  const sorted = allTickers
    .filter((t) => !Number.isNaN(t.volumeIdr)) // jaga-jaga kalau ada data korup
    .sort((a, b) => b.volumeIdr - a.volumeIdr);

  return sorted.slice(0, limit);
}
