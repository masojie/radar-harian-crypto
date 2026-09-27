"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Muat ulang data server component secara berkala selama tab terlihat,
 * supaya keterangan "2m lalu" dan harga di posisi aktif tidak basi.
 * State klien (tab yang dipilih) tetap terjaga.
 *
 * DEBOUNCE: interval timer dan event visibilitychange dua-duanya bisa
 * memicu refresh() independen. Kalau balik ke tab kebetulan bertepatan
 * dengan tick interval, dua-duanya bisa nembak dalam hitungan
 * milidetik - refresh dobel yang boros request Supabase/Indodax tanpa
 * manfaat tambahan (data belum sempat berubah dalam <5 detik). Guard
 * ini menolak refresh kalau yang terakhir baru saja terjadi.
 */
const MIN_INTERVAL_MS = 5_000;

export default function AutoRefresh({ everyMs = 60_000 }: { everyMs?: number }) {
  const router = useRouter();
  const lastRefreshRef = useRef(0);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastRefreshRef.current < MIN_INTERVAL_MS) return;
      lastRefreshRef.current = now;
      router.refresh();
    };
    const id = window.setInterval(refresh, everyMs);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router, everyMs]);

  return null;
}
