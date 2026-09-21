import type { SignalOutcomeRow } from "@/lib/supabase-public";
import { distancePct, formatIDR, formatPct, pctTone, timeAgo } from "@/lib/format-dashboard";
import RangeBar from "./RangeBar";

interface Props {
  positions: SignalOutcomeRow[];
  latestPrices: Map<string, number>;
}

export default function OpenPositions({ positions, latestPrices }: Props) {
  if (positions.length === 0) {
    return (
      <div className="empty">
        <span className="empty-rings" aria-hidden="true" />
        <h2>Tidak ada posisi terbuka</h2>
        <p>Sinyal baru dari scan otomatis masuk ke sini sampai kena TP, SL, atau habis waktu.</p>
      </div>
    );
  }

  const rows = positions.map((p) => {
    const current = latestPrices.get(p.symbol) ?? null;
    const change = current !== null ? distancePct(p.entry_price, current) : null;
    return { p, current, change };
  });

  const changes = rows.flatMap((r) => (r.change === null ? [] : [r.change]));
  const avg = changes.length > 0 ? changes.reduce((a, b) => a + b, 0) / changes.length : null;
  const gaining = changes.filter((c) => pctTone(c) === "up").length;
  const losing = changes.filter((c) => pctTone(c) === "down").length;

  return (
    <div className="stack stagger">
      <dl className="summary">
        <div>
          <dt>Posisi terbuka</dt>
          <dd className="num">{positions.length}</dd>
        </div>
        <div>
          <dt>Rata-rata berjalan</dt>
          <dd className={`num tone-${pctTone(avg)}`}>{avg !== null ? formatPct(avg) : "-"}</dd>
        </div>
        <div>
          <dt>Naik / turun</dt>
          <dd className="num">
            <span className="tone-up">{gaining}</span>
            <span className="summary-sep"> / </span>
            <span className="tone-down">{losing}</span>
          </dd>
        </div>
      </dl>

      <div className="pos-grid">
        {rows.map(({ p, current, change }) => {
          const toTp1 = current !== null ? distancePct(current, p.tp1_price) : null;
          const toSl = current !== null ? distancePct(current, p.sl_wide_price) : null;

          return (
            <article key={p.id} className="pos">
              <header className="pos-head">
                <div>
                  <h3 className="pos-symbol">{p.symbol}</h3>
                  <p className="pos-sub">
                    Entry <span className="num">Rp{formatIDR(p.entry_price)}</span>, dibuka{" "}
                    {timeAgo(p.signaled_at)}
                  </p>
                </div>
                <p className={`pos-pnl num tone-${pctTone(change)}`}>
                  {change !== null ? formatPct(change) : "-"}
                </p>
              </header>

              <RangeBar
                sl={p.sl_wide_price}
                entry={p.entry_price}
                tp1={p.tp1_price}
                tp2={p.tp2_price}
                current={current}
              />

              <dl className="pos-foot">
                <div>
                  <dt>Harga kini</dt>
                  <dd className="num">{current !== null ? `Rp${formatIDR(current)}` : "-"}</dd>
                </div>
                <div>
                  <dt>Ke TP1</dt>
                  <dd className="num tone-up">{toTp1 !== null ? formatPct(toTp1) : "-"}</dd>
                </div>
                <div>
                  <dt>Ke SL</dt>
                  <dd className="num tone-down">{toSl !== null ? formatPct(toSl) : "-"}</dd>
                </div>
              </dl>
            </article>
          );
        })}
      </div>
    </div>
  );
}
