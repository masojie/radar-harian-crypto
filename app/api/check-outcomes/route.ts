import { NextResponse } from "next/server";
import { checkOpenOutcomes } from "@/lib/outcome";

/**
 * Dipanggil scheduler eksternal (cron-job.org) tiap 15 menit.
 * Cek semua posisi sinyal yang masih open: kena TP atau SL duluan,
 * atau sudah timeout 24 jam. Hasil ditulis ke tabel signal_outcomes.
 *
 * Keamanan sama seperti /api/scan-notify: wajib header
 * Authorization: Bearer <CRON_SECRET>.
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const result = await checkOpenOutcomes();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("check-outcomes gagal:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
