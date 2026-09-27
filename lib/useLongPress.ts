"use client";

import { useCallback, useRef, useState } from "react";

const PRESS_DURATION_MS = 400;

/**
 * Long-press detector berbasis Pointer Events (jalan di sentuh & mouse
 * sekaligus). Alasan pakai tahan-klik, bukan tap biasa: modal detail
 * sinyal butuh render satu frame overlay solid sebelum keliatan aman
 * dari list di belakangnya - kalau langsung buka saat tap turun, ada
 * jendela render yang bikin list lama sempat nembus sekilas. Tahan
 * 400ms ngasih waktu browser commit paint dulu, plus niat user makin
 * jelas (bukan salah senggol pas scroll).
 *
 * progress 0-1 dipakai buat lingkaran/bar visual biar user tau lagi
 * ditahan, bukan macet.
 */
export function useLongPress(onLongPress: () => void) {
  const [pressing, setPressing] = useState(false);
  const [progress, setProgress] = useState(0);
  const timerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setPressing(false);
    setProgress(0);
  }, []);

  const tick = useCallback(() => {
    const elapsed = Date.now() - startRef.current;
    setProgress(Math.min(1, elapsed / PRESS_DURATION_MS));
    if (elapsed < PRESS_DURATION_MS) {
      rafRef.current = window.requestAnimationFrame(tick);
    }
  }, []);

  const start = useCallback(() => {
    setPressing(true);
    startRef.current = Date.now();
    rafRef.current = window.requestAnimationFrame(tick);
    timerRef.current = window.setTimeout(() => {
      onLongPress();
      clear();
    }, PRESS_DURATION_MS);
  }, [onLongPress, tick, clear]);

  return {
    pressing,
    progress,
    handlers: {
      onPointerDown: start,
      onPointerUp: clear,
      onPointerLeave: clear,
      onPointerCancel: clear,
    },
  };
}
