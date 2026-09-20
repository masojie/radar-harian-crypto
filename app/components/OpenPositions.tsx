import type { SignalOutcomeRow } from "@/lib/supabase-public";
import { formatIDR, formatPct, timeAgo } from "@/lib/format-dashboard";

interface Props {
  positions: SignalOutcomeRow[];
  latestPrices: Map<string, number>;
}

function ProgressStrip({
  entry,
  sl,
  tp1,
  tp2,
  current,
}: {
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  current: number | null;
}) {
  const range = tp2 - sl;
  const pos = (v: number) => Math.min(100, Math.max(0, ((v - sl) / range) * 100));

  const entryPos = pos(entry);
  const tp1Pos = pos(tp1);
  const currentPos = current !== null ? pos(current) : entryPos;

  const isAboveEntry = current !== null && current >= entry;

  return (
    <div style={{ position: "relative", height: 22, marginTop: 10 }}>
      <div
        style={{
          position: "absolute",
          top: 9,
          left: 0,
          right: 0,
          height: 3,
          background: "var(--line)",
          borderRadius: 2,
        }}
      />
      {/* Zona hijau dari entry ke TP1 */}
      <div
        style={{
          position: "absolute",
          top: 9,
          left: `${entryPos}%`,
          width: `${Math.max(0, tp1Pos - entryPos)}%`,
          height: 3,
          background: "var(--up-dim)",
          borderRadius: 2,
        }}
      />
      {/* Marker entry */}
      <div
        style={{
          position: "absolute",
          top: 4,
          left: `${entryPos}%`,
          width: 1,
          height: 14,
          background: "var(--ink-faint)",
          transform: "translateX(-0.5px)",
        }}
      />
      {/* Marker harga sekarang */}
      {current !== null && (
        <div
          className="mono"
          style={{
            position: "absolute",
            top: -2,
            left: `${currentPos}%`,
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: isAboveEntry ? "var(--up)" : "var(--down)",
            border: "2px solid var(--bg-panel)",
            transform: "translateX(-4px)",
          }}
        />
      )}
    </div>
  );
}

export default function OpenPositions({ positions, latestPrices }: Props) {
  if (positions.length === 0) {
    return (
      <div style={{ color: "var(--ink-dim)", padding: "40px 0", textAlign: "center", fontSize: 13.5 }}>
        Tidak ada posisi terbuka saat ini.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {positions.map((p) => {
        const current = latestPrices.get(p.symbol) ?? null;
        const changePct = current !== null ? ((current - p.entry_price) / p.entry_price) * 100 : null;

        return (
          <div
            key={p.id}
            style={{
              background: "var(--bg-panel)",
              border: "1px solid var(--line)",
              borderRadius: "var(--radius-md)",
              padding: "14px 16px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <span style={{ fontWeight: 600, fontSize: 15 }}>{p.symbol}</span>
                <span className="mono" style={{ fontSize: 12, color: "var(--ink-faint)" }}>
                  entry Rp{formatIDR(p.entry_price)}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                {changePct !== null && (
                  <span
                    className="mono"
                    style={{
                      fontWeight: 600,
                      fontSize: 13.5,
                      color: changePct >= 0 ? "var(--up)" : "var(--down)",
                    }}
                  >
                    {formatPct(changePct)}
                  </span>
                )}
                <span className="mono" style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>
                  {timeAgo(p.signaled_at)}
                </span>
              </div>
            </div>

            <ProgressStrip
              entry={p.entry_price}
              sl={p.sl_wide_price}
              tp1={p.tp1_price}
              tp2={p.tp2_price}
              current={current}
            />

            <div
              className="mono"
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 11,
                color: "var(--ink-faint)",
                marginTop: 4,
              }}
            >
              <span style={{ color: "var(--down)" }}>SL Rp{formatIDR(p.sl_wide_price)}</span>
              <span style={{ color: "var(--up)" }}>TP1 Rp{formatIDR(p.tp1_price)}</span>
              <span>TP2 Rp{formatIDR(p.tp2_price)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
