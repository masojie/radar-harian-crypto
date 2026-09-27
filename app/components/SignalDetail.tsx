import type { SignalOutcomeRow } from "@/lib/supabase-public";
import { formatIDR, formatNumber, formatPct, pctTone, timeAgo, formatClock } from "@/lib/format-dashboard";

function outcomeTone(outcome: string | null): "up" | "down" | "warn" | "flat" {
  if (!outcome) return "flat";
  if (outcome.startsWith("tp")) return "up";
  if (outcome === "sl") return "down";
  return "warn";
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

function duration(s: SignalOutcomeRow): string {
  const start = Date.parse(s.signaled_at);
  const end = s.closed_at ? Date.parse(s.closed_at) : Date.now();
  const ms = Math.max(0, end - start);
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 1) return "< 1m";
  if (totalMin < 60) return `${totalMin}m`;
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  if (hours < 24) return minutes > 0 ? `${hours}j ${minutes}m` : `${hours}j`;
  const days = Math.floor(hours / 24);
  return `${days}h ${hours % 24}j`;
}

/* --- Inline SVG icons matching the dark panel aesthetic --- */

function IconLevels() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="section-icon" aria-hidden="true">
      <rect x="1" y="12" width="3" height="4" rx="0.5" fill="currentColor" opacity="0.3" />
      <rect x="6.5" y="7" width="3" height="9" rx="0.5" fill="currentColor" opacity="0.55" />
      <rect x="12" y="3" width="3" height="13" rx="0.5" fill="currentColor" />
    </svg>
  );
}

function IconRange() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="section-icon" aria-hidden="true">
      <rect x="0.5" y="0.5" width="15" height="15" rx="2" stroke="currentColor" strokeWidth="1" />
      <rect x="3" y="9" width="4" height="6" rx="0.8" fill="currentColor" opacity="0.35" />
      <rect x="9" y="4" width="4" height="11" rx="0.8" fill="currentColor" />
    </svg>
  );
}

interface LevelRow {
  label: string;
  price: number;
  hit: boolean;
  tone: "up" | "warn" | "down";
  pct: number;
}

function checkHit(price: number, high: number, low: number, isSL: boolean): boolean {
  if (isSL) return low <= price;
  return high >= price;
}

