// api/telegram.js
export const config = { runtime: "nodejs" };

import { setupSheets, isAllowed, issueToken, consumeToken } from "./_sheets.js";

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // Health/ESP verify
    if (req.method === "GET") {
      if (url.searchParams.has("verify")) {
        const token = url.searchParams.get("token") || "";
        const odc   = url.searchParams.get("odc")   || "";
        if (!token || !odc) return res.status(400).json({ ok:false, reason:"MISSING_PARAMS" });
        const out = await consumeToken({ token, odc });
        return res.status(200).json(out);
      }
      // health
      return res.status(200).json({ ok:true, msg:"alive" });
    }

    if (req.method !== "POST") return res.status(405).end();

    const body   = await readJson(req);
    const msg    = body?.message;
    const chatId = msg?.chat?.id;
    const text   = (msg?.text || "").trim();
    const userId = msg?.from?.id;

    if (!chatId) return res.status(200).json({ ok:true });

    // perintah ringan (tanpa Sheets) — supaya SELALU bales
    if (text === "/ping") {
      await safeSend(chatId, "pong ✅");
      return res.status(200).json({ ok:true });
    }
    if (text === "/start" || text === "/help") {
      await safeSend(chatId, "Gunakan /minta_kunci Nama;ODC;Keperluan (TTL 3 menit).");
      return res.status(200).json({ ok:true });
    }

    // /minta_kunci — kirim ACK dulu supaya user lihat “lagi proses”
    if (text.startsWith("/minta_kunci")) {
      const parsed = parseMinta(text);
      if (!parsed) {
        await safeSend(chatId, "Format salah.\nContoh: <code>/minta_kunci Budi;ODC-17;Maintenance</code>");
        return res.status(200).json({ ok:true });
      }
      await safeSend(chatId, "Sebentar ya… cek whitelist & terbitkan PIN 🔐");

      try {
        await setupSheets(); // dipanggil di DALAM handler

        const allowed = await isAllowed(userId);
        if (!allowed) {
          await safeSend(chatId, "Maaf, kamu belum terdaftar di whitelist.");
          return res.status(200).json({ ok:true });
        }

        const { nama_teknisi, nama_odc, keperluan } = parsed;
        const { token, expires_at } = await issueToken({
          requesterId: userId, nama_teknisi, nama_odc, keperluan, ttlMinutes: 3
        });

        await safeSend(chatId,
          [
            "<b>KUNCI DITERBITKAN</b>",
            `PIN: <code>${token}</code>`,
            `Teknisi: ${nama_teknisi}`,
            `ODC: ${nama_odc}`,
            `Keperluan: ${keperluan}`,
            `Berlaku s/d: <code>${expires_at}</code> (±3 menit)`,
            "",
            "Masukkan PIN di keypad. ESP akan verifikasi otomatis.",
          ].join("\n")
        );
      } catch (e) {
        const brief = String(e?.message || e).slice(0, 300);
        console.error("/minta_kunci error:", e);
        await safeSend(chatId,
          "Gagal memproses permintaan.\n" +
          "Detail: <code>" + brief + (String(e).length > 300 ? "…" : "") + "</code>"
        );
      }
      return res.status(200).json({ ok:true });
    }

    return res.status(200).json({ ok:true });
  } catch (e) {
    console.error("TELEGRAM_HANDLER_ERR", e);
    return res.status(200).json({ ok:true });
  }
}

function parseMinta(text) {
  const m = text.match(/^\/minta_kunci\s+(.+)$/i);
  if (!m) return null;
  const [nama_teknisi, nama_odc, keperluan] = m[1].split(";").map(s=>s.trim());
  if (!nama_teknisi || !nama_odc || !keperluan) return null;
  return { nama_teknisi, nama_odc, keperluan };
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { return {}; }
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
