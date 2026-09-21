import type { CSSProperties } from "react";
import {
  RSI_DEEP,
  RSI_OVERSOLD,
  formatRsi,
  rsiZone,
  rsiZoneLabel,
} from "@/lib/format-dashboard";

/** Skala RSI 0-100 dengan zona jenuh jual yang ditandai dan penanda posisi. */
export default function RsiGauge({ rsi }: { rsi: number }) {
  const pct = Math.min(100, Math.max(0, rsi));
  const zone = rsiZone(rsi);

  return (
    <div
      className={`gauge gauge-${zone}`}
      style={{ "--pos": `${pct}%` } as CSSProperties}
      role="img"
      aria-label={`RSI ${formatRsi(rsi)}, ${rsiZoneLabel(zone).toLowerCase()}`}
    >
      <div
        className="gauge-track"
        style={{
          gridTemplateColumns: `${RSI_DEEP}fr ${RSI_OVERSOLD - RSI_DEEP}fr ${100 - RSI_OVERSOLD}fr`,
        }}
      >
        <span className="gauge-zone gauge-zone-deep" />
        <span className="gauge-zone gauge-zone-oversold" />
        <span className="gauge-zone gauge-zone-neutral" />
        <span className="gauge-marker" />
      </div>
      <div className="gauge-scale" aria-hidden="true">
        <span style={{ left: "0%" }}>0</span>
        <span style={{ left: `${RSI_DEEP}%` }}>{RSI_DEEP}</span>
        <span style={{ left: `${RSI_OVERSOLD}%` }}>{RSI_OVERSOLD}</span>
        <span style={{ left: "100%" }}>100</span>
      </div>
    </div>
  );
}
