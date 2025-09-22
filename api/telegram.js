// api/telegram.js — echo-only, tanpa Sheets
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).send("OK");
  res.status(200).send("OK"); // balas cepat ke Telegram

  try {
    const update = req.body || {};
    const msg = update.message || update.callback_query?.message;
    if (!msg) return;

    const chatId = msg.chat.id;
    const text = (update.message?.text || "").trim();

    const token = process.env.BOT_TOKEN; // <-- wajib ada di Vercel Env
    const body = new URLSearchParams({
      chat_id: String(chatId),
      text: `echo: ${text || "(no text)"}`
    });
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", body });
  } catch (e) {
    console.error(e);
  }
}
export const config = { api: { bodyParser: { sizeLimit: "1mb" } } };
