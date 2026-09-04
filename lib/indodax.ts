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
export function calculateEMA(closes: number[], period: number): number[] {
  const ema: number[] = [];
  const multiplier = 2 / (period + 1);

  // Seed pertama pakai SMA dari 'period' candle pertama
  const seedSma =
    closes.slice(0, period).reduce((sum, v) => sum + v, 0) / period;

  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      ema.push(NaN); // belum cukup data
    } else if (i === period - 1) {
      ema.push(seedSma);
    } else {
      const prevEma = ema[i - 1];
      ema.push((closes[i] - prevEma) * multiplier + prevEma);
    }
  }

  return ema;
}

/**
 * Hitung RSI (Relative Strength Index) dengan metode Wilder's smoothing,
 * standar yang dipakai kebanyakan platform charting (termasuk TradingView).
 */
export function calculateRSI(closes: number[], period = 14): number[] {
  const rsi: number[] = new Array(closes.length).fill(NaN);
  if (closes.length < period + 1) return rsi;

  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) avgGain += change;
    else avgLoss -= change;
  }
  avgGain /= period;
  avgLoss /= period;

  rsi[period] =
    avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return rsi;
}

/**
 * Hitung MACD standar (12, 26, 9): garis MACD, garis signal, dan histogram.
 */
export function calculateMACD(closes: number[]) {
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);

  const macdLine = closes.map((_, i) =>
    isNaN(ema12[i]) || isNaN(ema26[i]) ? NaN : ema12[i] - ema26[i]
  );

  // Signal line = EMA9 dari macdLine, tapi hanya dari titik yang valid
  const validMacd = macdLine.filter((v) => !isNaN(v));
  const signalRaw = calculateEMA(validMacd, 9);

  // Map balik signal ke index asli
  const signalLine: number[] = new Array(closes.length).fill(NaN);
  let validIdx = 0;
  for (let i = 0; i < closes.length; i++) {
    if (!isNaN(macdLine[i])) {
      signalLine[i] = signalRaw[validIdx];
      validIdx++;
    }
  }

  const histogram = closes.map((_, i) =>
    isNaN(macdLine[i]) || isNaN(signalLine[i])
      ? NaN
      : macdLine[i] - signalLine[i]
  );

  return { macdLine, signalLine, histogram };
}

export interface SwingAnalysis {
  symbol: string;
  lastClose: number;
  ema20: number;
  ema50: number;
  rsi14: number;
  macdLine: number;
  macdSignal: number;
  macdHistogram: number;
  trend: "bullish" | "bearish" | "netral";
  rsiCondition: "overbought" | "oversold" | "netral";
  // Field baru: deteksi candle hari ini yang belum closed sedang
  // bergerak jeuh dari indikator yang dihitung dari candle-candle
  // yang sudah closed. Ini menutup celah di mana crash/pump
  // mendadak hari ini belum sempat terbaca RSI/EMA (yang masih
  // dihitung dari histori "kemarin dan sebelumnya").
  intradayChangePercent: number;
  intradayWarning: boolean;
}

/**
 * Analisis swing lengkap untuk satu pair: ambil candle, hitung semua
 * indikator, dan simpulkan kondisi tren + momentum saat ini.
 */
