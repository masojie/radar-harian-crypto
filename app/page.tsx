import { getRecentBullishScans, getOpenSignals, getClosedSignals } from "@/lib/supabase-public";
import { getLivePrices } from "@/lib/live-prices";
import RadarTable from "./components/RadarTable";
import OpenPositions from "./components/OpenPositions";
import HistoryStats from "./components/HistoryStats";
import TabShell from "./components/TabShell";
import AutoRefresh from "./components/AutoRefresh";
import { buildRadarView, LIVE_WINDOW_MS } from "@/lib/radar-view";
import { formatClock, timeAgo } from "@/lib/format-dashboard";

// PENTING (bug yang ketauan lewat build test): jangan cuma pakai revalidate.
// Next.js App Router defaultnya mencoba PRERENDER STATIC halaman ini di BUILD
// TIME. Kalau Supabase tidak reachable saat build berlangsung (salah env var,
// gangguan jaringan sesaat), seluruh proses build Vercel GAGAL TOTAL - bukan
// cuma dashboard ini yang error, tapi semua route lain ikut gagal di-deploy.
// force-dynamic memaksa halaman ini di-render di server pada TIAP REQUEST,
// bukan sekali saat build - cocok untuk data yang berubah tiap 15 menit ini.
export const dynamic = "force-dynamic";
export const revalidate = 60;

export default async function Page() {
  const [feed, openPositions, closedSignals] = await Promise.all([
    getRecentBullishScans(),
    getOpenSignals(50),
    getClosedSignals(100),
  ]);

  // Harga posisi aktif diambil LIVE dari Indodax, bukan dari bullish_scans yang
  // bisa basi belasan jam (tabel itu hanya terisi saat ada coin oversold).
  const live = await getLivePrices(openPositions.map((p) => p.symbol));

  const nowMs = Date.now();
  // Baris bullish_scans yang melahirkan posisi, dan posisi terbuka per coin.
  // Dipakai untuk membedakan "sinyal baru" dari "pantauan" (kosakata channel).
  const allSignals = [...openPositions, ...closedSignals];
  const signalIds = new Set(allSignals.map((s) => s.signal_id));
  const openBySymbol = new Map(openPositions.map((p) => [p.symbol, p] as const));
  const view = buildRadarView(feed.rows, nowMs, { signalIds, windowHours: feed.windowHours });

  // "Sinyal Xm lalu" = sinyal BARU terakhir (posisi dibuka dan disiarkan ke
  // channel), bukan scan terakhir. Scan terakhir menentukan titik hijau.
  const lastSignalAt = allSignals.reduce<string | null>(
    (best, s) => (best === null || Date.parse(s.signaled_at) > Date.parse(best) ? s.signaled_at : best),
    null
  );
  const lastScanAt = view.latestScanAt;
  const isLive = lastScanAt !== null && nowMs - Date.parse(lastScanAt) < LIVE_WINDOW_MS;
  const statusTitle = [
    lastScanAt ? `Scan terakhir ${formatClock(lastScanAt)}` : null,
    lastSignalAt ? `Sinyal baru ${formatClock(lastSignalAt)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <AutoRefresh />

      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true" />
            <div className="brand-text">
              <h1>Radar Harian Crypto</h1>
              <p>RSI jenuh jual, spot Indodax</p>
            </div>
          </div>

          <p
            className={isLive ? "status status-live" : "status"}
            title={statusTitle || undefined}
          >
            <span className="status-dot" aria-hidden="true" />
            {lastSignalAt ? `Sinyal ${timeAgo(lastSignalAt)}` : "Menunggu sinyal"}
          </p>
        </div>
      </header>

      <main id="konten" className="wrap">
        <TabShell
          openCount={openPositions.length}
          radar={<RadarTable view={view} openBySymbol={openBySymbol} />}
          positions={<OpenPositions positions={openPositions} latestPrices={live.prices} />}
          history={<HistoryStats signals={closedSignals} />}
        />
      </main>
    </>
  );
}
