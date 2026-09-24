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
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(
      `Indodax API gagal merespons: ${res.status} ${res.statusText}`
    );
  }

  const data: IndodaxSummariesResponse = await res.json();

  const allTickers = Object.entries(data.tickers).map(([pairId, ticker]) => {
    const symbol = pairId.endsWith("_idr")
      ? pairId.slice(0, -"_idr".length).toUpperCase()
      : pairId.toUpperCase();

    return {
      pairId,
      symbol,
      lastPrice: Number(ticker.last),
      buyPrice: Number(ticker.buy),
      sellPrice: Number(ticker.sell),
      volumeIdr: Number(ticker.vol_idr),
    } satisfies TopCoin;
  });

  const sorted = allTickers
    .filter((t) => !Number.isNaN(t.volumeIdr))
    .sort((a, b) => b.volumeIdr - a.volumeIdr);

  return sorted.slice(0, limit);
}

export async function getCoinPrice(symbol: string): Promise<TopCoin | null> {
  const res = await fetch(INDODAX_SUMMARIES_URL, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Indodax API gagal merespons: ${res.status} ${res.statusText}`);
  }
  const data: IndodaxSummariesResponse = await res.json();
  const normalizedSymbol = symbol.trim().toLowerCase();
  const pairId = `${normalizedSymbol}_idr`;
  const ticker = data.tickers[pairId];
  if (!ticker) return null;
  return {
    pairId, symbol: normalizedSymbol.toUpperCase(),
    lastPrice: Number(ticker.last), buyPrice: Number(ticker.buy),
    sellPrice: Number(ticker.sell), volumeIdr: Number(ticker.vol_idr),
  } satisfies TopCoin;
}

export interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number; }

export async function getDailyCandles(pairSymbol: string, days = 90): Promise<Candle[]> {
  const to = Math.floor(Date.now() / 1000);
  const from = to - days * 24 * 60 * 60;
  const url = `https://indodax.com/tradingview/history_v2?from=${from}&to=${to}&tf=1D&symbol=${pairSymbol.toUpperCase()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Indodax history API gagal: ${res.status} ${res.statusText}`);
  const raw: Array<{ Time: number; Open: number; High: number; Low: number; Close: number; Volume: string }> = await res.json();
  return raw.map((c) => ({ time: c.Time, open: c.Open, high: c.High, low: c.Low, close: c.Close, volume: Number(c.Volume) }));
}

export function calculateEMA(closes: number[], period: number): number[] {
  const ema: number[] = [];
  const multiplier = 2 / (period + 1);
  const seedSma = closes.slice(0, period).reduce((sum, v) => sum + v, 0) / period;
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) ema.push(NaN);
    else if (i === period - 1) ema.push(seedSma);
    else ema.push((closes[i] - ema[i - 1]) * multiplier + ema[i - 1]);
  }
  return ema;
}

export function calculateRSI(closes: number[], period = 14): number[] {
  const rsi: number[] = new Array(closes.length).fill(NaN);
  if (closes.length < period + 1) return rsi;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) avgGain += change; else avgLoss -= change;
  }
  avgGain /= period; avgLoss /= period;
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? -change : 0)) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return rsi;
}

export function calculateMACD(closes: number[]) {
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  const macdLine = closes.map((_, i) => isNaN(ema12[i]) || isNaN(ema26[i]) ? NaN : ema12[i] - ema26[i]);
  const validMacd = macdLine.filter((v) => !isNaN(v));
  const signalRaw = calculateEMA(validMacd, 9);
  const signalLine: number[] = new Array(closes.length).fill(NaN);
  let validIdx = 0;
  for (let i = 0; i < closes.length; i++) { if (!isNaN(macdLine[i])) { signalLine[i] = signalRaw[validIdx]; validIdx++; } }
  const histogram = closes.map((_, i) => isNaN(macdLine[i]) || isNaN(signalLine[i]) ? NaN : macdLine[i] - signalLine[i]);
  return { macdLine, signalLine, histogram };
}

export interface SwingAnalysis {
  symbol: string; lastClose: number; ema20: number; ema50: number; rsi14: number;
  macdLine: number; macdSignal: number; macdHistogram: number;
  trend: "bullish" | "bearish" | "netral";
  rsiCondition: "overbought" | "oversold" | "netral";
  intradayChangePercent: number; intradayWarning: boolean;
}

