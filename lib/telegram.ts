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
 * @param options.replyMarkup - tombol inline keyboard di bawah pesan
 *   (dipakai command bot interaktif, misal /start dan /bantuan)
 */
export async function sendTelegramMessage(
  text: string,
  targetChatId?: string,
  options?: { silent?: boolean; replyMarkup?: Record<string, unknown> }
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
      ...(options?.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Gagal kirim pesan ke Telegram: ${res.status} ${res.statusText} — ${body}`
    );
  }
}

/**
 * Kirim "ack" ke Telegram setelah tombol inline keyboard ditekan.
 *
 * WAJIB dipanggil tiap ada callback_query masuk — kalau tidak, tombol
 * di HP user nampilin loading spinner sampai timeout sendiri.
 *
 * @param callbackQueryId - id dari body.callback_query.id
 * @param text - opsional, toast kecil yang muncul sekilas di HP user
 */
export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  const url = `https://api.telegram.org/bot${token}/answerCallbackQuery`;

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        ...(text ? { text } : {}),
      }),
    });
  } catch (e) {
    // Non-fatal: kalau gagal, tombol cuma keliatan loading lebih lama,
    // gak perlu bikin request utama ikut gagal gara-gara ini.
    console.error("answerCallbackQuery fail:", (e as Error)?.message);
  }
}
