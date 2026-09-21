import type { CoinTrack, RadarView } from "@/lib/radar-view";
import {
  distancePct,
  formatIDR,
  formatPct,
  formatRsi,
  formatSpan,
  pctTone,
  rsiZone,
  rsiZoneLabel,
  timeAgo,
} from "@/lib/format-dashboard";
import RsiGauge from "./RsiGauge";
import Sparkline from "./Sparkline";

function detectionCount(track: CoinTrack): string {
  if (track.count <= 1) return "1x";
  const span = Date.parse(track.lastSeenAt) - Date.parse(track.firstSeenAt);
  return `${track.count}x dalam ${formatSpan(span)}`;
}

function Hero({ track, stale }: { track: CoinTrack; stale: boolean }) {
  const { latest } = track;
  const zone = rsiZone(latest.rsi);

  const levels = [
    { name: "TP1", price: latest.tp1_price, touches: latest.tp1_touches },
    { name: "TP2", price: latest.tp2_price, touches: latest.tp2_touches },
  ].filter(
    (l): l is { name: string; price: number; touches: number | null } => l.price !== null
  );

  return (
    <article className="hero" aria-labelledby="hero-symbol">
      <span className="hero-rings" aria-hidden="true" />

      <div className="hero-top">
        <p className="hero-kicker">
          {stale
            ? `Terakhir terdeteksi ${timeAgo(track.lastSeenAt)}`
            : "RSI terendah di scan terakhir"}
        </p>
        <span className={stale ? "chip chip-neutral" : `chip chip-${zone}`}>
          {stale ? "Sudah lewat" : rsiZoneLabel(zone)}
        </span>
      </div>

      <div className="hero-main">
        <h2 id="hero-symbol" className="hero-symbol">
          {track.symbol}
          <span className="hero-pair">/IDR</span>
        </h2>
        <p className={`hero-rsi num zone-${zone}`}>
          <span className="sr-only">RSI </span>
          {formatRsi(latest.rsi)}
        </p>
      </div>

      <RsiGauge rsi={latest.rsi} />

      <dl className="facts">
        <div>
          <dt>Harga</dt>
          <dd className="num">Rp{formatIDR(latest.price)}</dd>
        </div>
        <div>
          <dt>Terdeteksi</dt>
          <dd>{detectionCount(track)}</dd>
        </div>
        <div>
          <dt>Sejak pertama</dt>
          <dd className={`num tone-${pctTone(track.priceChangePct)}`}>
            {track.count > 1 ? formatPct(track.priceChangePct) : "Baru muncul"}
          </dd>
        </div>
      </dl>

      {track.rsiSeries.length > 1 && (
        <div className="hero-trend">
          <p className="trend-label">Jejak RSI</p>
          <Sparkline
            stretch
            height={44}
            width={320}
            values={track.rsiSeries}
            label={`Jejak RSI ${track.symbol}`}
            className={`zone-${zone}`}
          />
        </div>
      )}

      {levels.length > 0 && (
        <div className="levels">
          <h3 className="levels-title">Level resisten mingguan</h3>
          <ul className="levels-list">
            {levels.map((l) => (
              <li key={l.name}>
                <span className="level-name">{l.name}</span>
                <span className="level-main">
                  <span className="num">Rp{formatIDR(l.price)}</span>
                  {l.touches !== null && <span className="level-touch">{l.touches}x disentuh</span>}
                </span>
                <span className="level-dist num">{formatPct(distancePct(latest.price, l.price))}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

function TrackRow({ track }: { track: CoinTrack }) {
  const zone = rsiZone(track.latest.rsi);

  return (
    <li className={track.active ? "track" : "track track-past"}>
      <div className="coin">
        <p className="coin-symbol">
          {track.active && (
            <>
              <span className="live-dot" aria-hidden="true" />
              <span className="sr-only">Aktif di scan terakhir. </span>
            </>
          )}
          {track.symbol}
        </p>
        <p className="coin-meta">
          {track.active
            ? `Terdeteksi ${detectionCount(track)}`
            : `Terakhir ${timeAgo(track.lastSeenAt)}, ${track.count}x`}
        </p>
      </div>

      <div className="track-trend">
        <Sparkline
          values={track.rsiSeries}
          label={`Jejak RSI ${track.symbol}`}
          className={`zone-${zone}`}
        />
      </div>

      <div className="rsi-cell">
        <p className={`rsi-value num zone-${zone}`}>{formatRsi(track.latest.rsi)}</p>
        <p className="rsi-price num">Rp{formatIDR(track.latest.price)}</p>
      </div>
    </li>
  );
}

function QuietBanner({ latestScanAt }: { latestScanAt: string | null }) {
  return (
    <div className="empty empty-inline" role="status">
      <span className="empty-rings" aria-hidden="true" />
      <h2>Tidak ada coin oversold sekarang</h2>
      <p>
        Scan jalan tiap 5 menit dan hanya menyimpan coin dengan RSI di bawah 35.
        {latestScanAt ? ` Sinyal terakhir masuk ${timeAgo(latestScanAt)}.` : ""}
      </p>
    </div>
  );
}

export default function RadarTable({ view }: { view: RadarView }) {
  if (view.tracks.length === 0) {
    return (
      <div className="empty">
        <span className="empty-rings" aria-hidden="true" />
        <h2>Belum ada sinyal masuk</h2>
        <p>Scan berjalan otomatis. Coin yang RSI-nya turun ke zona jenuh jual akan muncul di sini.</p>
      </div>
    );
  }

  const [lead, ...rest] = view.tracks;

  return (
    <div className="stack stagger">
      {view.stale && <QuietBanner latestScanAt={view.latestScanAt} />}
      <Hero track={lead} stale={view.stale} />

      {rest.length > 0 && (
        <section aria-labelledby="track-title">
          <h2 id="track-title" className="section-title">
            Coin lain yang terpantau
          </h2>
          <p className="section-note">
            Dikelompokkan per coin dari {view.sampleCount} pembacaan sinyal terakhir.
          </p>
          <ul className="tracks">
            {rest.map((track) => (
              <TrackRow key={track.symbol} track={track} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
