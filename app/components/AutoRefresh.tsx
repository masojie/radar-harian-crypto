"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Muat ulang data server component secara berkala selama tab terlihat,
 * supaya keterangan "2m lalu" dan harga di posisi aktif tidak basi.
 * State klien (tab yang dipilih) tetap terjaga.
 */
export default function AutoRefresh({ everyMs = 60_000 }: { everyMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
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
