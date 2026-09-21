import { formatIDR, pctTone } from "@/lib/format-dashboard";

interface RangeBarProps {
  sl: number;
  entry: number;
  tp1: number;
  tp2: number;
  current: number | null;
}

const clamp = (v: number) => Math.min(100, Math.max(0, v));

/**
 * Jalur harga dari SL sampai TP2. Semua penanda dan label diletakkan
 * tepat di persentase harganya, jadi label selalu sejajar dengan tandanya.
 */
export default function RangeBar({ sl, entry, tp1, tp2, current }: RangeBarProps) {
  const range = tp2 - sl;
  if (range <= 0) return null;

  const pos = (v: number) => clamp(((v - sl) / range) * 100);
  const entryPos = pos(entry);
  const tp1Pos = pos(tp1);
  const nowPos = current !== null ? pos(current) : null;
  const tone = current !== null ? pctTone(current - entry) : "flat";

  const labels = [
    { name: "SL", value: sl, at: 0, align: "start" },
    { name: "Entry", value: entry, at: entryPos, align: "mid" },
    { name: "TP1", value: tp1, at: tp1Pos, align: "mid" },
    { name: "TP2", value: tp2, at: 100, align: "end" },
  ] as const;

  const summary = `SL ${formatIDR(sl)}, entry ${formatIDR(entry)}, TP1 ${formatIDR(tp1)}, TP2 ${formatIDR(tp2)}${
    current !== null ? `, harga kini ${formatIDR(current)}` : ""
  }`;

  return (
    <div className="range" role="img" aria-label={summary}>
      <div className="range-track">
        <span className="range-zone range-zone-loss" style={{ width: `${entryPos}%` }} />
        <span className="range-zone range-zone-gain" style={{ left: `${entryPos}%` }} />
        {nowPos !== null && (
          <span
            className={`range-fill range-fill-${tone}`}
            style={{
              left: `${Math.min(entryPos, nowPos)}%`,
              width: `${Math.abs(nowPos - entryPos)}%`,
            }}
          />
        )}
        <span className="range-tick" style={{ left: `${tp1Pos}%` }} />
        <span className="range-tick range-tick-entry" style={{ left: `${entryPos}%` }} />
        {nowPos !== null && (
          <span className={`range-now range-now-${tone}`} style={{ left: `${nowPos}%` }} />
        )}
      </div>
      <div className="range-labels" aria-hidden="true">
        {labels.map((l) => (
          <span key={l.name} className={`range-label range-label-${l.align}`} style={{ left: `${l.at}%` }}>
            <span className="range-label-name">{l.name}</span>
            <span className="range-label-value num">{formatIDR(l.value)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
