// /api/ping.js
export default async function handler(req, res) {
  try {
    const token = process.env.BOT_TOKEN;
    const chatId = req.query.chat_id || req.body?.chat_id; // isi id kamu
    const text = req.query.text || req.body?.text || "pong from vercel";
    if (!token) return res.status(500).json({ ok:false, reason:"NO_BOT_TOKEN" });
    if (!chatId) return res.status(400).json({ ok:false, reason:"NO_CHAT_ID" });

    const body = new URLSearchParams({ chat_id: String(chatId), text });
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method:"POST", body });
    const j = await r.json().catch(()=>({}));
    return res.status(200).json({ ok: j.ok === true, status: r.status, resp: j });
  } catch (e) {
    return res.status(500).json({ ok:false, err:String(e) });
  }
}
export const config = { api: { bodyParser: { sizeLimit: "1mb" } } };