export async function analyzeSwing(pairSymbol: string): Promise<SwingAnalysis> {
  const candles = await getDailyCandles(pairSymbol, 90);
  if (candles.length === 0) throw new Error(`Tidak ada data candle untuk ${pairSymbol}`);
  const closedCandles = candles.slice(0, -1);
  const todayCandle = candles[candles.length - 1];
  const candlesToAnalyze = closedCandles.length >= 50 ? closedCandles : candles;
  const closes = candlesToAnalyze.map((c) => c.close);
  const ema20Arr = calculateEMA(closes, 20);
  const ema50Arr = calculateEMA(closes, 50);
  const rsiArr = calculateRSI(closes, 14);
  const { macdLine, signalLine, histogram } = calculateMACD(closes);
  const last = closes.length - 1;
  let trend: SwingAnalysis["trend"] = "netral";
  if (closes[last] > ema20Arr[last] && ema20Arr[last] > ema50Arr[last]) trend = "bullish";
  else if (closes[last] < ema20Arr[last] && ema20Arr[last] < ema50Arr[last]) trend = "bearish";
  let rsiCondition: SwingAnalysis["rsiCondition"] = "netral";
  if (rsiArr[last] >= 70) rsiCondition = "overbought";
  else if (rsiArr[last] <= 30) rsiCondition = "oversold";
  const yesterdayClose = closes[last];
  const currentPrice = todayCandle.close;
  const intradayChangePercent = yesterdayClose === 0 ? 0 : ((currentPrice - yesterdayClose) / yesterdayClose) * 100;
  const intradayWarning = Math.abs(intradayChangePercent) >= 15;
  return { symbol: pairSymbol.toUpperCase(), lastClose: currentPrice, ema20: ema20Arr[last], ema50: ema50Arr[last], rsi14: rsiArr[last], macdLine: macdLine[last], macdSignal: signalLine[last], macdHistogram: histogram[last], trend, rsiCondition, intradayChangePercent, intradayWarning };
}

const MTF_TIMEFRAMES = [
  { label: "1m", tf: "1", minutes: 1, weight: 1 },
  { label: "5m", tf: "5", minutes: 5, weight: 1 },
  { label: "15m", tf: "15", minutes: 15, weight: 1 },
  { label: "30m", tf: "30", minutes: 30, weight: 2 },
  { label: "1h", tf: "60", minutes: 60, weight: 3 },
] as const;

const MTF_TOTAL_WEIGHT = 8;
const RSI_OVERSOLD_THRESHOLD = 40;
const MTF_WEIGHTED_THRESHOLD = 5;
const VOLUME_CONFIRMATION_THRESHOLD = 1.2;

export async function getIntradayCandles(pairSymbol: string, tf: string, candleCount: number): Promise<Candle[]> {
  const tfMinutes = Number(tf);
  const to = Math.floor(Date.now() / 1000);
  const from = to - candleCount * tfMinutes * 60 * 3;
  const url = `https://indodax.com/tradingview/history_v2?from=${from}&to=${to}&tf=${tf}&symbol=${pairSymbol.toUpperCase()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Indodax history API gagal (tf=${tf}): ${res.status}`);
  const raw: Array<{ Time: number; Open: number; High: number; Low: number; Close: number; Volume: string }> = await res.json();
  return raw.map((c) => ({ time: c.Time, open: c.Open, high: c.High, low: c.Low, close: c.Close, volume: Number(c.Volume) }));
}

export interface TimeframeVote { label: string; weight: number; emaBullish: boolean; rsiBullish: boolean; rsiValue: number; price: number; volumeRatio: number; }
export interface MultiTimeframeSignal { symbol: string; currentPrice: number; votes: TimeframeVote[]; emaBullishCount: number; rsiBullishCount: number; emaWeightedScore: number; rsiWeightedScore: number; volumeRatio1h: number; volumeConfirmed: boolean; signal: "BUY" | "SELL" | "TUNGGU"; confidence: "TINGGI" | "SEDANG" | null; reason: string; }

