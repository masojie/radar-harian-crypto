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

// Lebar bar level relatif terhadap TP3 (level terjauh dari entry),
// supaya proporsi antar level tetap masuk akal secara visual.
function barWidthPct(pct: number, maxPct: number): number {
  return Math.min(100, Math.max(4, (Math.abs(pct) / maxPct) * 100));
}

export default function HistorySignalDetail({
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
    { label: "TP1", price: signal.tp1_price, hit: checkHit(signal.tp1_price, high, low, false), tone: "up", pct: 5 },
    { label: "TP2", price: signal.tp2_price, hit: checkHit(signal.tp2_price, high, low, false), tone: "up", pct: 10 },
    { label: "TP3", price: signal.tp3_price, hit: checkHit(signal.tp3_price, high, low, false), tone: "up", pct: 15 },
    { label: "SL -3%", price: signal.sl_tight_price, hit: checkHit(signal.sl_tight_price, high, low, true), tone: "warn", pct: -3 },
    { label: "SL -5%", price: signal.sl_wide_price, hit: checkHit(signal.sl_wide_price, high, low, true), tone: "down", pct: -5 },
  ];
  const maxPct = Math.max(...levels.map((l) => Math.abs(l.pct)));

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

        <div className="modal-stats-grid">
          <div className="modal-stat-box">
            <span className="modal-stat-label">Entry</span>
            <span className="modal-stat-value num">Rp{formatIDR(entry)}</span>
          </div>
          <div className="modal-stat-box">
            <span className="modal-stat-label">RSI saat sinyal</span>
            <span className={`modal-stat-value num ${signal.rsi_at_signal <= 25 ? "tone-down" : signal.rsi_at_signal <= 40 ? "tone-warn" : ""}`}>
              {formatNumber(signal.rsi_at_signal, 1)}
            </span>
          </div>
          <div className="modal-stat-box">
            <span className="modal-stat-label">Durasi</span>
            <span className="modal-stat-value">{duration(signal)}</span>
          </div>
          <div className="modal-stat-box">
            <span className="modal-stat-label">Volume saat sinyal</span>
            <span className="modal-stat-value num">
              {signal.volume_at_signal !== null ? `Rp${formatIDR(signal.volume_at_signal)}` : "Tidak tersedia"}
            </span>
          </div>
        </div>

        <div className="modal-section">
          <h3 className="modal-section-title"><IconLevels /> Level harga</h3>

          <div className="level-table">
            <div className="level-table-row level-table-entry">
              <span className="level-table-badge">Entry</span>
              <span className="level-table-price num">Rp{formatIDR(entry)}</span>
            </div>
            {levels.map((l) => (
              <div key={l.label} className={`level-table-row${l.hit ? " level-table-row-hit" : ""}`}>
                <span className={`level-table-badge level-table-badge-${l.tone}`}>{l.label}</span>
                <span className="level-table-price num">Rp{formatIDR(l.price)}</span>
                <span className={`level-table-pct num tone-${l.pct > 0 ? "up" : "down"}`}>
                  {l.pct > 0 ? "+" : ""}{l.pct}%
                </span>
                <span className="level-table-bar-wrap">
                  <span
                    className={`level-table-bar level-table-bar-${l.tone}`}
                    style={{ width: `${barWidthPct(l.pct, maxPct)}%` }}
                  />
                </span>
                <span className="level-table-status">{l.hit ? "Kena" : "\u2014"}</span>
              </div>
            ))}
          </div>

          <div className="modal-outcomes-block">
            <h4 className="modal-outcomes-title">Hasil</h4>
            <div className="modal-outcome-box">
              <span className="modal-outcome-box-label">SL ketat (-3%)</span>
              <span className={`modal-outcome-box-value num tone-${pctTone(signal.pnl_tight_pct)}`}>
                {signal.outcome_tight
                  ? `${outcomeLabel(signal.outcome_tight)}${signal.pnl_tight_pct !== null ? ` (${formatPct(signal.pnl_tight_pct)})` : ""}`
                  : "-"}
              </span>
            </div>
            <div className="modal-outcome-box">
              <span className="modal-outcome-box-label">SL lebar (-5%)</span>
              <span className={`modal-outcome-box-value num tone-${pctTone(signal.pnl_wide_pct)}`}>
                {signal.outcome_wide
                  ? `${outcomeLabel(signal.outcome_wide)}${signal.pnl_wide_pct !== null ? ` (${formatPct(signal.pnl_wide_pct)})` : ""}`
                  : "-"}
              </span>
            </div>
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
