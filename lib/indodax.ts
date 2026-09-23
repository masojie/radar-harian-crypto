/**
 * Modul utama akses API Indodax — harga, volume, dan candle.
 *
 * Dua endpoint Indodax yang dipakai:
 * 1. /api/ticker_all   — ringan, balikan semua pair + volume 24 jam
 * 2. /api/tradingview/history  — data candle OHLCV untuk simulasi outcome
 *
 * Filter volume diterapkan di getTopVolumeCoins() supaya coin yang
 * masuk radar & notif Telegram hanyalah yang volume hariannya berada
 * di rentang yang diinginkan (sekarang 200–500 juta IDR).
 */

// ── Tipe data ──────────────────────────────────────────────

/** Satu coin hasil scan volume Indodax. */
export interface TopCoin {
  pairId: string;
  symbol: string;
  lastPrice: number;
  buyPrice: number;
  sellPrice: number;
  volumeIdr: number;
}

/** Satu candle OHLCV dari Indodax TradingView endpoint. */
export interface Candle {
  /** Unix timestamp detik — waktu buka candle. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Volume dalam satuan base asset (misal BTC, ETH). */
  volume: number;
}

// ── Konstanta filter volume ────────────────────────────────

/**
 * Volume harian MINIMUM dalam IDR supaya coin bisa masuk radar.
 * Saat ini: 200 juta Rupiah.
 */
export const VOLUME_MIN_IDR = 200_000_000;

/**
 * Volume harian MAKSIMUM dalam IDR supaya coin bisa masuk radar.
 * Saat ini: 500 juta Rupiah.
 *
 * Tujuan: menyaring coin dengan volume terlalu besar (whale /
 * market leader seperti BTC, ETH, USDT) yang mendominasi daftar
 * dan menutupi coin menengah yang lebih menarik untuk radar.
 */
export const VOLUME_MAX_IDR = 500_000_000;

/**
 * Timeout (ms) untuk fetch ke Indodax. Cukup longgar untuk jaringan
 * Indonesia tapi tidak bikin request hanging terlalu lama.
 */
const FETCH_TIMEOUT_MS = 10_000;

// ── Fungsi publik ───────────────────────────────────────────

/**
 * Ambil top N coin dari Indodax berdasarkan volume 24 jam,
 * dengan filter volume antara VOLUME_MIN_IDR dan VOLUME_MAX_IDR.
 *
 * Alur:
 * 1. Fetch /api/ticker_all (satu request ringan, ~100-300 KB).
 * 2. Filter hanya pair yang berakhiran _idr.
 * 3. Buang coin di bawah VOLUME_MIN_IDR atau di atas VOLUME_MAX_IDR.
 * 4. Urutkan berdasarkan volume tertinggi.
 * 5. Ambil top `limit`.
 *
 * @param limit — jumlah coin yang diambil (default 5).
 * @returns Array TopCoin terurut volume menurun.
 */
export async function getTopVolumeCoins(limit = 5): Promise<TopCoin[]> {
  const res = await fetch("https://indodax.com/api/ticker_all", {
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(
      `Gagal fetch ticker_all dari Indodax: ${res.status} ${res.statusText}`
    );
  }

  const json = (await res.json()) as {
    tickers?: Record<
      string,
      {
        high?: string;
        low?: string;
        vol_idr?: string;
        vol_btc?: string;
        last?: string;
        buy?: string;
        sell?: string;
        server_time?: number;
      }
    >;
  };

  const tickers = json.tickers ?? {};
  const candidates: {
    symbol: string;
    pairId: string;
    lastPrice: number;
    buyPrice: number;
    sellPrice: number;
    volumeIdr: number;
  }[] = [];

  for (const [pairId, t] of Object.entries(tickers)) {
    // Hanya pair IDR
    if (!pairId.endsWith("_idr")) continue;

    const volumeIdr = Number(t.vol_idr ?? "0");

    // ── Filter volume: 200–500 juta ──
    if (volumeIdr < VOLUME_MIN_IDR || volumeIdr > VOLUME_MAX_IDR) continue;

    const symbol = pairId.replace("_idr", "").toUpperCase();
    const lastPrice = Number(t.last ?? "0");
    const buyPrice = Number(t.buy ?? "0");
    const sellPrice = Number(t.sell ?? "0");

    // Harga harus valid (> 0) — skip coin tidak likuid
    if (lastPrice <= 0) continue;

    candidates.push({
      symbol,
      pairId,
      lastPrice,
      buyPrice,
      sellPrice,
      volumeIdr,
    });
  }

  // Urutkan volume tertinggi → terendah, ambil top `limit`
  candidates.sort((a, b) => b.volumeIdr - a.volumeIdr);
  return candidates.slice(0, limit);
}

/**
 * Ambil candle intraday dari Indodax (TradingView endpoint).
 *
 * Dipakai oleh lib/outcome.ts untuk simulasi TP/SL — cek apakah
 * harga menyentuh level tertentu dalam rentang candle 5 menit.
 *
 * Endpoint: https://indodax.com/api/tradingview/history
 *
 * @param pair — simbol pair, contoh "BTCIDR".
 * @param timeframe — resolusi candle: "5", "15", "60", "1D", dll.
 * @param count — jumlah candle yang diminta (maks praktis ~2000).
 * @param to — timestamp detik akhir (default: sekarang).
 * @returns Array Candle terurut waktu menaik.
 */
export async function getIntradayCandles(
  pair: string,
  timeframe: string,
  count: number,
  to?: number
): Promise<Candle[]> {
  const toSec = to ?? Math.floor(Date.now() / 1000);

  // Indodax TV endpoint — "from" dihitung mundur dari "to"
  // URL hanya mendukung "from" dan "to"; tidak ada parameter limit/count.
  // Kita estimasi "from" berdasarkan count * detik per candle + buffer 20%.
  const tfSeconds =
    timeframe === "5" ? 300
    : timeframe === "15" ? 900
    : timeframe === "30" ? 1800
    : timeframe === "60" ? 3600
    : timeframe === "120" ? 7200
    : timeframe === "240" ? 14400
    : timeframe === "1D" ? 86400
    : timeframe === "1W" ? 604800
    : 300; // fallback: 5 menit

  const estimatedSpan = count * tfSeconds;
  const fromSec = toSec - Math.ceil(estimatedSpan * 1.2);

  const url =
    `https://indodax.com/api/tradingview/history` +
    `?symbol=${encodeURIComponent(pair)}` +
    `&resolution=${encodeURIComponent(timeframe)}` +
    `&from=${fromSec}` +
    `&to=${toSec}`;

  const res = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(
      `Gagal fetch candle ${pair}: ${res.status} ${res.statusText}`
    );
  }

  const json = (await res.json()) as {
    s?: string;     // status: "ok" atau "no_data"
    t?: number[];   // array timestamp detik
    o?: number[];   // open
    h?: number[];   // high
    l?: number[];   // low
    c?: number[];   // close
    v?: number[];   // volume
  };

  if (json.s === "no_data" || !json.t || json.t.length === 0) {
    return [];
  }

  const candles: Candle[] = [];
  const len = json.t.length;

  for (let i = 0; i < len; i++) {
    candles.push({
      time: json.t[i],
      open: json.o?.[i] ?? 0,
      high: json.h?.[i] ?? 0,
      low: json.l?.[i] ?? 0,
      close: json.c?.[i] ?? 0,
      volume: json.v?.[i] ?? 0,
    });
  }

  return candles;
}
