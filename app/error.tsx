"use client";

import { useEffect } from "react";

export default function ErrorState({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main id="konten" className="wrap">
      <div className="shell">
        <div className="empty">
          <span className="empty-rings" aria-hidden="true" />
          <h2>Data belum bisa dimuat</h2>
          <p>Koneksi ke database gagal. Coba lagi sebentar.</p>
          <button type="button" className="btn" onClick={reset}>
            Muat ulang
          </button>
        </div>
      </div>
    </main>
  );
}
