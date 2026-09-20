import type { BullishScanRow } from "@/lib/supabase-public";
import { formatIDR, timeAgo, rsiZone } from "@/lib/format-dashboard";

function RsiCell({ rsi }: { rsi: number }) {
  const zone = rsiZone(rsi);
  const color = zone === "deep" ? "var(--up)" : zone === "oversold" ? "var(--warn)" : "var(--ink-dim)";
  const fillPct = Math.min(100, (rsi / 100) * 100);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span className="mono" style={{ color, fontWeight: 600, minWidth: 34 }}>
        {rsi.toFixed(1)}
      </span>
      <div
        style={{
          width: 40,
          height: 3,
          background: "var(--line)",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div style={{ width: `${fillPct}%`, height: "100%", background: color }} />
      </div>
    </div>
  );
}

export default function RadarTable({ rows }: { rows: BullishScanRow[] }) {
  if (rows.length === 0) {
    return (
      <div style={{ color: "var(--ink-dim)", padding: "40px 0", textAlign: "center", fontSize: 13.5 }}>
        Belum ada sinyal masuk. Scan berikutnya jalan tiap 15 menit.
      </div>
    );
  }

  // Kelompokkan per waktu scan biar keliatan mana yang datang bareng
  const latestScanTime = rows[0].scanned_at;

  return (
    <div className="scroll-x">
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--line)" }}>
            {["Rank", "Coin", "Harga", "RSI", "TP1", "TP2", "Kapan"].map((h) => (
              <th
                key={h}
                style={{
                  textAlign: h === "Coin" ? "left" : "right",
                  padding: "8px 12px",
                  fontSize: 11.5,
                  color: "var(--ink-faint)",
                  fontWeight: 500,
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isLatestBatch = row.scanned_at === latestScanTime;
            return (
              <tr
                key={row.id}
                style={{
                  borderBottom: "1px solid var(--line-soft)",
                  background: isLatestBatch ? "var(--up-bg)" : "transparent",
                }}
              >
                <td className="mono" style={{ padding: "10px 12px", color: "var(--ink-faint)", textAlign: "right" }}>
                  {row.rank_in_scan}
                </td>
                <td style={{ padding: "10px 12px", fontWeight: 600 }}>{row.symbol}</td>
                <td className="mono" style={{ padding: "10px 12px", textAlign: "right" }}>
                  Rp{formatIDR(row.price)}
                </td>
                <td style={{ padding: "10px 12px" }}>
                  <RsiCell rsi={row.rsi} />
                </td>
                <td className="mono" style={{ padding: "10px 12px", textAlign: "right", color: "var(--ink-dim)" }}>
                  {row.tp1_price ? `Rp${formatIDR(row.tp1_price)}` : "—"}
                </td>
                <td className="mono" style={{ padding: "10px 12px", textAlign: "right", color: "var(--ink-dim)" }}>
                  {row.tp2_price ? `Rp${formatIDR(row.tp2_price)}` : "—"}
                </td>
                <td
                  className="mono"
                  style={{ padding: "10px 12px", textAlign: "right", color: "var(--ink-faint)", fontSize: 12.5 }}
                >
                  {timeAgo(row.scanned_at)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
