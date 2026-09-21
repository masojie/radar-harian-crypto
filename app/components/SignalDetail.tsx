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

function IconOutcome() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="section-icon" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="8" cy="8" r="2.5" fill="currentColor" />
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
  tone: "up" | "down" | "warn" | "flat";
  pct: number;
}

function LevelBar({ row, entry, maxPrice }: { row: LevelRow; entry: number; maxPrice: number }) {
  const range = Math.max(maxPrice - entry, entry - row.price, 1);
  const fillPct = Math.min(100, Math.abs((entry - row.price) / range) * 100);
  return (
    <div className={`level-row ${row.hit ? "level-hit" : ""}`}>
      <span className={`level-badge level-${row.tone}`}>{row.label}</span>
      <span className="level-price">Rp{formatIDR(row.price)}</span>
      <span className={`level-pct num tone-${row.pct > 0 ? "up" : row.pct < 0 ? "down" : "flat"}`}>
        {row.pct > 0 ? "+" : ""}{row.pct.toFixed(0)}%
      </span>
      <div className="level-bar-track">
        <div className={`level-bar-fill level-fill-${row.tone}`} style={{ width: `${fillPct}%` }} />
      </div>
      <span className={`level-status level-status-${row.tone} ${row.hit ? "" : "level-status-miss"}`}>
        {row.hit ? "HIT" : "\u2014"}
      </span>
    </div>
  );
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

  const activeLevels = [
    ...levels.filter((l) => l.pct > 0).reverse(),
    ...levels.filter((l) => l.pct < 0),
  ];

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

        <div className="modal-info-grid">
          <div className="modal-info-item">
            <span className="modal-info-label">Entry</span>
            <span className="modal-info-value num">Rp{formatIDR(entry)}</span>
          </div>
          <div className="modal-info-item">
            <span className="modal-info-label">RSI saat sinyal</span>
            <span className={`modal-info-value num ${signal.rsi_at_signal <= 25 ? "tone-down" : signal.rsi_at_signal <= 40 ? "tone-warn" : ""}`}>
              {formatNumber(signal.rsi_at_signal, 1)}
            </span>
          </div>
          <div className="modal-info-item">
            <span className="modal-info-label">Durasi</span>
            <span className="modal-info-value">{duration(signal)}</span>
          </div>
        </div>

        <div className="modal-section">
          <h3 className="modal-section-title"><IconLevels /> Level Harga</h3>
          <div className="modal-entry-line">
            <span className="entry-label">Entry</span>
            <span className="entry-value num">Rp{formatIDR(entry)}</span>
          </div>
          {activeLevels.map((l) => (
            <LevelBar key={l.label} row={l} entry={entry} maxPrice={Math.max(signal.tp3_price, high)} />
          ))}
        </div>

        <div className="modal-section">
          <h3 className="modal-section-title"><IconOutcome /> Hasil</h3>
          <div className="modal-outcomes">
            <div className="modal-outcome-card">
              <span className="modal-outcome-label">SL Ketat (-3%)</span>
              <span className={`modal-outcome-value num tone-${pctTone(signal.pnl_tight_pct)}`}>
                {signal.outcome_tight ? outcomeLabel(signal.outcome_tight) : "-"}
                {signal.pnl_tight_pct !== null && ` (${formatPct(signal.pnl_tight_pct)})`}
              </span>
            </div>
            <div className="modal-outcome-card">
              <span className="modal-outcome-label">SL Lebar (-5%)</span>
              <span className={`modal-outcome-value num tone-${pctTone(signal.pnl_wide_pct)}`}>
                {signal.outcome_wide ? outcomeLabel(signal.outcome_wide) : "-"}
                {signal.pnl_wide_pct !== null && ` (${formatPct(signal.pnl_wide_pct)})`}
              </span>
            </div>
          </div>
        </div>

        <div className="modal-section">
          <h3 className="modal-section-title"><IconRange /> Range Harga</h3>
          <div className="modal-range-labels">
            <span className="num">Rp{formatIDR(low)}</span>
            <span className="num">Rp{formatIDR(high)}</span>
          </div>
          <div className="modal-range-bar">
            <div className="modal-range-entry" style={{ left: `${((entry - low) / priceSpan) * 100}%` }} title={`Entry: Rp${formatIDR(entry)}`} />
            <div className="modal-range-high" style={{ left: `${((entry - low) / priceSpan) * 100}%`, width: `${((high - entry) / priceSpan) * 100}%` }} />
          </div>
          <p className="modal-range-note">
            Tertinggi: Rp{formatIDR(high)} \u00b7 Terendah: Rp{formatIDR(low)}
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
