/**
 * Kirim pesan ke channel Telegram lewat Bot API.
 *
 * Butuh 2 environment variable di Vercel:
 * - TELEGRAM_BOT_TOKEN: token dari @BotFather
 * - TELEGRAM_CHAT_ID: chat ID channel tujuan (biasanya diawali -100)
 *
 * JANGAN pernah hardcode token/chat ID langsung di kode ini —
 * selalu lewat env var, biar gak kebocor kalau di-push ke GitHub.
 */
export async function sendTelegramMessage(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

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
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Gagal kirim pesan ke Telegram: ${res.status} ${res.statusText} — ${body}`
    );
  }
}
