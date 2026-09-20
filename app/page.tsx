import { getLatestBullishScans, getOpenSignals, getClosedSignals, getLatestPrices } from "@/lib/supabase-public";
import RadarTable from "./components/RadarTable";
import OpenPositions from "./components/OpenPositions";
import HistoryStats from "./components/HistoryStats";
import TabShell from "./components/TabShell";
import { timeAgo } from "@/lib/format-dashboard";

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
  const [bullish, openPositions, closedSignals, latestPrices] = await Promise.all([
    getLatestBullishScans(30),
    getOpenSignals(50),
    getClosedSignals(100),
    getLatestPrices(),
  ]);

  const lowestRsi = bullish.length > 0 ? bullish.reduce((min, r) => (r.rsi < min.rsi ? r : min)) : null;
  const lastScanTime = bullish[0]?.scanned_at;

  return (
    <main>
      <header
        style={{
          height: 64,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 20px",
          borderBottom: "1px solid var(--line)",
          position: "sticky",
          top: 0,
          paddingTop: "env(safe-area-inset-top, 0px)",
          background: "var(--bg)",
          zIndex: 5,
        }}
      >
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Radar Harian Crypto</div>
          <div style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>
            {lastScanTime ? `Scan terakhir ${timeAgo(lastScanTime)}` : "Menunggu scan pertama"}
          </div>
        </div>
        {lowestRsi && (
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 10.5, color: "var(--ink-faint)" }}>RSI terendah saat ini</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6, justifyContent: "flex-end" }}>
              <span className="mono" style={{ fontSize: 20, fontWeight: 700, color: "var(--up)" }}>
                {lowestRsi.rsi.toFixed(1)}
              </span>
              <span style={{ fontSize: 12.5, color: "var(--ink-dim)" }}>{lowestRsi.symbol}</span>
            </div>
          </div>
        )}
      </header>

      <TabShell
        openCount={openPositions.length}
        radar={<RadarTable rows={bullish} />}
        positions={<OpenPositions positions={openPositions} latestPrices={latestPrices} />}
        history={<HistoryStats signals={closedSignals} />}
      />
    </main>
  );
}