export default function SignalDetail({
  signal,
  onClose,
}: {
  signal: SignalOutcomeRow;
  onClose: () => void;
}) {
  const entry = signal.entry_price;
  const high = signal.max_price ?? entry;
  const low = signal.min_price ?? entry;
  const priceSpan = high - low > 0 ? high - low : 1;

  const levels: LevelRow[] = [
    { label: "TP3", price: signal.tp3_price, hit: checkHit(signal.tp3_price, high, low, false), tone: "up", pct: 15 },
    { label: "TP2", price: signal.tp2_price, hit: checkHit(signal.tp2_price, high, low, false), tone: "up", pct: 10 },
    { label: "TP1", price: signal.tp1_price, hit: checkHit(signal.tp1_price, high, low, false), tone: "up", pct: 5 },
    { label: "SL -3%", price: signal.sl_tight_price, hit: checkHit(signal.sl_tight_price, high, low, true), tone: "warn", pct: -3 },
    { label: "SL -5%", price: signal.sl_wide_price, hit: checkHit(signal.sl_wide_price, high, low, true), tone: "down", pct: -5 },
  ];

  // One shared vertical scale, TP3 at the top to SL -5% at the bottom, so the
  // gutter dots show every level's real proportional distance from entry.
  const railTop = Math.max(signal.tp3_price, entry);
  const railBottom = Math.min(signal.sl_wide_price, entry);
  const railSpan = Math.max(railTop - railBottom, 1);
  const railPos = (price: number) => Math.min(100, Math.max(0, ((railTop - price) / railSpan) * 100));

  const rows = [
    ...levels.map((l) => ({ ...l, kind: "level" as const, key: l.label })),
    { kind: "entry" as const, key: "entry", label: "Entry", price: entry },
  ].sort((a, b) => b.price - a.price);

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={`Detail sinyal ${signal.symbol}`}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <span className={`badge badge-${outcomeTone(signal.outcome_wide)}`}>
              {outcomeLabel(signal.outcome_wide)}
            </span>
            <h2 className="modal-title">{signal.symbol}</h2>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Tutup detail">
            &times;
          </button>
        </div>

        <div className="modal-hero">
          <span className="modal-hero-label">Entry</span>
          <span className="modal-hero-value num">Rp{formatIDR(entry)}</span>
        </div>
        <div className="modal-meta-row">
          <span className="modal-meta-item">
            <span className="modal-meta-label">RSI saat sinyal</span>
            <span className={`modal-meta-value num ${signal.rsi_at_signal <= 25 ? "tone-down" : signal.rsi_at_signal <= 40 ? "tone-warn" : ""}`}>
              {formatNumber(signal.rsi_at_signal, 1)}
            </span>
          </span>
          <span className="modal-meta-item">
            <span className="modal-meta-label">Durasi</span>
            <span className="modal-meta-value">{duration(signal)}</span>
          </span>
          <span className="modal-meta-item">
            <span className="modal-meta-label">Volume saat sinyal</span>
            <span className="modal-meta-value num">
              {signal.volume_at_signal !== null ? `Rp${formatIDR(signal.volume_at_signal)}` : "Tidak tersedia"}
            </span>
          </span>
        </div>

        <div className="modal-section">
          <h3 className="modal-section-title"><IconLevels /> Level harga</h3>

          <div className="rail-wrap">
            <div className="rail-gutter">
              <div className="rail-gutter-line" />
              {rows.map((r) =>
                r.kind === "entry" ? (
                  <span key={r.key} className="rail-tick rail-tick-entry" style={{ top: `${railPos(r.price)}%` }} />
                ) : (
                  <span
                    key={r.key}
                    className={`rail-tick ${r.hit ? `rail-tick-hit rail-tick-${r.tone}` : ""}`}
                    style={{ top: `${railPos(r.price)}%` }}
                  />
                )
              )}
            </div>
            <div>
              {rows.map((r) =>
                r.kind === "entry" ? (
                  <div key={r.key} className="rail-row rail-row-entry">
                    <span className="rail-label">Entry</span>
                    <span className="rail-price num">Rp{formatIDR(r.price)}</span>
                    <span className="rail-pct" />
                    <span className="rail-status" />
                  </div>
                ) : (
                  <div key={r.key} className={`rail-row ${r.hit ? "rail-row-hit" : ""}`}>
                    <span className={`rail-label ${r.hit ? `rail-label-${r.tone}` : ""}`}>{r.label}</span>
                    <span className="rail-price num">Rp{formatIDR(r.price)}</span>
                    <span className={`rail-pct num tone-${r.pct > 0 ? "up" : "down"}`}>
                      {r.pct > 0 ? "+" : ""}{r.pct}%
                    </span>
                    <span className="rail-status">{r.hit ? "Kena" : ""}</span>
                  </div>
                )
              )}
            </div>
          </div>

          <div className="modal-outcomes">
            <p>
              <span className="modal-outcome-label">SL ketat (-3%)</span>
              <span className={`num tone-${pctTone(signal.pnl_tight_pct)}`}>
                {signal.outcome_tight
                  ? `${outcomeLabel(signal.outcome_tight)}${signal.pnl_tight_pct !== null ? ` (${formatPct(signal.pnl_tight_pct)})` : ""}`
                  : "Masih berjalan"}
              </span>
            </p>
            <p>
              <span className="modal-outcome-label">SL lebar (-5%)</span>
              <span className={`num tone-${pctTone(signal.pnl_wide_pct)}`}>
                {signal.outcome_wide
                  ? `${outcomeLabel(signal.outcome_wide)}${signal.pnl_wide_pct !== null ? ` (${formatPct(signal.pnl_wide_pct)})` : ""}`
                  : "Masih berjalan"}
              </span>
            </p>
          </div>
        </div>

        <div className="modal-section">
          <h3 className="modal-section-title"><IconRange /> Range harga</h3>
          <div className="modal-range-labels">
            <span className="num">Rp{formatIDR(low)}</span>
            <span className="num">Rp{formatIDR(high)}</span>
          </div>
          <div className="modal-range-bar">
            <div className="modal-range-entry" style={{ left: `${((entry - low) / priceSpan) * 100}%` }} title={`Entry: Rp${formatIDR(entry)}`} />
            <div className="modal-range-high" style={{ left: `${((entry - low) / priceSpan) * 100}%`, width: `${((high - entry) / priceSpan) * 100}%` }} />
          </div>
          <p className="modal-range-note">
            Tertinggi: Rp{formatIDR(high)} · Terendah: Rp{formatIDR(low)}
          </p>
        </div>

        <div className="modal-section modal-timestamps">
          <p>
            <span className="modal-ts-label">Sinyal:</span>{" "}
            {formatClock(signal.signaled_at)}
          </p>
          {signal.closed_at && (
            <p>
              <span className="modal-ts-label">Selesai:</span>{" "}
              {formatClock(signal.closed_at)} ({timeAgo(signal.closed_at)})
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