export async function analyzeSwing(
  pairSymbol: string
): Promise<SwingAnalysis> {
  const candles = await getDailyCandles(pairSymbol, 90);

  if (candles.length === 0) {
    throw new Error(`Tidak ada data candle untuk ${pairSymbol}`);
  }

  // Candle terakhir dari Indodax adalah candle HARI INI yang belum
  // "closed" - dia terus berubah sepanjang hari sampai hari itu
  // selesai. Kalau kita masukkan candle ini ke hitungan EMA/RSI,
  // hasilnya bisa menyesatkan: pergerakan besar yang baru saja
  // terjadi (misal crash -40% dalam beberapa jam) akan "tenggelam"
  // di rata-rata historis, membuat RSI dan tren terbaca netral
  // padahal harga real-time sedang jatuh tajam.
  //
  // Solusinya: hitung semua indikator dari candle yang SUDAH
  // closed saja (kemarin dan sebelumnya). Baru setelah itu kita
  // bandingkan harga real-time saat ini terhadap candle kemarin
  // itu, untuk mendeteksi apakah sedang terjadi pergerakan besar
  // yang belum tertangkap indikator.
  const closedCandles = candles.slice(0, -1);
  const todayCandle = candles[candles.length - 1];

  // Kalau candle yang sudah closed kurang dari yang dibutuhkan
  // EMA50 (butuh minimal 50 titik), pakai semua candle termasuk
  // hari ini sebagai fallback - lebih baik ada hasil dengan
  // catatan, daripada gagal total untuk coin yang baru listing.
  const candlesToAnalyze =
    closedCandles.length >= 50 ? closedCandles : candles;
  const closes = candlesToAnalyze.map((c) => c.close);

  const ema20Arr = calculateEMA(closes, 20);
  const ema50Arr = calculateEMA(closes, 50);
  const rsiArr = calculateRSI(closes, 14);
  const { macdLine, signalLine, histogram } = calculateMACD(closes);

  const last = closes.length - 1;

  const ema20 = ema20Arr[last];
  const ema50 = ema50Arr[last];
  const rsi14 = rsiArr[last];

  let trend: SwingAnalysis["trend"] = "netral";
  if (closes[last] > ema20 && ema20 > ema50) trend = "bullish";
  else if (closes[last] < ema20 && ema20 < ema50) trend = "bearish";

  let rsiCondition: SwingAnalysis["rsiCondition"] = "netral";
  if (rsi14 >= 70) rsiCondition = "overbought";
  else if (rsi14 <= 30) rsiCondition = "oversold";

  // Deteksi pergerakan besar hari ini yang belum masuk hitungan
  // indikator di atas. Bandingkan harga penutupan candle terakhir
  // yang sudah closed (basis "kemarin") dengan harga saat ini
  // (close dari candle hari ini yang sedang berjalan).
  const yesterdayClose = closes[last];
  const currentPrice = todayCandle.close;
  const intradayChangePercent =
    yesterdayClose === 0
      ? 0
      : ((currentPrice - yesterdayClose) / yesterdayClose) * 100;

  // Ambang batas 15%: pergerakan intraday sebesar ini pada crypto
  // sudah cukup signifikan untuk layak di-flag terpisah dari
  // kesimpulan tren harian biasa, tanpa terlalu sering false-alarm
  // pada fluktuasi normal.
  const intradayWarning = Math.abs(intradayChangePercent) >= 15;

  return {
    symbol: pairSymbol.toUpperCase(),
    lastClose: currentPrice,
    ema20,
    ema50,
    rsi14,
    macdLine: macdLine[last],
    macdSignal: signalLine[last],
    macdHistogram: histogram[last],
    trend,
    rsiCondition,
    intradayChangePercent,
    intradayWarning,
  };
}


// =============================================================
// TAMBAHAN UNTUK lib/indodax.ts
// Sistem multi-timeframe voting: 1m, 5m, 15m, 30m, 1h
// Copy-paste ke BAGIAN PALING BAWAH file yang sudah ada.
// ============================================================

// Peta nama timeframe yang enak dibaca manusia ke parameter
// "tf" yang dipahami endpoint Indodax (dalam satuan menit,
// sesuai skala standar TradingView: 1,5,15,30,60,240,1D,...)
const MTF_TIMEFRAMES = [
  { label: "1m", tf: "1", minutes: 1 },
  { label: "5m", tf: "5", minutes: 5 },
  { label: "15m", tf: "15", minutes: 15 },
  { label: "30m", tf: "30", minutes: 30 },
  { label: "1h", tf: "60", minutes: 60 },
] as const;

/**
 * Ambil candle untuk timeframe intraday (bukan harian). Mirip
 * getDailyCandles, tapi parameter tf-nya angka menit langsung,
 * dan rentang waktu (from/to) dihitung dari jumlah candle yang
 * diminta dikali panjang tiap candle dalam menit - supaya kita
 * tidak menarik data jauh lebih banyak dari yang dibutuhkan.
 *
 * @param pairSymbol - contoh: "BTCIDR"
 * @param tf - parameter tf mentah untuk Indodax, contoh: "15" untuk 15 menit
 * @param candleCount - berapa candle ke belakang yang mau diambil
 */
