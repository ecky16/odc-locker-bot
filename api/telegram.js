// api/telegram.js
import { setupSheets, isAllowed, issueToken, consumeToken } from "./_sheets.js";

export const config = { runtime: "nodejs18.x" };

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "GET" && url.pathname.endsWith("/verify")) {
      const token = url.searchParams.get("token") || "";
      const odc = url.searchParams.get("odc") || "";
      if (!token || !odc) return res.status(400).json({ ok:false, reason:"MISSING_PARAMS" });
      const out = await consumeToken({ token, odc });
      return res.status(200).json(out);
    }

    if (req.method !== "POST") return res.status(405).end();

    const body = await readJson(req);
    const msg = body?.message;
    const chatId = msg?.chat?.id;
    const text = (msg?.text || "").trim();
    const userId = msg?.from?.id;

    if (!chatId) return res.status(200).json({ ok:true });

    if (text === "/ping") {
      await send(chatId, "pong ✅"); // tanpa sentuh Sheets
      return res.status(200).json({ ok:true });
    }

    if (text === "/start" || text === "/help") {
      await send(chatId, "Gunakan /minta_kunci Nama;ODC;Keperluan (TTL 3 menit).");
      return res.status(200).json({ ok:true });
    }

    if (text.startsWith("/minta_kunci")) {
      await setupSheets(); // <-- panggil di dalam handler
      if (!(await isAllowed(userId))) {
        await send(chatId, "Maaf, kamu belum terdaftar di whitelist.");
        return res.status(200).json({ ok:true });
      }

      const parsed = parse(text); // implement sendiri parser Nama;ODC;Keperluan
      if (!parsed) {
        await send(chatId, "Format salah. Contoh:\n/minta_kunci Budi;ODC-17;Maintenance");
        return res.status(200).json({ ok:true });
      }

      const { nama_teknisi, nama_odc, keperluan } = parsed;
      const { token, expires_at } = await issueToken({
        requesterId: userId, nama_teknisi, nama_odc, keperluan, ttlMinutes: 3
      });

      await send(chatId,
        `Token: <code>${token}</code>\n` +
        `Teknisi: ${nama_teknisi}\nODC: ${nama_odc}\nKeperluan: ${keperluan}\n` +
        `Berlaku s/d: <code>${expires_at}</code> (±3 menit)`
      );
      return res.status(200).json({ ok:true });
    }

    return res.status(200).json({ ok:true });
  } catch (e) {
    console.error("TELEGRAM_HANDLER_ERR", e);
    return res.status(200).json({ ok:true }); // biar Telegram gak spam retry
  }
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { return {}; }
}

async function send(chatId, text) {
  const token = process.env.BOT_TOKEN;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
}

function parse(text) {
  const m = text.match(/^\/minta_kunci\s+(.+)$/i);
  if (!m) return null;
  const parts = m[1].split(";").map(s=>s.trim());
  if (parts.length < 3) return null;
  const [nama_teknisi, nama_odc, keperluan] = parts;
  if (!nama_teknisi || !nama_odc || !keperluan) return null;
  return { nama_teknisi, nama_odc, keperluan };
}

