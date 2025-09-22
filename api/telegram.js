// /api/telegram.js  — echo + logging
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).send("OK");
  // balas dulu biar Telegram gak retry; log sisanya async
  res.status(200).send("OK");

  try {
    const update = req.body || {};
    console.log("INBOUND", JSON.stringify(update));

    const msg = update.message || update.callback_query?.message;
    if (!msg) return;
    const chatId = msg.chat.id;
    const text = (update.message?.text || "").trim();

    const token = process.env.BOT_TOKEN;
    if (!token) {
      console.error("NO_BOT_TOKEN_ENV");
      return;
    }
    const body = new URLSearchParams({
      chat_id: String(chatId),
      text: `echo: ${text || "(no text)"}`
    });
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", body });
    const j = await r.json().catch(() => ({}));
    console.log("OUTBOUND", r.status, JSON.stringify(j));
  } catch (e) {
    console.error("TELEGRAM_HANDLER_ERR", e);
  }
}
export const config = { api: { bodyParser: { sizeLimit: "1mb" } } };
