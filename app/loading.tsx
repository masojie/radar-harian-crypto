export default function Loading() {
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true" />
            <div className="brand-text">
              <h1>Radar Harian Crypto</h1>
              <p>RSI jenuh jual, spot Indodax</p>
            </div>
          </div>
          <span className="skel skel-status" aria-hidden="true" />
        </div>
      </header>

      <main id="konten" className="wrap" aria-busy="true" aria-label="Memuat data">
        <div className="shell">
          <div className="skel skel-dock" aria-hidden="true" />
          <div className="stack">
            <div className="skel skel-hero" aria-hidden="true" />
            <div className="skel skel-line" aria-hidden="true" />
            <div className="skel skel-row" aria-hidden="true" />
            <div className="skel skel-row" aria-hidden="true" />
            <div className="skel skel-row" aria-hidden="true" />
          </div>
        </div>
      </main>
    </>
  );
}