export async function analyzeMultiTimeframe(pairSymbol: string): Promise<MultiTimeframeSignal> {
  const results = await Promise.all(MTF_TIMEFRAMES.map(async (tfConfig) => {
    const candles = await getIntradayCandles(pairSymbol, tfConfig.tf, 60);
    if (candles.length === 0) throw new Error(`Tidak ada data candle untuk ${pairSymbol} di tf ${tfConfig.label}`);
    const closedCandles = candles.slice(0, -1);
    const candlesToUse = closedCandles.length >= 50 ? closedCandles : candles;
    const closes = candlesToUse.map((c) => c.close);
    const ema9Arr = calculateEMA(closes, 9);
    const ema50Arr = calculateEMA(closes, 50);
    const rsiArr = calculateRSI(closes, 14);
    const last = closes.length - 1;
    const volumeLookback = candlesToUse.slice(-11, -1);
    const avgVolume = volumeLookback.length > 0 ? volumeLookback.reduce((s, c) => s + c.volume, 0) / volumeLookback.length : 0;
    const lastVolume = candlesToUse[candlesToUse.length - 1].volume;
    return {
      label: tfConfig.label, weight: tfConfig.weight,
      emaBullish: ema9Arr[last] > ema50Arr[last],
      rsiBullish: rsiArr[last] < RSI_OVERSOLD_THRESHOLD,
      rsiValue: rsiArr[last], price: candles[candles.length - 1].close,
      volumeRatio: avgVolume > 0 ? lastVolume / avgVolume : 0,
    } satisfies TimeframeVote;
  }));

  const emaBullishCount = results.filter((v) => v.emaBullish).length;
  const rsiBullishCount = results.filter((v) => v.rsiBullish).length;
  const emaWeightedScore = results.filter((v) => v.emaBullish).reduce((s, v) => s + v.weight, 0);
  const rsiWeightedScore = results.filter((v) => v.rsiBullish).reduce((s, v) => s + v.weight, 0);
  const emaBearishWeightedScore = MTF_TOTAL_WEIGHT - emaWeightedScore;
  const rsiBearishWeightedScore = MTF_TOTAL_WEIGHT - rsiWeightedScore;
  const vote1h = results.find((v) => v.label === "1h");
  const volumeRatio1h = vote1h?.volumeRatio ?? 0;
  const volumeConfirmed = volumeRatio1h >= VOLUME_CONFIRMATION_THRESHOLD;
  const buyValid = emaWeightedScore >= MTF_WEIGHTED_THRESHOLD && rsiWeightedScore >= MTF_WEIGHTED_THRESHOLD && volumeConfirmed;
  const sellValid = emaBearishWeightedScore >= MTF_WEIGHTED_THRESHOLD && rsiBearishWeightedScore >= MTF_WEIGHTED_THRESHOLD && volumeConfirmed;

  let signal: MultiTimeframeSignal["signal"] = "TUNGGU";
  let confidence: MultiTimeframeSignal["confidence"] = null;
  let reason = "";
  if (buyValid) {
    signal = "BUY"; confidence = Math.min(emaWeightedScore, rsiWeightedScore) >= 7 ? "TINGGI" : "SEDANG";
    reason = `Skor EMA ${emaWeightedScore}/8, RSI ${rsiWeightedScore}/8, vol ${volumeRatio1h.toFixed(1)}x - semua syarat terpenuhi.`;
  } else if (sellValid) {
    signal = "SELL"; confidence = Math.min(emaBearishWeightedScore, rsiBearishWeightedScore) >= 7 ? "TINGGI" : "SEDANG";
    reason = `Skor bearish EMA ${emaBearishWeightedScore}/8, RSI ${rsiBearishWeightedScore}/8 - syarat SELL terpenuhi.`;
  } else if (emaWeightedScore >= MTF_WEIGHTED_THRESHOLD && rsiWeightedScore >= MTF_WEIGHTED_THRESHOLD && !volumeConfirmed) {
    reason = `EMA & RSI bullish tapi volume 1h cuma ${volumeRatio1h.toFixed(1)}x - tunggu volume menguat.`;
  } else {
    reason = `Belum ada arah yang mencapai skor ${MTF_WEIGHTED_THRESHOLD}/8 di kedua indikator (EMA: ${emaWeightedScore} vs ${emaBearishWeightedScore}, RSI: ${rsiWeightedScore} vs ${rsiBearishWeightedScore}).`;
  }
  const currentPrice = results.find((v) => v.label === "1m")?.price ?? results[0].price;
  return { symbol: pairSymbol.toUpperCase(), currentPrice, votes: results, emaBullishCount, rsiBullishCount, emaWeightedScore, rsiWeightedScore, volumeRatio1h, volumeConfirmed, signal, confidence, reason };
}

