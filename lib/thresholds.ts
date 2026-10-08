/**
 * Ambang scan yang dipakai BERSAMA oleh bot, channel, dan dashboard.
 *
 * File ini sengaja hanya berisi konstanta murni (tanpa import dan tanpa
 * fetch), jadi aman diimpor dari komponen dashboard maupun kode server bot.
 * Ubah angka HANYA di sini. lib/indodax.ts mengekspor ulang nama yang sama,
 * jadi import lama di bot tetap jalan, dan dashboard ikut berubah otomatis.
 */

/** Total bobot analisa multi-timeframe (1m 1, 5m 1, 15m 1, 30m 2, 1h 3). */
export const MTF_TOTAL_WEIGHT = 8;
/** Coin masuk radar kalau RSI 1 jam di bawah angka ini. */
export const RSI_OVERSOLD_THRESHOLD = 40;
/** Di bawah angka ini RSI disebut "sangat jenuh jual" (hanya untuk warna dashboard). */
export const RSI_DEEP_THRESHOLD = 25;
export const MTF_WEIGHTED_THRESHOLD = 5;
export const VOLUME_CONFIRMATION_THRESHOLD = 1.2;
/** Filter volume 24 jam (IDR) untuk scan. */
export const SCAN_MIN_VOLUME_IDR = 200_000_000;
export const SCAN_MAX_VOLUME_IDR = 500_000_000;
export const SCAN_MAX_COINS = 120;
/** Minimal sentuhan agar level support/resistance dianggap valid. */
export const SR_MIN_TOUCHES = 3;
