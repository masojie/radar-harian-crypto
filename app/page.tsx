import { getLatestBullishScans, getOpenSignals, getClosedSignals, getLatestPrices } from "@/lib/supabase-public";
import RadarTable from "./components/RadarTable";
import OpenPositions from "./components/OpenPositions";
import HistoryStats from "./components/HistoryStats";
import TabShell from "./components/TabShell";
import AutoRefresh from "./components/AutoRefresh";
import { buildRadarView } from "@/lib/radar-view";
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

/** Sinyal dianggap "hidup" kalau yang terakhir masuk kurang dari ini. */
const LIVE_WINDOW_MS = 30 * 60_000;

export default async function Page() {
  const [bullish, openPositions, closedSignals, latestPrices] = await Promise.all([
    getLatestBullishScans(30),
    getOpenSignals(50),
    getClosedSignals(100),
    getLatestPrices(),
  ]);

  const view = buildRadarView(bullish);
  const lastSignalAt = view.latestScanAt;
  const isLive = lastSignalAt !== null && Date.now() - Date.parse(lastSignalAt) < LIVE_WINDOW_MS;

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
            title={lastSignalAt ? formatClock(lastSignalAt) : undefined}
          >
            <span className="status-dot" aria-hidden="true" />
            {lastSignalAt ? `Sinyal ${timeAgo(lastSignalAt)}` : "Menunggu sinyal"}
          </p>
        </div>
      </header>

      <main id="konten" className="wrap">
        <TabShell
          openCount={openPositions.length}
          radar={<RadarTable view={view} />}
          positions={<OpenPositions positions={openPositions} latestPrices={latestPrices} />}
          history={<HistoryStats signals={closedSignals} />}
        />
      </main>
    </>
  );
}
