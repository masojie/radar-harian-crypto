import type { SignalOutcomeRow } from "@/lib/supabase-public";
import { formatIDR, formatPct, timeAgo } from "@/lib/format-dashboard";

function outcomeColor(outcome: string | null): string {
  if (!outcome) return "var(--ink-faint)";
  if (outcome.startsWith("tp")) return "var(--up)";
  if (outcome === "sl") return "var(--down)";
  return "var(--warn)"; // timeout
}

function outcomeLabel(outcome: string | null): string {
  if (!outcome) return "—";
  if (outcome === "tp1") return "TP1";
  if (outcome === "tp2") return "TP2";
  if (outcome === "tp3") return "TP3";
  if (outcome === "sl") return "SL";
  if (outcome === "timeout") return "Timeout";
  return outcome;
}

/** Bar horizontal komposisi outcome — pengganti pie chart, lebih pas buat baris data. */
function OutcomeBar({ counts, total }: { counts: Record<string, number>; total: number }) {
  const segments: { key: string; color: string }[] = [
    { key: "tp1", color: "var(--up)" },
    { key: "tp2", color: "var(--up)" },
    { key: "tp3", color: "var(--up)" },
    { key: "timeout", color: "var(--warn)" },
    { key: "sl", color: "var(--down)" },
  ];

  return (
    <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", width: "100%" }}>
      {segments.map((seg) => {
        const count = counts[seg.key] ?? 0;
        if (count === 0) return null;
        return (
          <div
            key={seg.key}
            style={{
              width: `${(count / total) * 100}%`,
              background: seg.color,
              opacity: seg.key === "tp2" ? 0.75 : seg.key === "tp3" ? 0.55 : 1,
            }}
          />
        );
      })}
    </div>
  );
}

export default function HistoryStats({ signals }: { signals: SignalOutcomeRow[] }) {
  if (signals.length === 0) {
    return (
      <div style={{ color: "var(--ink-dim)", padding: "40px 0", textAlign: "center", fontSize: 13.5 }}>
        Belum ada sinyal yang selesai dilacak.
      </div>
    );
  }

  // Statistik dihitung dari outcome_wide (SL -5%) — lebih representatif untuk trading real
  const counts: Record<string, number> = {};
  let totalPnl = 0;
  let pnlCount = 0;

  for (const s of signals) {
    const key = s.outcome_wide ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
    if (s.pnl_wide_pct !== null) {
      totalPnl += s.pnl_wide_pct;
      pnlCount++;
    }
  }

  const total = signals.length;
  const wins = (counts.tp1 ?? 0) + (counts.tp2 ?? 0) + (counts.tp3 ?? 0);
  const winRate = (wins / total) * 100;
  const avgPnl = pnlCount > 0 ? totalPnl / pnlCount : 0;

  return (
    <div>
      {/* Ringkasan agregat — angka yang sebenarnya menentukan apakah strategi ini jalan */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 1,
          background: "var(--line)",
          border: "1px solid var(--line)",
          borderRadius: "var(--radius-md)",
          overflow: "hidden",
          marginBottom: 20,
        }}
      >
        {[
          { label: "Win rate", value: `${winRate.toFixed(1)}%`, color: winRate >= 50 ? "var(--up)" : "var(--down)" },
          { label: "Avg P&L / sinyal", value: formatPct(avgPnl), color: avgPnl >= 0 ? "var(--up)" : "var(--down)" },
          { label: "Total sinyal", value: String(total), color: "var(--ink)" },
        ].map((stat) => (
          <div key={stat.label} style={{ background: "var(--bg-panel)", padding: "16px 18px" }}>
            <div style={{ fontSize: 11.5, color: "var(--ink-faint)", marginBottom: 6 }}>{stat.label}</div>
            <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: stat.color }}>
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "var(--ink-faint)", marginBottom: 6 }}>
          <span>Komposisi hasil ({total} sinyal terakhir)</span>
        </div>
        <OutcomeBar counts={counts} total={total} />
        <div style={{ display: "flex", gap: 14, marginTop: 8, fontSize: 11.5, flexWrap: "wrap" }}>
          {[
            { label: "TP1", n: counts.tp1 ?? 0, color: "var(--up)" },
            { label: "TP2", n: counts.tp2 ?? 0, color: "var(--up)" },
            { label: "TP3", n: counts.tp3 ?? 0, color: "var(--up)" },
            { label: "Timeout", n: counts.timeout ?? 0, color: "var(--warn)" },
            { label: "SL", n: counts.sl ?? 0, color: "var(--down)" },
          ].map((seg) => (
            <span key={seg.label} style={{ display: "flex", alignItems: "center", gap: 5, color: "var(--ink-dim)" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: seg.color }} />
              {seg.label} <span className="mono">{seg.n}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Detail per sinyal */}
      <div className="scroll-x">
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--line)" }}>
              {["Coin", "Entry", "Hasil", "P&L", "Ditutup"].map((h) => (
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
            {signals.map((s) => (
              <tr key={s.id} style={{ borderBottom: "1px solid var(--line-soft)" }}>
                <td style={{ padding: "9px 12px", fontWeight: 600 }}>{s.symbol}</td>
                <td className="mono" style={{ padding: "9px 12px", textAlign: "right", color: "var(--ink-dim)" }}>
                  Rp{formatIDR(s.entry_price)}
                </td>
                <td style={{ padding: "9px 12px", textAlign: "right" }}>
                  <span
                    className="mono"
                    style={{
                      color: outcomeColor(s.outcome_wide),
                      fontWeight: 600,
                      fontSize: 12.5,
                    }}
                  >
                    {outcomeLabel(s.outcome_wide)}
                  </span>
                </td>
                <td
                  className="mono"
                  style={{
                    padding: "9px 12px",
                    textAlign: "right",
                    color: (s.pnl_wide_pct ?? 0) >= 0 ? "var(--up)" : "var(--down)",
                    fontWeight: 600,
                  }}
                >
                  {s.pnl_wide_pct !== null ? formatPct(s.pnl_wide_pct) : "—"}
                </td>
                <td
                  className="mono"
                  style={{ padding: "9px 12px", textAlign: "right", color: "var(--ink-faint)", fontSize: 12 }}
                >
                  {s.closed_at ? timeAgo(s.closed_at) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
