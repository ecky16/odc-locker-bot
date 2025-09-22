export const config = { runtime: "nodejs" };

import { setupSheets, isAllowed, issueToken, consumeToken } from "./_sheets.js";

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // Endpoint ESP: GET /api/telegram?verify&token=...&odc=...
    if (req.method === "GET" && url.searchParams.has("verify")) {
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
      await send(chatId, "pong ✅");
      return res.status(200).json({ ok:true });
    }

    if (text === "/start" || text === "/help") {
      await send(chatId, "Gunakan /minta_kunci Nama;ODC;Keperluan (TTL 3 menit).");
      return res.status(200).json({ ok:true });
    }

    if (text.startsWith("/minta_kunci")) {
  // 0) Validasi format dulu, biar kalau salah langsung dibales
  const m = text.match(/^\/minta_kunci\s+(.+)$/i);
  if (!m) {
    await safeSend(chatId, "Format salah.\nContoh: <code>/minta_kunci Budi;ODC-17;Maintenance</code>");
    return res.status(200).json({ ok:true });
  }
  const parts = m[1].split(";").map(s=>s.trim());
  if (parts.length < 3 || parts.some(x => !x)) {
    await safeSend(chatId, "Format salah.\nContoh: <code>/minta_kunci Budi;ODC-17;Maintenance</code>");
    return res.status(200).json({ ok:true });
  }
  const [nama_teknisi, nama_odc, keperluan] = parts;

  // 1) Quick ack biar user tau lagi diproses
  await safeSend(chatId, "Sebentar ya… cek whitelist & terbitkan token 🔐");

  try {
    // 2) Pastikan env Google ada sebelum nyentuh Sheets
    if (!process.env.SPREADSHEET_ID) {
      await safeSend(chatId, "SPREADSHEET_ID belum disetel di ENV.");
      return res.status(200).json({ ok:true });
    }
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON &&
        !(process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY)) {
      await safeSend(chatId, "ENV kredensial Google belum lengkap. Set <code>GOOGLE_SERVICE_ACCOUNT_JSON</code> atau <code>GOOGLE_CLIENT_EMAIL</code>+<code>GOOGLE_PRIVATE_KEY</code>.");
      return res.status(200).json({ ok:true });
    }

    // 3) Jalankan Sheets flow
    await setupSheets();

    // 4) Whitelist check
    const allowed = await isAllowed(userId);
    if (!allowed) {
      await safeSend(chatId, "Maaf, kamu belum terdaftar di whitelist.");
      return res.status(200).json({ ok:true });
    }

    // 5) Issue token 3 menit
    const { token, expires_at } = await issueToken({
      requesterId: userId, nama_teknisi, nama_odc, keperluan, ttlMinutes: 3
    });

    await safeSend(
      chatId,
      [
        "<b>KUNCI DITERBITKAN</b>",
        `Token: <code>${token}</code>`,
        `Teknisi: ${nama_teknisi}`,
        `ODC: ${nama_odc}`,
        `Keperluan: ${keperluan}`,
        `Berlaku s/d: <code>${expires_at}</code> (±3 menit)`,
        "",
        "Berikan token ini ke perangkat (ESP) untuk verifikasi.",
      ].join("\n")
    );
    return res.status(200).json({ ok:true });
  } catch (e) {
    console.error("/minta_kunci error:", e);
    await safeSend(chatId, "Gagal memproses permintaan. " + hintFromError(e));
    return res.status(200).json({ ok:true });
  }
}


    return res.status(200).json({ ok:true });
  } catch (e) {
    console.error("TELEGRAM_HANDLER_ERR", e);
    return res.status(200).json({ ok:true });
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
  const [nama_teknisi, nama_odc, keperluan] = m[1].split(";").map(s=>s.trim());
  if (!nama_teknisi || !nama_odc || !keperluan) return null;
  return { nama_teknisi, nama_odc, keperluan };
}


async function safeSend(chatId, text) {
  try {
    const url = `https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`;
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
  } catch (e) {
    console.error("sendMessage error:", e);
  }
}

function hintFromError(e) {
  const msg = String(e && (e.message || e));
  if (msg.includes("Could not load the default credentials")) return "Auth Google belum disetel. Pastikan ENV <code>GOOGLE_SERVICE_ACCOUNT_JSON</code> atau <code>GOOGLE_CLIENT_EMAIL</code>/<code>GOOGLE_PRIVATE_KEY</code> terpasang.";
  if (msg.includes("invalid_grant")) return "Kredensial Service Account salah format/expired. Coba rotate key JSON & update ENV.";
  if (msg.includes("PERMISSION_DENIED")) return "Spreadsheet belum di-share ke email Service Account (role Editor).";
  if (msg.includes("Requested entity was not found") || msg.includes("notFound")) return "SPREADSHEET_ID salah. Pastikan hanya ID, bukan full URL.";
  if (msg.includes("Unexpected token")) return "ENV JSON tidak valid. Cek <code>GOOGLE_SERVICE_ACCOUNT_JSON</code> atau escape newline private_key (\\n).";
  return "Terjadi error Sheets. Cek log Vercel untuk detail.";
}

