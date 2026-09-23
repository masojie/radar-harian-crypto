import { NextResponse } from "next/server";

/**
 * Endpoint /analisa — analisa multi-timeframe, belum diimplementasikan penuh.
 * Sebelumnya file ini cuma berisi teks placeholder (bukan module valid),
 * jadi bikin `npm run build` gagal terus dan semua commit setelahnya
 * (termasuk update filter volume 200-500jt & scan-notify) gagal deploy.
 * Dikembalikan sebagai stub valid dulu; webhook Telegram belum memanggil
 * endpoint ini (command /analisa belum ada di app/api/webhook/route.ts).
 */
export async function GET() {
  return NextResponse.json({
    status: "not_implemented",
    message: "Fitur /analisa belum diimplementasikan.",
  });
}
