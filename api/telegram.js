export const config = { runtime: "nodejs18.x" }; // WAJIB, bukan Edge

// /api/telegram.js — Vercel + Google Sheets (process-first)
import { setupSheets, appendRow, readAll, tabs } from "./_sheets.js";
import { sendMessage } from "./_tg.js";

const BOT_TOKEN = process.env.BOT_TOKEN;
const TOKEN_TTL_MIN = Number(process.env.TOKEN_TTL_MIN || "3");

const nowIso = () => new Date().toISOString();
const rnd4 = () => String(Math.floor(1000 + Math.random() * 9000)); // 1000..9999

async function isAllowed(userId) {
  const { header, rows } = await readAll(tabs.TAB_WHITELIST);
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  for (const r of rows) {
    const v = String((r[idx.telegram_id] || "")).trim().replace(/\.0$/, "");
    if (v && v === String(userId)) return true;
  }
  return false;
}

async function getState(chatId) {
  const { header, rows } = await readAll(tabs.TAB_STATE);
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (String(r[idx.chat_id]) === String(chatId)) {
      return {
        step: r[idx.step] || null,
        data: {
          requesterId: r[idx.requester_id] || "",
          nama_teknisi: r[idx.nama_teknisi] || "",
          nama_odc: r[idx.nama_odc] || "",
          keperluan: r[idx.keperluan] || ""
        }
      };
    }
  }
  return { step: null, data: {} };
}

async function setState(chatId, state) {
  await appendRow(tabs.TAB_STATE, [
    String(chatId),
    state.step || "",
    state.data?.requesterId || "",
    state.data?.nama_teknisi || "",
    state.data?.nama_odc || "",
    state.data?.keperluan || "",
    nowIso()
  ]);
}

async function clearState(chatId) {
  // append baris “kosong” biar historinya tetap ada
  await setState(chatId, { step: null, data: {} });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  try {
    if (!BOT_TOKEN) {
      console.error("NO_BOT_TOKEN_ENV");
      return res.status(500).send("NO_BOT_TOKEN");
    }

    // Pastikan header sheet ada
    await setupSheets();

    const update = req.body || {};
    const msg = update.message || update.callback_query?.message;
    if (!msg) {
      return res.status(200).send("OK"); // bukan pesan — aman diabaikan
    }

    const chatId = msg.chat.id;
    const userId = (update.message ? update.message.from.id : update.callback_query.from.id);
    const text = (update.message?.text || "").trim();

    // /start → kasih ID
    if (text === "/start") {
      await sendMessage(BOT_TOKEN, chatId,
        `Halo! ID Telegram kamu: <code>${userId}</code>\nPakai /ambil_kunci untuk minta token.\n/batal untuk batalkan proses.`,
        { parse_mode: "HTML" }
      );
      await appendRow(tabs.TAB_LOGS, [nowIso(), userId, "START", "-"]);
      return res.status(200).send("OK");
    }

    // /batal → reset state
    if (text === "/batal") {
      await clearState(chatId);
      await sendMessage(BOT_TOKEN, chatId, "Proses dibatalkan. 🚫");
      await appendRow(tabs.TAB_LOGS, [nowIso(), userId, "BATAL", "-"]);
      return res.status(200).send("OK");
    }

    // /ambil_kunci → cek whitelist
    if (text === "/ambil_kunci") {
      const allowed = await isAllowed(userId);
      if (!allowed) {
        await sendMessage(BOT_TOKEN, chatId,
          "Maaf, kamu tidak berwenang minta token. 🙏\n(Minta admin menambahkan ID-mu ke sheet whitelist)"
        );
        return res.status(200).send("OK");
      }
      await setState(chatId, { step: "ASK_TEKNISI", data: { requesterId: String(userId) } });
      await sendMessage(BOT_TOKEN, chatId, "Siapa <b>nama teknisi</b> yang akan ambil kunci?", { parse_mode: "HTML" });
      return res.status(200).send("OK");
    }

    // flow tanya-jawab
    const state = await getState(chatId);

    if (state.step === "ASK_TEKNISI") {
      state.data.nama_teknisi = text;
      state.step = "ASK_ODC";
      await setState(chatId, state);
      await sendMessage(BOT_TOKEN, chatId, "Nama <b>ODC</b>-nya apa? (mis. ODC-PSN-14)", { parse_mode: "HTML" });
      return res.status(200).send("OK");
    }

    if (state.step === "ASK_ODC") {
      state.data.nama_odc = text.toUpperCase();
      state.step = "ASK_KEPERLUAN";
      await setState(chatId, state);
      await sendMessage(BOT_TOKEN, chatId, "Keperluannya apa? (singkat jelas)");
      return res.status(200).send("OK");
    }

    if (state.step === "ASK_KEPERLUAN") {
      state.data.keperluan = text;

      const issuedAt = new Date();
      const expiresAt = new Date(issuedAt.getTime() + TOKEN_TTL_MIN * 60 * 1000);
      const token = rnd4();

      await appendRow(tabs.TAB_TOKENS, [
        token,
        state.data.nama_teknisi,
        state.data.nama_odc,
        state.data.keperluan,
        state.data.requesterId,
        "ISSUED",
        issuedAt.toISOString(),
        expiresAt.toISOString(),
        ""
      ]);
      await clearState(chatId);

      const expStr = expiresAt.toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour12: false });
      const msgToken =
        `✅ <b>TOKEN KUNCI ODC</b>\n` +
        `Token: <code>${token}</code>\n` +
        `Berlaku s/d: <b>${expStr} WIB</b>\n\n` +
        `<b>Teknisi:</b> ${state.data.nama_teknisi}\n` +
        `<b>ODC:</b> ${state.data.nama_odc}\n` +
        `<b>Keperluan:</b> ${state.data.keperluan}\n\n` +
        `Masukkan token di keypad / akan diverifikasi oleh perangkat.`;

      await sendMessage(BOT_TOKEN, chatId, msgToken, { parse_mode: "HTML" });
      await appendRow(tabs.TAB_LOGS, [nowIso(), state.data.requesterId, "ISSUE_TOKEN", JSON.stringify({ token, ...state.data })]);

      return res.status(200).send("OK");
    }

    // fallback echo
    if (text) {
      await sendMessage(BOT_TOKEN, chatId, `echo: ${text}`);
    }
    return res.status(200).send("OK");
  } catch (e) {
    console.error("TELEGRAM_HANDLER_ERR", e);
    try { await appendRow(tabs.TAB_LOGS, [nowIso(), "SYSTEM", "ERROR", String(e)]); } catch {}
    return res.status(200).send("OK");
  }
}

export const config = { api: { bodyParser: { sizeLimit: "1mb" } } };