export async function getIntradayCandles(
  pairSymbol: string,
  tf: string,
  candleCount: number
): Promise<Candle[]> {
  const tfMinutes = Number(tf);
  const to = Math.floor(Date.now() / 1000);
  // Beri buffer 3x lipat supaya perhitungan EMA50 di dalamnya
  // punya cukup data historis sebelum candle yang benar-benar
  // kita analisis (sama seperti alasan buffer 90 hari di harian).
  const from = to - candleCount * tfMinutes * 60 * 3;

  const url = `https://indodax.com/tradingview/history_v2?from=${from}&to=${to}&tf=${tf}&symbol=${pairSymbol.toUpperCase()}`;

  const res = await fetch(url, { cache: "no-store" });

  if (!res.ok) {
    throw new Error(
      `Indodax history API gagal merespons (tf=${tf}): ${res.status} ${res.statusText}`
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

export interface TimeframeVote {
  label: string; // "1m", "5m", dst
  emaBullish: boolean; // EMA9 > EMA50 di timeframe ini
  rsiBullish: boolean; // RSI14 >= 50 di timeframe ini
  rsiValue: number;
  price: number;
}

export interface MultiTimeframeSignal {
  symbol: string;
  currentPrice: number;
  votes: TimeframeVote[];
  emaBullishCount: number; // dari 5, berapa yang EMA-nya bullish
  rsiBullishCount: number; // dari 5, berapa yang RSI-nya bullish
  signal: "BUY" | "SELL" | "TUNGGU";
  // Alasan singkat kenapa signal ini yang keluar, dipakai untuk
  // ditampilkan ke user supaya keputusan bot bisa dipahami, bukan
  // cuma diterima mentah-mentah.
  reason: string;
}

// Ambang voting: dari 5 timeframe, minimal berapa yang harus
// searah supaya dianggap sinyal valid. Angka ini yang diminta
// user sendiri: minimal 3 dari 5 (mayoritas sederhana).
const MIN_VOTES_FOR_SIGNAL = 3;

/**
 * Jalankan analisis EMA9/EMA50 + RSI14 di 5 timeframe sekaligus
 * (1m, 5m, 15m, 30m, 1h), lalu voting: kalau minimal 3 dari 5
 * timeframe searah bullish di EMA MAUPUN RSI, sinyal BUY valid.
 * Simetris untuk SELL. Kalau belum ada yang mencapai ambang itu
 * di kedua sisi, hasilnya TUNGGU - bot jujur bilang belum cukup
 * konfirmasi, bukan memaksakan sinyal.
 */
export async function analyzeMultiTimeframe(
  pairSymbol: string
): Promise<MultiTimeframeSignal> {
  // Ambil candle dari kelima timeframe secara paralel, bukan
  // berurutan, supaya total waktu tunggu tidak menumpuk 5x lipat.
  const results = await Promise.all(
    MTF_TIMEFRAMES.map(async (tfConfig) => {
      // 60 candle cukup untuk EMA50 + buffer wajar di semua tf ini.
      const candles = await getIntradayCandles(pairSymbol, tfConfig.tf, 60);

      if (candles.length === 0) {
        throw new Error(
          `Tidak ada data candle untuk ${pairSymbol} di timeframe ${tfConfig.label}`
        );
      }

      // Sama seperti analyzeSwing: exclude candle terakhir yang
      // belum closed dari perhitungan indikator, supaya pergerakan
      // yang belum selesai tidak menyesatkan EMA/RSI. Untuk
      // timeframe pendek ini bedanya cuma soal detik/menit
      // terakhir, tapi prinsipnya tetap konsisten.
      const closedCandles = candles.slice(0, -1);
      const candlesToUse =
        closedCandles.length >= 50 ? closedCandles : candles;
      const closes = candlesToUse.map((c) => c.close);

      const ema9Arr = calculateEMA(closes, 9);
      const ema50Arr = calculateEMA(closes, 50);
      const rsiArr = calculateRSI(closes, 14);

      const last = closes.length - 1;
      const ema9 = ema9Arr[last];
      const ema50 = ema50Arr[last];
      const rsiValue = rsiArr[last];

      const vote: TimeframeVote = {
        label: tfConfig.label,
        emaBullish: ema9 > ema50,
        rsiBullish: rsiValue >= 50,
        rsiValue,
        price: candles[candles.length - 1].close,
      };

      return vote;
    })
  );

  const emaBullishCount = results.filter((v) => v.emaBullish).length;
  const rsiBullishCount = results.filter((v) => v.rsiBullish).length;
  const emaBearishCount = results.length - emaBullishCount;
  const rsiBearishCount = results.length - rsiBullishCount;

  let signal: MultiTimeframeSignal["signal"] = "TUNGGU";
  let reason = "";

  const buyValid =
    emaBullishCount >= MIN_VOTES_FOR_SIGNAL &&
    rsiBullishCount >= MIN_VOTES_FOR_SIGNAL;
  const sellValid =
    emaBearishCount >= MIN_VOTES_FOR_SIGNAL &&
    rsiBearishCount >= MIN_VOTES_FOR_SIGNAL;

  if (buyValid) {
    signal = "BUY";
    reason = `EMA bullish di ${emaBullishCount}/5 timeframe, RSI bullish di ${rsiBullishCount}/5 timeframe - kombinasi sudah mencapai ambang minimal (${MIN_VOTES_FOR_SIGNAL}/5).`;
  } else if (sellValid) {
    signal = "SELL";
    reason = `EMA bearish di ${emaBearishCount}/5 timeframe, RSI bearish di ${rsiBearishCount}/5 timeframe - kombinasi sudah mencapai ambang minimal (${MIN_VOTES_FOR_SIGNAL}/5).`;
  } else {
    reason = `Belum ada arah yang mencapai ${MIN_VOTES_FOR_SIGNAL}/5 di kedua indikator sekaligus (EMA: ${emaBullishCount} bullish vs ${emaBearishCount} bearish, RSI: ${rsiBullishCount} bullish vs ${rsiBearishCount} bearish). Tunggu konfirmasi lebih lanjut sebelum entry.`;
  }

  // Harga acuan: pakai candle 1 menit sebagai yang paling
  // mendekati harga real-time saat ini.
  const currentPrice = results.find((v) => v.label === "1m")?.price ?? results[0].price;

  return {
    symbol: pairSymbol.toUpperCase(),
    currentPrice,
    votes: results,
    emaBullishCount,
    rsiBullishCount,
    signal,
    reason,
  };
}


// ============================================================
// TAMBAHAN UNTUK lib/indodax.ts
// Level TP/SL untuk logic SPOT + konteks Fibonacci retracement
// Copy-paste ke BAGIAN PALING BAWAH file yang sudah ada.
// ============================================================

export interface FibonacciLevels {
  swingHigh: number;
  swingLow: number;
  level236: number;
  level382: number;
  level500: number;
  level618: number;
}

/**
 * Cari titik swing high (tertinggi) dan swing low (terendah) dari
 * sejumlah candle terakhir, lalu hitung level Fibonacci retracement
 * standar (23.6%, 38.2%, 50%, 61.8%) di antara keduanya.
 *
 * Fibonacci di sini dipakai sebagai KONTEKS pendukung, bukan basis
 * utama TP - membantu user melihat apakah level TP1-3 (yang basisnya
 * persentase tetap) kebetulan berdekatan dengan level Fibonacci
 * penting, yang jadi konfirmasi tambahan.
 */
function calculateFibonacciLevels(candles: Candle[]): FibonacciLevels {
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);

  const swingHigh = Math.max(...highs);
  const swingLow = Math.min(...lows);
  const range = swingHigh - swingLow;

  return {
    swingHigh,
    swingLow,
    level236: swingHigh - range * 0.236,
    level382: swingHigh - range * 0.382,
    level500: swingHigh - range * 0.5,
    level618: swingHigh - range * 0.618,
  };
}

export interface SpotPositionLevels {
  entry: number;
  stopLossTight: number; // -3% dari entry, untuk yang mau risiko lebih kecil
  stopLossWide: number; // -5% dari entry, kasih ruang gerak lebih lebar
  takeProfit1: number; // +10% dari entry
  takeProfit2: number; // +20% dari entry
  takeProfit3: number; // +30% dari entry
  fibonacci: FibonacciLevels;
}

/**
 * Hitung level posisi SPOT: entry (harga saat ini), stop loss
 * (-1%), dan tiga target take profit bertingkat (+10%, +20%, +30%).
 * Fibonacci retracement dari swing high/low candle 1 jam disertakan
 * sebagai konteks tambahan, bukan basis TP.
 *
 * PENTING: fungsi ini HANYA relevan untuk sinyal BUY (area masuk
 * beli). Untuk sinyal SELL di konteks spot, artinya "pertimbangkan
 * exit posisi yang sudah dipegang" - bukan buka posisi short baru,
 * jadi tidak ada level entry/TP bertingkat yang sama untuk SELL.
 */
export async function calculateSpotLevels(
  pairSymbol: string,
  currentPrice: number
): Promise<SpotPositionLevels> {
  // Ambil candle 1 jam untuk basis swing high/low Fibonacci -
  // timeframe ini paling stabil, tidak terlalu bising seperti
  // candle 1-5 menit tapi masih relevan untuk gaya entry-pagi-
  // exit-sore (bukan candle harian yang terlalu lambat).
  const hourlyCandles = await getIntradayCandles(pairSymbol, "60", 40);

  const fibonacci = calculateFibonacciLevels(hourlyCandles);

  const entry = currentPrice;
  // Dua pilihan Stop Loss, biar user pilih sesuai toleransi risiko:
  // -3% (lebih ketat, cepat keluar kalau salah) atau -5% (lebih
  // longgar, kasih ruang harga "bernapas" sebelum benar-benar
  // dianggap gagal, cocok untuk coin yang volatil).
  const stopLossTight = entry * 0.97; // -3%
  const stopLossWide = entry * 0.95; // -5%
  const takeProfit1 = entry * 1.1; // +10%
  const takeProfit2 = entry * 1.2; // +20%
  const takeProfit3 = entry * 1.3; // +30%

  return {
    entry,
    stopLossTight,
    stopLossWide,
    takeProfit1,
    takeProfit2,
    takeProfit3,
    fibonacci,
  };
}
