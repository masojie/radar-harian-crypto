import type { ScanResult, ScanSummary } from "./indodax";
import { formatChannelPrice } from "./channel-format";
import { RSI_OVERSOLD_THRESHOLD } from "./thresholds";

/**
 * Heartbeat senyap ke channel: tanda radar masih hidup saat tidak ada sinyal
 * baru. Cron jalan tiap 5 menit, jadi jadwal ditentukan dari jam WIB: kirim
 * hanya kalau jam WIB genap DAN menit 0-4. Itu tepat satu eksekusi cron per
 * dua jam.
 */
export const HEARTBEAT_EVERY_HOURS = 2;
export const HEARTBEAT_WINDOW_MINUTES = 5; // sama dengan interval cron

// WIB = UTC+7, tanpa daylight saving.
const WIB_OFFSET_MS = 7 * 3600 * 1000;

export function isHeartbeatSlot(now: Date): boolean {
  const wib = new Date(now.getTime() + WIB_OFFSET_MS);
  return wib.getUTCHours() % HEARTBEAT_EVERY_HOURS === 0 && wib.getUTCMinutes() < HEARTBEAT_WINDOW_MINUTES;
}

export function formatWibClock(now: Date): string {
  const wib = new Date(now.getTime() + WIB_OFFSET_MS);
  const hh = String(wib.getUTCHours()).padStart(2, "0");
  const mm = String(wib.getUTCMinutes()).padStart(2, "0");
  return `${hh}.${mm}`;
}

export interface HeartbeatInput {
  now: Date;
  /** Coin yang RSI 1 jam-nya di bawah ambang pada scan ini (sudah urut RSI terendah). */
  bullish: ScanResult[];
  /** Hasil scanNearestToThreshold. Hanya dipakai kalau tidak ada coin di bawah ambang. */
  nearest?: ScanSummary;
}

function coinLine(c: ScanResult): string {
  return `· ${c.symbol} - RSI ${c.rsi.toFixed(1)} - ${formatChannelPrice(c.price)}`;
}

export function buildHeartbeatMessage({ now, bullish, nearest }: HeartbeatInput): string {
  const lines: string[] = [`💤 Radar aktif, scan ${formatWibClock(now)} WIB`];

  if (bullish.length === 0) {
    lines.push(`${nearest?.checkedCount ?? 0} coin dicek, tidak ada yang RSI 1 jam di bawah ${RSI_OVERSOLD_THRESHOLD}.`);
    const list = nearest?.nearest ?? [];
    if (list.length > 0) lines.push("", "Terdekat ke ambang:", ...list.map(coinLine));
  } else {
    lines.push(
      `${bullish.length} coin RSI 1 jam di bawah ${RSI_OVERSOLD_THRESHOLD}, tapi belum ada sinyal baru (posisi masih terbuka, cooldown, atau ditolak gate).`,
      "",
      "RSI terendah:",
      ...bullish.slice(0, 3).map(coinLine)
    );
  }

  lines.push("", "⚡ RadarView — [pantau live di sini](https://radar-harian-crypto.vercel.app)");
  return lines.join("\n");
}