export interface FibonacciLevels { swingHigh: number; swingLow: number; level236: number; level382: number; level500: number; level618: number; }

function calculateFibonacciLevels(candles: Candle[]): FibonacciLevels {
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const swingHigh = Math.max(...highs);
  const swingLow = Math.min(...lows);
  const range = swingHigh - swingLow;
  return { swingHigh, swingLow, level236: swingHigh - range * 0.236, level382: swingHigh - range * 0.382, level500: swingHigh - range * 0.5, level618: swingHigh - range * 0.618 };
}

export interface SpotPositionLevels { entry: number; stopLossTight: number; stopLossWide: number; takeProfit1: number; takeProfit2: number; takeProfit3: number; fibonacci: FibonacciLevels; }

export async function calculateSpotLevels(pairSymbol: string, currentPrice: number): Promise<SpotPositionLevels> {
  const hourlyCandles = await getIntradayCandles(pairSymbol, "60", 40);
  const fibonacci = calculateFibonacciLevels(hourlyCandles);
  return { entry: currentPrice, stopLossTight: currentPrice * 0.97, stopLossWide: currentPrice * 0.95, takeProfit1: currentPrice * 1.05, takeProfit2: currentPrice * 1.1, takeProfit3: currentPrice * 1.15, fibonacci };
}

export interface ScanResult { symbol: string; price: number; rsi: number; volumeIdr: number; }

const SCAN_MIN_VOLUME_IDR = 200_000_000;
const SCAN_MAX_VOLUME_IDR = 500_000_000;
const SCAN_MAX_COINS = 120;
const SCAN_EXCLUDED_SYMBOLS = new Set(["USDT", "USDC", "DAI", "TUSD", "BUSD", "FDUSD"]);

export async function scanBullishCoins(): Promise<ScanResult[]> {
  const topCoins = await getTopVolumeCoins(200);
  const eligibleCoins = topCoins
    .filter((c) => c.volumeIdr >= SCAN_MIN_VOLUME_IDR)
    .filter((c) => c.volumeIdr <= SCAN_MAX_VOLUME_IDR)
    .filter((c) => !SCAN_EXCLUDED_SYMBOLS.has(c.symbol))
    .slice(0, SCAN_MAX_COINS);

  const results = await Promise.allSettled(eligibleCoins.map(async (coin) => {
    const candles = await getIntradayCandles(`${coin.symbol}IDR`, "60", 60);
    if (candles.length < 20) throw new Error(`Data candle kurang`);
    const closedCandles = candles.slice(0, -1);
    const candlesToUse = closedCandles.length >= 50 ? closedCandles : candles;
    const closes = candlesToUse.map((c) => c.close);
    const rsiArr = calculateRSI(closes, 14);
    const rsi = rsiArr[closes.length - 1];
    return { symbol: coin.symbol, price: candles[candles.length - 1].close, rsi, volumeIdr: coin.volumeIdr, isBullish: rsi < RSI_OVERSOLD_THRESHOLD };
  }));

  const bullishCoins: ScanResult[] = [];
  for (const r of results) {
    if (r.status === "fulfilled" && r.value.isBullish) {
      bullishCoins.push({ symbol: r.value.symbol, price: r.value.price, rsi: r.value.rsi, volumeIdr: r.value.volumeIdr });
    }
  }
  bullishCoins.sort((a, b) => a.rsi - b.rsi);
  return bullishCoins;
}

export interface ScanSummary { checkedCount: number; nearest: ScanResult[]; }

export async function scanNearestToThreshold(limit = 3): Promise<ScanSummary> {
  const topCoins = await getTopVolumeCoins(200);
  const eligibleCoins = topCoins
    .filter((c) => c.volumeIdr >= SCAN_MIN_VOLUME_IDR)
    .filter((c) => c.volumeIdr <= SCAN_MAX_VOLUME_IDR)
    .filter((c) => !SCAN_EXCLUDED_SYMBOLS.has(c.symbol))
    .slice(0, SCAN_MAX_COINS);

  const settled = await Promise.allSettled(eligibleCoins.map(async (coin) => {
    const candles = await getIntradayCandles(`${coin.symbol}IDR`, "60", 60);
    if (candles.length < 20) throw new Error(`Data candle kurang`);
    const closedCandles = candles.slice(0, -1);
    const candlesToUse = closedCandles.length >= 50 ? closedCandles : candles;
    const closes = candlesToUse.map((c) => c.close);
    const rsiArr = calculateRSI(closes, 14);
    const rsi = rsiArr[closes.length - 1];
    if (Number.isNaN(rsi)) throw new Error(`RSI tidak valid`);
    return { symbol: coin.symbol, price: candles[candles.length - 1].close, rsi, volumeIdr: coin.volumeIdr } satisfies ScanResult;
  }));

  const valid: ScanResult[] = [];
  for (const r of settled) { if (r.status === "fulfilled") valid.push(r.value); }
  valid.sort((a, b) => a.rsi - b.rsi);
  return { checkedCount: valid.length, nearest: valid.slice(0, limit) };
}

