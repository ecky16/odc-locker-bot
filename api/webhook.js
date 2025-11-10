import { google } from "googleapis";

const BOT_TOKEN = process.env.BOT_TOKEN;
const SPREADSHEET_ID = process.env.SPRE ADSHEET_ID;
const GS_CREDS_JSON = process.env.GS_CREDS_JSON;

const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

const DURASI_JAM = {
  "VALIDASI ODC": 5,
  "GAMAS": 3,
  "PT-2/PT-3": 1,
  "PERAPIHAN ODC": 2,
};

// ---------- helper Google Sheets ----------
async function getSheetsClient() {
  const creds = JSON.parse(GS_CREDS_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client });
}

// ---------- helper Telegram ----------
async function sendMessage(chatId, text, extra = {}) {
  await fetch(TELEGRAM_API + "/sendMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, ...extra }),
  });
}

// WIB helper
function formatWIB(dateObj) {
  return dateObj.toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
}

// ---------- LOGIC UTAMA ----------
async function handleUpdate(update) {
  // /minta_pin
  if (update.message && update.message.text === "/minta_pin") {
    const chatId = update.message.chat.id;
    await sendMessage(chatId, "Masukkan nama ODC (format ODC-STO-XX):", {
      reply_markup: { force_reply: true },
    });
    return;
  }

  // Reply nama ODC
  if (
    update.message &&
    update.message.reply_to_message &&
    update.message.reply_to_message.text &&
    update.message.reply_to_message.text.includes("Masukkan nama ODC")
  ) {
    const chatId = update.message.chat.id;
    const odcName = update.message.text.trim().toUpperCase();

    const sheets = await getSheetsClient();
    const odcRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "odc_master!A:A",
    });

    const rows = odcRes.data.values || [];
    const row = rows.find((r) => (r[0] || "").toUpperCase() === odcName);

    if (!row) {
      await sendMessage(
        chatId,
        `❌ ODC ${odcName} tidak ditemukan di database (sheet odc_master).`
      );
      return;
    }

    // belum tampilkan PIN di sini
    const keyboard = {
      inline_keyboard: [
        [{ text: "VALIDASI ODC", callback_data: `REQ|VALIDASI ODC|${odcName}` }],
        [{ text: "GAMAS", callback_data: `REQ|GAMAS|${odcName}` }],
        [{ text: "PT-2/PT-3", callback_data: `REQ|PT-2/PT-3|${odcName}` }],
        [{ text: "PERAPIHAN ODC", callback_data: `REQ|PERAPIHAN ODC|${odcName}` }],
      ],
    };

    await sendMessage(
      chatId,
      `ODC: *${odcName}*\nPilih keperluan di bawah ini:`,
      { parse_mode: "Markdown", reply_markup: keyboard }
    );
    return;
  }

  // Callback pilihan keperluan
  if (update.callback_query) {
    const cb = update.callback_query;
    const data = cb.data || "";
    if (!data.startsWith("REQ|")) return;

    const [_, keperluan, odcName] = data.split("|");
    const chatId = cb.from.id;
    const nama = cb.from.first_name || "-";
    const durasiJam = DURASI_JAM[keperluan] || 2;

    const sheets = await getSheetsClient();

    // Ambil PIN SEKARANG dari odc_master (baru di sini)
    const odcRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "odc_master!A:B",
    });
    const rows = odcRes.data.values || [];
    const row = rows.find((r) => (r[0] || "").toUpperCase() === odcName);
    const pinSekarang = row ? row[1] : "????";

    const now = new Date();
    const expire = new Date(now.getTime() + durasiJam * 3600 * 1000);

    const waktuNowWIB = formatWIB(now);
    const expireWIB = formatWIB(expire);

    const nowIso = now.toISOString();
    const expireIso = expire.toISOString();

    // catat log ke log_request_pin
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: "log_request_pin!A:L",
      valueInputOption: "RAW",
      requestBody: {
        values: [
          [
            waktuNowWIB, // A
            chatId, // B
            nama, // C
            odcName, // D
            keperluan, // E
            pinSekarang, // F
            expireWIB, // G
            "PENDING", // H
            nowIso, // I
            expireIso, // J
            "", // K WARNING_SENT
            "", // L ADMIN_NOTIFIED
          ],
        ],
      },
    });

    // kirim PIN + info ke user
    await sendMessage(
      chatId,
      `✅ Permintaan dicatat.\n` +
        `ODC: *${odcName}*\n` +
        `Keperluan: *${keperluan}*\n\n` +
        `🔓 PIN untuk ODC ini: *${pinSekarang}*\n` +
        `Berlaku sampai: *${expireWIB} WIB*\n\n` +
        `Batas rekomendasi buka: *30 menit*.\n` +
        `Ketik /selesai jika pekerjaan sudah selesai.`,
      { parse_mode: "Markdown" }
    );

    // jawaban callback
    await fetch(TELEGRAM_API + "/answerCallbackQuery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: cb.id }),
    });
    return;
  }

  // /selesai
  if (update.message && update.message.text === "/selesai") {
    const chatId = update.message.chat.id;
    const sheets = await getSheetsClient();

    const logRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "log_request_pin!A:L",
    });

    const rows = logRes.data.values || [];
    if (rows.length <= 1) {
      await sendMessage(chatId, "❌ Tidak ada permintaan aktif yang tercatat.");
      return;
    }

    // cari baris terakhir PENDING milik user ini
    let foundIndex = -1;
    for (let i = rows.length - 1; i >= 1; i--) {
      const r = rows[i];
      const rowChatId = r[1];
      const status = r[7];
      if (String(rowChatId) === String(chatId) && status === "PENDING") {
        foundIndex = i;
        break;
      }
    }

    if (foundIndex === -1) {
      await sendMessage(chatId, "❌ Tidak ada permintaan PENDING untuk kamu.");
      return;
    }

    const logRow = rows[foundIndex];
    const odcName = logRow[3];

    // generate PIN baru
    const newPin = Math.floor(1000 + Math.random() * 9000).toString();
    const waktuGantiWIB = formatWIB(new Date());

    // update odc_master
    const odcRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "odc_master!A:C",
    });
    const odcRows = odcRes.data.values || [];
    let odcRowIndex = -1;
    for (let i = 0; i < odcRows.length; i++) {
      if ((odcRows[i][0] || "").toUpperCase() === odcName.toUpperCase()) {
        odcRowIndex = i;
        break;
      }
    }

    if (odcRowIndex >= 0) {
      const rowNum = odcRowIndex + 1;
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `odc_master!B${rowNum}:C${rowNum}`,
        valueInputOption: "RAW",
        requestBody: { values: [[newPin, waktuGantiWIB]] },
      });
    }

    // update status log jadi DONE
    const logRowNum = foundIndex + 1;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `log_request_pin!H${logRowNum}`,
      valueInputOption: "RAW",
      requestBody: { values: [["DONE"]] },
    });

    await sendMessage(
      chatId,
      `🔒 Terima kasih.\n` +
        `PIN baru untuk *${odcName}* adalah *${newPin}*.\n` +
        `Mohon segera ganti PIN gembok sebelum meninggalkan lokasi.`,
      { parse_mode: "Markdown" }
    );
  }
}

// ---------- Vercel handler ----------
export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).send("Webhook aktif ✅ (GET)");
  }

  if (req.method === "POST") {
    try {
      const update = req.body;
      console.log("Update dari Telegram:", JSON.stringify(update));
      await handleUpdate(update);
    } catch (err) {
      console.error("Error di webhook:", err);
    }
    return res.status(200).send("ok");
  }

  return res.status(200).end();
}
