// /api/telegram.js — process-first (balas ke Telegram setelah kirim DM)
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("OK"); // GET test
  }

  try {
    const update = req.body || {};
    console.log("INBOUND", JSON.stringify(update));

    const msg = update.message || update.callback_query?.message;
    if (!msg) {
      return res.status(200).send("OK"); // no-op
    }

    const chatId = msg.chat.id;
    const text = (update.message?.text || "").trim();
    const token = process.env.BOT_TOKEN;

    if (!token) {
      console.error("NO_BOT_TOKEN_ENV");
      return res.status(500).send("NO_BOT_TOKEN");
    }

    const body = new URLSearchParams({
      chat_id: String(chatId),
      text: `echo: ${text || "(no text)"}`
    });

    console.log("OUTBOUND → sendMessage");
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      body
    });
    const j = await r.json().catch(() => ({}));
    console.log("OUTBOUND RESULT", r.status, JSON.stringify(j));

    // Baru kirim 200 ke Telegram
    return res.status(200).send("OK");
  } catch (e) {
    console.error("TELEGRAM_HANDLER_ERR", e);
    return res.status(200).send("OK"); // tetap 200 supaya Telegram tidak retry
  }
}

export const config = { api: { bodyParser: { sizeLimit: "1mb" } } };
