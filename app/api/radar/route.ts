import { NextResponse } from "next/server";
import { getTopVolumeCoins } from "@/lib/indodax";
import { buildRadarMessage } from "@/lib/format";
import { sendTelegramMessage } from "@/lib/telegram";

// Vercel Cron mengirim GET request ke endpoint ini sesuai jadwal
// di vercel.json. Route ini juga bisa dites manual lewat browser
// atau curl selama development.
export async function GET(request: Request) {
  // Vercel Cron mengirim header khusus ini di setiap panggilan cron
  // asli. Kita cek ini biar endpoint gak sembarangan dipanggil orang
  // lain dan bikin bot spam ke channel.
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (cronSecret) {
    // CRON_SECRET sudah di-set (kondisi normal production) -> WAJIB cocok,
    // gak ada bypass apapun. Ini gerbang utama keamanan endpoint ini.
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV !== "development") {
    // CRON_SECRET belum di-set SAMA SEKALI, dan ini bukan development lokal.
    // Ini kondisi salah konfigurasi -> tolak, jangan biarkan lolos.
    // Kalau lolos, endpoint ini kebuka publik tanpa proteksi apapun.
    console.error(
      "CRON_SECRET belum di-set di environment variables. Endpoint ditolak demi keamanan."
    );
    return NextResponse.json(
      { error: "Server misconfigured: CRON_SECRET is not set" },
      { status: 500 }
    );
  }
  // Sisa kasus: CRON_SECRET belum di-set DAN NODE_ENV === "development"
  // -> ini development lokal yang belum sempat setup .env.local, lolos.

  try {
    const topCoins = await getTopVolumeCoins(5);
    const message = buildRadarMessage(topCoins);
    await sendTelegramMessage(message);

    return NextResponse.json({
      success: true,
      sentAt: new Date().toISOString(),
      coins: topCoins,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Radar gagal jalan:", message);

    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
