import { NextResponse } from "next/server";

async function sendTG(chatId: number, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as any;
    const msg = body?.message;
    if (!msg?.text || !msg?.chat?.id) return NextResponse.json({ ok: true });

    const chatId = msg.chat.id as number;
    const text = (msg.text as string).trim();
    const lower = text.toLowerCase();

    if (lower === "/start") {
      await sendTG(chatId, "\u{1F916} *Radar Harian Crypto Bot*\n\nBot pemantau pasar crypto Indodax.\nFilter volume: Rp200-500 juta / 24 jam.\n\n/radar - Top volume\n/harga <coin> - Cek harga\n/analisa <coin> - Analisa sinyal\n/bantuan - Bantuan");
      return NextResponse.json({ ok: true });
    }

    if (lower === "/bantuan" || lower === "/help") {
      await sendTG(chatId, "\u{1F4CB} *Daftar Perintah*\n\n/radar - Top 5 volume Indodax (200-500 jt)\n/harga <symbol> - Cek harga coin\n/analisa <symbol> - Analisa sinyal terbaru\n/bantuan - Tampilkan pesan ini");
      return NextResponse.json({ ok: true });
    }

    if (lower === "/radar") {
      try {
        const { getTopVolumeCoins } = await import("@/lib/indodax");
        const { buildRadarMessage } = await import("@/lib/format");
        const coins = await getTopVolumeCoins(5);
        if (coins.length === 0) {
          await sendTG(chatId, "\u{1F4E1} Tidak ada coin dalam range volume Rp200-500 juta saat ini.");
        } else {
          await sendTG(chatId, buildRadarMessage(coins));
        }
      } catch (e: any) {
        await sendTG(chatId, "\u274C Gagal ambil data: " + (e?.message || "unknown"));
      }
      return NextResponse.json({ ok: true });
    }

    if (lower.startsWith("/harga")) {
      const parts = text.split(/\s+/);
      if (parts.length < 2) {
        await sendTG(chatId, "\u2139\uFE0F Gunakan: /harga <coin>\nContoh: /harga btc");
        return NextResponse.json({ ok: true });
      }
      const symbol = parts[1].toUpperCase();
      try {
        const { getTopVolumeCoins } = await import("@/lib/indodax");
        const { buildCoinPriceMessage } = await import("@/lib/format");
        const coins = await getTopVolumeCoins(200);
        const coin = coins.find((c: any) => c.symbol.toUpperCase() === symbol);
        if (!coin) {
          await sendTG(chatId, "\u274C *" + symbol + "* tidak ditemukan di range volume Rp200-500 juta.");
        } else {
          await sendTG(chatId, buildCoinPriceMessage(coin));
        }
      } catch (e: any) {
        await sendTG(chatId, "\u274C Gagal: " + (e?.message || "unknown"));
      }
      return NextResponse.json({ ok: true });
    }

    if (lower.startsWith("/analisa")) {
      const parts = text.split(/\s+/);
      if (parts.length < 2) {
        await sendTG(chatId, "\u2139\uFE0F Gunakan: /analisa <coin>");
        return NextResponse.json({ ok: true });
      }
      const symbol = parts[1].toUpperCase();
      try {
        const { supabasePublic } = await import("@/lib/supabase-public");
        const { data: scans } = await supabasePublic
          .from("bullish_scans")
          .select("*")
          .eq("symbol", symbol)
          .order("scanned_at", { ascending: false })
          .limit(5);

        if (!scans || scans.length === 0) {
          await sendTG(chatId, "\u274C Tidak ada data scan untuk *" + symbol + "*.");
        } else {
          const s = scans[0];
          const fmt = (v: number) =>
            new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(v);

          let msg = "\u{1F4CA} *Analisa " + symbol + "*\n\n";
          msg += "\u{1F4B0} Harga: " + fmt(s.price) + "\n";
          msg += "\u{1F4C8} RSI: " + s.rsi + "\n";
          if (s.tp1_price) msg += "\u{1F3AF} TP1: " + fmt(s.tp1_price) + " (" + (s.tp1_touches || 0) + "x)\n";
          if (s.tp2_price) msg += "\u{1F3AF} TP2: " + fmt(s.tp2_price) + " (" + (s.tp2_touches || 0) + "x)\n";
          if (s.support_price) msg += "\u{1F53B} Support: " + fmt(s.support_price) + " (" + (s.support_touches || 0) + "x)\n";
          msg += "\n\u23F0 " + new Date(s.scanned_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) + " WIB";
          if (s.tolak_alasan) msg += "\n\n\u26A0\uFE0F " + s.tolak_alasan;

          await sendTG(chatId, msg);
        }
      } catch (e: any) {
        await sendTG(chatId, "\u274C Gagal: " + (e?.message || "unknown"));
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("Webhook error:", error?.message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ name: "Radar Harian Crypto Bot", filter: "Volume 200-500 juta IDR", status: "online" });
}
