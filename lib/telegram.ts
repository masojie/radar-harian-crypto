/**
 * Kirim pesan lewat Telegram Bot API.
 *
 * Butuh environment variable TELEGRAM_BOT_TOKEN di Vercel (token dari
 * @BotFather). JANGAN pernah hardcode token langsung di kode ini —
 * selalu lewat env var, biar gak kebocor kalau di-push ke GitHub.
 *
 * @param text - isi pesan (format Markdown)
 * @param targetChatId - chat ID tujuan. Kalau dikosongkan, pakai
 *   TELEGRAM_CHAT_ID dari env var (perilaku lama, buat kirim ke channel
 *   radar harian). Diisi eksplisit dipakai webhook buat balas ke chat
 *   ID pengirim pesan, yang beda-beda tiap user.
 * @param options.silent - true = kirim tanpa bunyi notifikasi
 */
export async function sendTelegramMessage(
  text: string,
  targetChatId?: string,
  options?: { silent?: boolean }
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = targetChatId ?? process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN atau TELEGRAM_CHAT_ID belum diset di environment variables"
    );
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      // Senyap: pesan tetap masuk, tapi HP tidak bunyi/getar. Dipakai
      // untuk heartbeat. Default false = perilaku lama tidak berubah.
      disable_notification: options?.silent === true,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Gagal kirim pesan ke Telegram: ${res.status} ${res.statusText} — ${body}`
    );
  }
}
