import { google } from "googleapis";

const BOT_TOKEN = process.env.BOT_TOKEN;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const GS_CREDS_JSON = process.env.GS_CREDS_JSON;

const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// Durasi per keperluan (jam)
const DURASI_JAM = {
  "VALIDASI ODC": 5,
  "GAMAS": 3,
  "PT-2/PT-3": 1,
  "PERAPIHAN ODC": 2,
};

// ================= GOOGLE SHEETS CLIENT =================
async function getSheetsClient() {
  const creds = JSON.parse(GS_CREDS_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client });
}

// ================= HELPER TELEGRAM =================
async function sendMessage(chatId, text, extra = {}) {
  await fetch(TELEGRAM_API + "/sendMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, ...extra }),
  });
}

// Format WIB rapi
function nowWIB() {
  return new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
}
function addHoursWIB(hours) {
  const now = new Date();
  const t = new Date(now.getTime() + hours * 3600 * 1000);
  return t.toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
}

// ================= LOGIC UTAMA =================
async function handleUpdate(update) {
  // ========== /minta_pin ==========
  if (update.message && update.message.text === "/minta_pin") {
    const chatId = update.message.chat.id;
    await sendMessage(chatId, "Masukkan nama ODC (format ODC-STO-XX):", {
      reply_markup: { force_reply: true },
    });
    return;
  }

  // ========== REPLY NAMA ODC ==========
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
      range: "odc_master!A:A", // cuma cek nama ODC
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

    // TIDAK TAMPILKAN PIN DI SINI
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

  // ========== CALLBACK PILIHAN KEPERLUAN ==========
  if (update.callback_query) {
    const cb = update.callback_query;
    const data = cb.data || "";
    if (!data.startsWith("REQ|")) return;

    const parts = data.split("|");
    const keperluan = parts[1];
    const odcName = parts[2];
    const chatId = cb.from.id;
    const nama = cb.from.first_name || "-";

    const durasiJam = DURASI_JAM[keperluan] || 2;

    const sheets = await getSheetsClient();

    // Ambil PIN SEKARANG dari master (BARU di sini)
    const odcRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "odc_master!A:B",
    });
    const rows = odcRes.data.values || [];
    const row = rows.find((r) => (r[0] || "").toUpperCase() === odcName);
    const pinSekarang = row ? row[1] : "????";

    const waktuSekarangWIB = nowWIB();
    const expireWIB = addHoursWIB(durasiJam);

    // catat log
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: "log_request_pin!A:H",
      valueInputOption: "RAW",
      requestBody: {
        values: [
          [
            waktuSekarangWIB, // TANGGAL (WIB)
            chatId,
            nama,
            odcName,
            keperluan,
            pinSekarang,
            expireWIB, // WAKTU EXPIRE (WIB)
            "PENDING",
          ],
        ],
      },
    });

    // KIRIM PIN + INFO BARU DI SINI
    await sendMessage(
      chatId,
      `✅ Permintaan dicatat.\n` +
        `ODC: *${odcName}*\n` +
        `Keperluan: *${keperluan}*\n\n` +
        `🔓 PIN untuk ODC ini: *${pinSekarang}*\n` +
        `Berlaku sampai: *${expireWIB} WIB*\n\n` +
        `Ketik /selesai jika pekerjaan sudah selesai.`,
      { parse_mode: "Markdown" }
    );

    // jawab callback
    await fetch(TELEGRAM_API + "/answerCallbackQuery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: cb.id }),
    });

    return;
  }

  // ========== /selesai ==========
  if (update.message && update.message.text === "/selesai") {
    const chatId = update.message.chat.id;
    const sheets = await getSheetsClient();

    const logRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "log_request_pin!A:H",
    });
    const rows = logRes.data.values || [];
    if (rows.length <= 1) {
      await sendMessage(chatId, "❌ Tidak ada permintaan aktif yang tercatat.");
      return;
    }

    // cari log terakhir PENDING untuk user ini
    let foundIndex = -1;
    for (let i = rows.length - 1; i >= 1; i--) {
      const row = rows[i];
      const rowChatId = row[1];
      const status = row[7];
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

    // generate PIN baru 4 digit
    const newPin = Math.floor(1000 + Math.random() * 9000).toString();
    const waktuGantiWIB = nowWIB();

    // update odc_master: PIN SEKARANG + TERAKHIR DIGANTI (WIB)
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
      const rowNumber = odcRowIndex + 1; // 1-based
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `odc_master!B${rowNumber}:C${rowNumber}`,
        valueInputOption: "RAW",
        requestBody: {
          values: [[newPin, waktuGantiWIB]],
        },
      });
    }

    // update status log jadi DONE
    const logRowNumber = foundIndex + 1;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `log_request_pin!H${logRowNumber}`,
      valueInputOption: "RAW",
      requestBody: {
        values: [["DONE"]],
      },
    });

    // kirim ke user
    await sendMessage(
      chatId,
      `🔒 Terima kasih.\n` +
        `PIN baru untuk *${odcName}* adalah *${newPin}*.\n` +
        `Mohon segera ganti PIN gembok sebelum meninggalkan lokasi.`,
      { parse_mode: "Markdown" }
    );
  }
}

// ================== VERCEL HANDLER ==================
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
      console.error("Error di handler:", err);
      // tetap balas 200 supaya Telegram nggak spam error
    }
    return res.status(200).send("ok");
  }

  return res.status(200).end();
}
