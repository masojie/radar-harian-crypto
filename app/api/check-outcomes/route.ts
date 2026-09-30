import { NextResponse } from "next/server";
import { checkOpenOutcomes } from "@/lib/outcome";

// Dipanggil scheduler eksternal (cron-job.org) tiap 5 menit - cek semua
// posisi open, tutup kalau kena TP/SL atau timeout 24 jam. Tanpa endpoint
// ini posisi lama gak pernah tertutup, jadi coin yang pernah kesignal
// permanen keblokir "posisi_masih_terbuka" di gate (lihat lib/outcome.ts
// dan fungsi try_insert_signal di Supabase).
export const maxDuration = 60;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== "Bearer " + cronSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV !== "development") {
    // Fail-closed (sama seperti route /api/radar): CRON_SECRET belum di-set di
    // production = salah konfigurasi, tolak. Dulu dibiarkan lolos, jadi kalau env
    // ini terhapus endpoint jadi kebuka untuk siapa saja.
    console.error("CRON_SECRET belum di-set, endpoint ditolak demi keamanan.");
    return NextResponse.json({ error: "Server misconfigured: CRON_SECRET is not set" }, { status: 500 });
  }

  try {
    const result = await checkOpenOutcomes();
    return NextResponse.json({ ok: true, ...result });
  } catch (error: any) {
    console.error("Check-outcomes fail:", error?.message);
    return NextResponse.json({ ok: false, error: error?.message }, { status: 500 });
  }
}
