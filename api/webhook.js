// api/webhook.js
import { setupSheets, isAllowed, issueToken, consumeToken } from "./_sheets.js";
import { sendMessage, parseMintaKunci } from "./_tg.js";

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname || "";

    if (req.method === "GET" && pathname.endsWith("/verify")) {
      // Endpoint untuk ESP: /api/verify?token=...&odc=...
      const token = url.searchParams.get("token") || "";
      const odc = url.searchParams.get("odc") || "";
      if (!token || !odc) {
        return res.status(400).json({ ok:false, reason:"MISSING_PARAMS" });
      }
      const out = await consumeToken({ token, odc });
      return res.status(200).json(out);
    }

    // Telegram webhook (POST)
    if (req.method !== "POST") return res.status(405).end();

    const body = await readJson(req);
    await setupSheets(); // sekali panggil aman; fungsi idempotent

    const msg = body?.message;
    const chatId = msg?.chat?.id;
    const text = msg?.text?.trim() || "";
    const userId = msg?.from?.id;

    if (!chatId || !text) return res.status(200).json({ ok:true });

    // Hanya whitelist yang boleh minta kunci
    if (text.startsWith("/minta_kunci")) {
      const allowed = await isAllowed(userId);
      if (!allowed) {
        await sendMessage(chatId, "Maaf, kamu belum terdaftar di whitelist.");
        return res.status(200).json({ ok:true });
      }

      const parsed = parseMintaKunci(text);
      if (!parsed) {
        await sendMessage(chatId, "Format salah.\nContoh: <code>/minta_kunci Budi;ODC-17;Maintenance</code>");
        return res.status(200).json({ ok:true });
      }

      const { nama_teknisi, nama_odc, keperluan } = parsed;
      const { token, expires_at } = await issueToken({
        requesterId: userId,
        nama_teknisi,
        nama_odc,
        keperluan,
        ttlMinutes: 3, // TTL 3 menit
      });

      await sendMessage(
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
    }

    // Bantuan
    if (text === "/start" || text === "/help") {
      await sendMessage(
        chatId,
        [
          "Halo. Perintah tersedia:",
          "• <code>/minta_kunci NAMA_TEKNISI;NAMA_ODC;KEPERLUAN</code>",
          "",
          "Contoh:",
          "<code>/minta_kunci Surya;ODC-PSN-12;Penggantian jumper</code>",
          "",
          "Catatan:",
          "- Hanya user yang di-whitelist yang bisa minta kunci.",
          "- Token berlaku 3 menit sejak diterbitkan.",
        ].join("\n")
      );
      return res.status(200).json({ ok:true });
    }

    // default: abaikan
    return res.status(200).json({ ok:true });
  } catch (e) {
    console.error("webhook error:", e);
    try { return res.status(200).json({ ok:true }); }
    catch { return; }
  }
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { return {}; }
}
