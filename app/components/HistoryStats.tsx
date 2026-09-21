import type { SignalOutcomeRow } from "@/lib/supabase-public";
import { formatIDR, formatNumber, formatPct, pctTone, timeAgo } from "@/lib/format-dashboard";
import Sparkline from "./Sparkline";

type OutcomeTone = "up" | "down" | "warn" | "flat";

function outcomeTone(outcome: string | null): OutcomeTone {
  if (!outcome) return "flat";
  if (outcome.startsWith("tp")) return "up";
  if (outcome === "sl") return "down";
  return "warn"; // timeout
}

function outcomeLabel(outcome: string | null): string {
  if (!outcome) return "-";
  if (outcome === "tp1") return "TP1";
  if (outcome === "tp2") return "TP2";
  if (outcome === "tp3") return "TP3";
  if (outcome === "sl") return "SL";
  if (outcome === "timeout") return "Timeout";
  return outcome;
}

const STRIP_MAX = 40;

export default function HistoryStats({ signals }: { signals: SignalOutcomeRow[] }) {
  if (signals.length === 0) {
    return (
      <div className="empty">
        <span className="empty-rings" aria-hidden="true" />
        <h2>Belum ada sinyal selesai</h2>
        <p>Hasil muncul di sini setelah sinyal kena TP, SL, atau habis waktu.</p>
      </div>
    );
  }

  // Statistik dihitung dari outcome_wide (SL -5%), lebih representatif untuk trading real
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
  // CST bisa tercatat puluhan kali karena harganya naik turun lewat batas TP/SL,
  // padahal itu satu koin. Hitung berapa koin unik supaya pembaca tidak salah
  // mengira ini puluhan koin berbeda.
  const uniqueCoins = new Set(signals.map((s) => s.symbol)).size;
  const wins = (counts.tp1 ?? 0) + (counts.tp2 ?? 0) + (counts.tp3 ?? 0);
  const losses = counts.sl ?? 0;
  const timeouts = counts.timeout ?? 0;
  const winRate = (wins / total) * 100;
  const avgPnl = pnlCount > 0 ? totalPnl / pnlCount : 0;

  // Urutan waktu (lama ke baru) untuk deret hasil dan P&L kumulatif
  const chrono = [...signals].sort(
    (a, b) =>
      Date.parse(a.closed_at ?? a.signaled_at) - Date.parse(b.closed_at ?? b.signaled_at)
  );
  let running = 0;
  const cumulative = [0, ...chrono.map((s) => (running += s.pnl_wide_pct ?? 0))];
  const strip = chrono.slice(-STRIP_MAX);

  const legend: { label: string; n: number; tone: OutcomeTone }[] = [
    { label: "TP1", n: counts.tp1 ?? 0, tone: "up" },
    { label: "TP2", n: counts.tp2 ?? 0, tone: "up" },
    { label: "TP3", n: counts.tp3 ?? 0, tone: "up" },
    { label: "Timeout", n: timeouts, tone: "warn" },
    { label: "SL", n: losses, tone: "down" },
  ];

  return (
    <div className="stack stagger">
      <section className="stats" aria-label="Ringkasan hasil sinyal">
        <div className="stat-card stat-card-wide">
          <p className="stat-label">Win rate</p>
          <p className={`stat-value num ${winRate >= 50 ? "tone-up" : "tone-down"}`}>
            {formatNumber(winRate, 1)}%
          </p>
          <p className="stat-note">
            {wins} menang, {losses} kalah
            {timeouts > 0 ? `, ${timeouts} timeout` : ""} dari {total} sinyal selesai
            {uniqueCoins < total ? ` (${uniqueCoins} koin, sebagian muncul berulang)` : ""}
          </p>

          <div
            className="strip"
            role="img"
            aria-label={`Hasil ${strip.length} sinyal terakhir dari yang terlama ke terbaru`}
          >
            {strip.map((s) => (
              <span
                key={s.id}
                className={`strip-cell strip-${outcomeTone(s.outcome_wide)}`}
                title={`${s.symbol} ${outcomeLabel(s.outcome_wide)} ${
                  s.pnl_wide_pct !== null ? formatPct(s.pnl_wide_pct) : ""
                }`}
              />
            ))}
          </div>
          <div className="strip-axis" aria-hidden="true">
            <span>Lama</span>
            <span>Baru</span>
          </div>

          <ul className="legend">
            {legend
              .filter((l) => l.n > 0)
              .map((l) => (
                <li key={l.label}>
                  <span className={`legend-dot legend-${l.tone}`} aria-hidden="true" />
                  {l.label} <span className="num">{l.n}</span>
                </li>
              ))}
          </ul>
        </div>

        <div className="stat-card">
          <p className="stat-label">P&amp;L rata-rata per sinyal</p>
          <p className={`stat-value stat-value-sm num tone-${pctTone(avgPnl)}`}>
            {formatPct(avgPnl)}
          </p>
        </div>

        <div className="stat-card">
          <p className="stat-label">P&amp;L kumulatif</p>
          <p className={`stat-value stat-value-sm num tone-${pctTone(totalPnl)}`}>
            {formatPct(totalPnl)}
          </p>
          <Sparkline
            stretch
            height={34}
            width={200}
            values={cumulative}
            label="Kurva P&L kumulatif"
            className={`tone-${pctTone(totalPnl)}`}
          />
        </div>
      </section>

      <section aria-labelledby="hist-title">
        <h2 id="hist-title" className="section-title">
          Sinyal selesai
        </h2>
        <p className="section-note">
          Hasil memakai skenario SL lebar (-5%). Ini simulasi tanpa biaya trading dan pajak,
          jadi hasil nyata lebih rendah.
        </p>
        <ul className="hist">
          {signals.map((s) => {
            const pnl = s.pnl_wide_pct;
            return (
              <li key={s.id} className="hist-row">
                <span className={`badge badge-${outcomeTone(s.outcome_wide)}`}>
                  {outcomeLabel(s.outcome_wide)}
                </span>
                <div className="hist-main">
                  <p className="hist-symbol">{s.symbol}</p>
                  <p className="hist-sub">
                    Entry <span className="num">Rp{formatIDR(s.entry_price)}</span>
                  </p>
                </div>
                <div className="hist-side">
                  <p className={`hist-pnl num tone-${pctTone(pnl)}`}>
                    {pnl !== null ? formatPct(pnl) : "-"}
                  </p>
                  <p className="hist-time">{s.closed_at ? timeAgo(s.closed_at) : "-"}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
