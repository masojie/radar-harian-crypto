import type { CoinTrack, RadarView, TrackTargets } from "@/lib/radar-view";
import { STATUS_LABEL, buildTargets } from "@/lib/radar-view";
import type { SignalOutcomeRow } from "@/lib/supabase-public";
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
import { RSI_OVERSOLD_THRESHOLD, SCAN_MAX_VOLUME_IDR, SCAN_MIN_VOLUME_IDR } from "@/lib/thresholds";
import RsiGauge from "./RsiGauge";
import Sparkline from "./Sparkline";

function detectionCount(track: CoinTrack): string {
  if (track.count <= 1) return "1x";
  const span = Date.parse(track.lastSeenAt) - Date.parse(track.firstSeenAt);
  return `${track.count}x dalam ${formatSpan(span)}`;
}

function Hero({ track, stale, targets }: { track: CoinTrack; stale: boolean; targets: TrackTargets }) {
  const { latest } = track;
  const zone = rsiZone(latest.rsi);

  return (
    <article className="hero" aria-labelledby="hero-symbol">
      <span className="hero-rings" aria-hidden="true" />

      <div className="hero-top">
        <p className="hero-kicker">
          {stale
            ? `Terakhir terdeteksi ${timeAgo(track.lastSeenAt)}`
            : "RSI terendah di scan terakhir"}
        </p>
        <div className="hero-chips">
          {!stale && (
            <span className={track.status === "sinyal" ? "chip chip-signal" : "chip"}>
              {STATUS_LABEL[track.status]}
            </span>
          )}
          <span className={stale ? "chip chip-neutral" : `chip chip-${zone}`}>
            {stale ? "Sudah lewat" : rsiZoneLabel(zone)}
          </span>
        </div>
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
          <p className="trend-label">Jejak RSI per jam</p>
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

      {targets.rows.length > 0 && (
        <div className="levels">
          <h3 className="levels-title">Target dan level</h3>
          <ul className="levels-list">
            {targets.rows.map((l) => (
              <li key={l.name}>
                <span className="level-name">{l.name}</span>
                <span className="level-main">
                  <span className="num">Rp{formatIDR(l.price)}</span>
                  <span className="level-touch">{l.note}</span>
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
            ? `Terdeteksi ${detectionCount(track)} · ${STATUS_LABEL[track.status]}`
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
  const volumeMin = SCAN_MIN_VOLUME_IDR / 1_000_000;
  const volumeMax = SCAN_MAX_VOLUME_IDR / 1_000_000;
  return (
    <div className="empty empty-inline" role="status">
      <span className="empty-rings" aria-hidden="true" />
      <h2>Tidak ada coin oversold sekarang</h2>
      <p>
        {`Scan jalan tiap 5 menit dan hanya menyimpan coin dengan RSI 1 jam di bawah ${RSI_OVERSOLD_THRESHOLD} (volume 24 jam Rp${volumeMin}-${volumeMax} juta).`}
        {latestScanAt ? ` Coin oversold terakhir terdeteksi ${timeAgo(latestScanAt)}.` : ""}
      </p>
    </div>
  );
}

export default function RadarTable({
  view,
  openBySymbol = new Map<string, SignalOutcomeRow>(),
}: {
  view: RadarView;
  openBySymbol?: ReadonlyMap<string, SignalOutcomeRow>;
}) {
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
  const targets = buildTargets(lead, openBySymbol);

  return (
    <div className="stack stagger">
      {view.stale && <QuietBanner latestScanAt={view.latestScanAt} />}
      <Hero track={lead} stale={view.stale} targets={targets} />

      {rest.length > 0 && (
        <section aria-labelledby="track-title">
          <h2 id="track-title" className="section-title">
            Coin lain yang terpantau
          </h2>
          <p className="section-note">
            {`Dikelompokkan per coin dari ${view.sampleCount} pembacaan scan ${
              view.windowHours ? `dalam ${view.windowHours} jam terakhir` : "terakhir"
            }.`}
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
