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

// Bentuk yang lebih enak dipakai di kode kita sendiri -
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
    // frekuen|nsi update lewat cron job di level yang lebih atas.
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

/**
 * Ambil harga satu coin spesifik berdasarkan simbolnya (mis. "btc", "BTC",
 * "sol"). Dipakai buat command /harga <coin> di webhook Telegram.
 *
 * Balikin null kalau simbolnya gak ketemu di daftar pair Indodax, biar
 * pemanggil bisa kasih pesan "coin tidak ditemukan" yang jelas ke user,
 * bukan error teknis yang bikin bingung.
 */
export async function getCoinPrice(symbol: string): Promise<TopCoin | null> {
  const res = await fetch(INDODAX_SUMMARIES_URL, {
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(
      `Indodax API gagal merespons: ${res.status} ${res.statusText}`
    );
  }

  const data: IndodaxSummariesResponse = await res.json();

  const normalizedSymbol = symbol.trim().toLowerCase();
  const pairId = `${normalizedSymbol}_idr`;

  const ticker = data.tickers[pairId];
  if (!ticker) {
    return null;
  }

  return {
    pairId,
    symbol: normalizedSymbol.toUpperCase(),
    lastPrice: Number(ticker.last),
    buyPrice: Number(ticker.buy),
    sellPrice: Number(ticker.sell),
    volumeIdr: Number(ticker.vol_idr),
  } satisfies TopCoin;
}
// ============================================================
// TAMBAHAN UNTUK lib/indodax.ts
// Copy-paste kode di bawah ini ke BAGIAN PALING BAWAH file
// lib/indodax.ts yang sudah ada. Jangan hapus kode yang lama.
// ============================================================

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Ambil data candle OHLC harian dari Indodax lewat endpoint
 * tradingview/history_v2. Endpoint ini publik, gratis, tanpa API key.
 *
 * @param pairSymbol - format Indodax, contoh: "BTCIDR", "ETHIDR", "SOLIDR"
 * @param days - berapa hari ke belakang yang mau diambil (default 90,
 *               cukup untuk hitung EMA50 dengan buffer)
 */
export async function getDailyCandles(
  pairSymbol: string,
  days = 90
): Promise<Candle[]> {
  const to = Math.floor(Date.now() / 1000);
  const from = to - days * 24 * 60 * 60;

  const url = `https://indodax.com/tradingview/history_v2?from=${from}&to=${to}&tf=1D&symbol=${pairSymbol.toUpperCase()}`;

  const res = await fetch(url, { cache: "no-store" });

  if (!res.ok) {
    throw new Error(
      `Indodax history API gagal merespons: ${res.status} ${res.statusText}`
    );
  }

  const raw: Array<{
    Time: number;
    Open: number;
    High: number;
    Low: number;
    Close: number;
    Volume: string;
  }> = await res.json();

  return raw.map((c) => ({
    time: c.Time,
    open: c.Open,
    high: c.High,
    low: c.Low,
    close: c.Close,
    volume: Number(c.Volume),
  }));
}

/**
 * Hitung EMA (Exponential Moving Average) dari array harga close.
 * Mengembalikan array EMA yang sepanjang input, dengan nilai awal
 * (sebelum cukup data) diisi menggunakan SMA sebagai seed.
 */
export function calculateEMA(closes: number[], period: number): numbe