export interface PriceLevel { price: number; touches: number; rawPrices: number[]; type?: "support" | "resistance"; }

const SR_MIN_TOUCHES = 3;
const SR_TOLERANCE_PERCENT = 0.01;

function collectTouchPoints(candles: Candle[]): number[] {
  const points: number[] = [];
  for (const c of candles) { points.push(c.high, c.low); }
  return points.sort((a, b) => a - b);
}

function clusterTouchPoints(sortedPoints: number[]): number[][] {
  if (sortedPoints.length === 0) return [];
  const clusters: number[][] = [];
  let currentCluster: number[] = [sortedPoints[0]];
  for (let i = 1; i < sortedPoints.length; i++) {
    const point = sortedPoints[i];
    const clusterAvg = currentCluster.reduce((s, p) => s + p, 0) / currentCluster.length;
    const distanceFromAvg = Math.abs(point - clusterAvg) / clusterAvg;
    const spreadFromFirst = (point - currentCluster[0]) / currentCluster[0];
    if (distanceFromAvg <= SR_TOLERANCE_PERCENT && spreadFromFirst <= SR_TOLERANCE_PERCENT) {
      currentCluster.push(point);
    } else {
      clusters.push(currentCluster);
      currentCluster = [point];
    }
  }
  clusters.push(currentCluster);
  return clusters;
}

function clustersToValidLevels(clusters: number[][]): PriceLevel[] {
  return clusters
    .map((cluster) => ({ price: cluster.reduce((s, p) => s + p, 0) / cluster.length, touches: cluster.length, rawPrices: cluster }))
    .filter((level) => level.touches >= SR_MIN_TOUCHES)
    .sort((a, b) => a.price - b.price);
}

function classifyLevels(levels: PriceLevel[], currentPrice: number): PriceLevel[] {
  return levels.map((level) => ({ ...level, type: (level.price < currentPrice ? "support" : "resistance") as "support" | "resistance" }));
}

export function detectSupportResistanceLevels(candles: Candle[], currentPrice: number): PriceLevel[] {
  if (candles.length === 0) return [];
  const touchPoints = collectTouchPoints(candles);
  const clusters = clusterTouchPoints(touchPoints);
  const validLevels = clustersToValidLevels(clusters);
  return classifyLevels(validLevels, currentPrice);
}

export async function getWeeklyCandlesFull(pairSymbol: string): Promise<Candle[]> {
  const to = Math.floor(Date.now() / 1000);
  const from = to - 5 * 365 * 24 * 60 * 60;
  const url = `https://indodax.com/tradingview/history_v2?from=${from}&to=${to}&tf=1W&symbol=${pairSymbol.toUpperCase()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Weekly API gagal: ${res.status}`);
  const raw: Array<{ Time: number; Open: number; High: number; Low: number; Close: number; Volume: string }> = await res.json();
  return raw.map((c) => ({ time: c.Time, open: c.Open, high: c.High, low: c.Low, close: c.Close, volume: Number(c.Volume) }));
}

export function findNearestResistanceLevels(levels: PriceLevel[], currentPrice: number, count = 2): PriceLevel[] {
  return levels.filter((l) => l.type === "resistance" && l.price > currentPrice).sort((a, b) => a.price - b.price).slice(0, count);
}

export async function getTopVolumeCoinsInRange(limit = 5): Promise<TopCoin[]> {
  const pool = await getTopVolumeCoins(200);
  return pool
    .filter((c) => c.volumeIdr >= SCAN_MIN_VOLUME_IDR)
    .filter((c) => c.volumeIdr <= SCAN_MAX_VOLUME_IDR)
    .slice(0, limit);
}
