interface SparklineProps {
  values: number[];
  /** Deskripsi untuk pembaca layar. */
  label: string;
  width?: number;
  height?: number;
  /** Isi lebar penuh container. Garis tetap tipis lewat non-scaling-stroke. */
  stretch?: boolean;
  className?: string;
}

/** Garis tren mini. Warna mengikuti `color` dari elemen induk atau className. */
export default function Sparkline({
  values,
  label,
  width = 96,
  height = 28,
  stretch = false,
  className,
}: SparklineProps) {
  if (values.length < 2) return null;

  const pad = 3;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;

  const points = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (width - pad * 2);
    const y =
      span === 0
        ? height / 2
        : height - pad - ((v - min) / span) * (height - pad * 2);
    return `${x.toFixed(1)} ${y.toFixed(1)}`;
  });

  const line = `M${points.join(" L")}`;
  const area = `${line} L${(width - pad).toFixed(1)} ${height} L${pad} ${height} Z`;

  return (
    <svg
      className={["spark", className].filter(Boolean).join(" ")}
      viewBox={`0 0 ${width} ${height}`}
      width={stretch ? "100%" : width}
      height={height}
      preserveAspectRatio={stretch ? "none" : undefined}
      role="img"
      aria-label={label}
    >
      <path d={area} className="spark-area" />
      <path
        d={line}
        className="spark-line"
        fill="none"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
