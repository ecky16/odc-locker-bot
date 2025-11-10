import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import { google } from "googleapis";

const app = express();
app.use(bodyParser.json());

// === ENV VARIABLES ===
const BOT_TOKEN = process.env.BOT_TOKEN;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const GS_CREDS_JSON = JSON.parse(process.env.GS_CREDS_JSON);
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const DURASI_JAM = {
  "VALIDASI ODC": 5,
  "GAMAS": 3,
  "PT-2/PT-3": 1,
  "PERAPIHAN ODC": 2,
};

// === GOOGLE SHEETS CLIENT ===
async function sheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: GS_CREDS_JSON,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client });
}

// === HELPER ===
function randomPin() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

async function sendMessage(chat_id, text, extra = {}) {
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id, text, ...extra }),
  });
}

// === MAIN HANDLER ===
app.post("/", async (req, res) => {
  const update = req.body;

  try {
    // --- handle /minta_pin ---
    if (update.message && update.message.text === "/minta_pin") {
      const chatId = update.message.chat.id;
      await sendMessage(chatId, "Masukkan nama ODC (format ODC-STO-XX):", {
        reply_markup: { force_reply: true },
      });
      return res.sendStatus(200);
    }

    // --- handle reply nama ODC ---
    if (update.message && update.message.reply_to_message) {
      const chatId = update.message.chat.id;
      const user = update.message.from;
      const odcName = update.message.text.trim().toUpperCase();

      const sheets = await sheetsClient();
      const odcData = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: "odc_master!A:B",
      });
      const rows = odcData.data.values || [];
      const row = rows.find((r) => r[0]?.toUpperCase() === odcName);

      if (!row) {
        await sendMessage(chatId, `❌ ODC ${odcName} tidak ditemukan di database.`);
        return res.sendStatus(200);
      }

      const pinSekarang = row[1];
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
        `🔓 *PIN saat ini untuk ${odcName} adalah ${pinSekarang}*\nPilih keperluan kamu di bawah ini:`,
        { parse_mode: "Markdown", reply_markup: keyboard }
      );
      return res.sendStatus(200);
    }

    // --- handle callback pilihan keperluan ---
    if (update.callback_query) {
      const cb = update.callback_query;
      const [prefix, keperluan, odcName] = cb.data.split("|");
      const chatId = cb.from.id;
      const nama = cb.from.first_name || "-";
      const now = new Date();
      const durasiJam = DURASI_JAM[keperluan] || 2;
      const expireTime = new Date(now.getTime() + durasiJam * 3600 * 1000);

      const sheets = await sheetsClient();
      // Ambil PIN SEKARANG dari master
      const odcData = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: "odc_master!A:B",
      });
      const rows = odcData.data.values || [];
      const row = rows.find((r) => r[0]?.toUpperCase() === odcName);
      const pinSekarang = row ? row[1] : "????";

      // catat log
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: "log_request_pin!A:H",
        valueInputOption: "RAW",
        requestBody: {
          values: [
            [
              now.toLocaleString("sv-SE"), // TANGGAL
              chatId,
              nama,
              odcName,
              keperluan,
              pinSekarang,
              expireTime.toLocaleString("sv-SE"),
              "PENDING",
            ],
          ],
        },
      });

      await sendMessage(
        chatId,
        `✅ Permintaan dicatat.\nODC: *${odcName}*\nKeperluan: *${keperluan}*\nPIN: *${pinSekarang}*\nBerlaku hingga: ${expireTime.toLocaleString("id-ID")}\n\nKetik /selesai jika sudah selesai.`,
        { parse_mode: "Markdown" }
      );

      // jawab callback biar tombol hilang loading
      await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_query_id: cb.id }),
      });
      return res.sendStatus(200);
    }

    // --- handle /selesai ---
    if (update.message && update.message.text === "/selesai") {
      const chatId = update.message.chat.id;
      const user = update.message.from;
      const sheets = await sheetsClient();

      // ambil log terakhir user yang PENDING
      const log = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: "log_request_pin!A:H",
      });
      const rows = log.data.values || [];
      const last = [...rows]
        .reverse()
        .find((r) => String(r[1]) === String(chatId) && r[7] === "PENDING");

      if (!last) {
        await sendMessage(chatId, "❌ Tidak ada permintaan aktif untuk kamu.");
        return res.sendStatus(200);
      }

      const odcName = last[3];
      const newPin = randomPin();
      const now = new Date().toLocaleString("sv-SE");

      // update odc_master dengan pin baru
      const odcSheet = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: "odc_master!A:C",
      });
      const odcRows = odcSheet.data.values || [];
      const rowIndex = odcRows.findIndex((r) => r[0]?.toUpperCase() === odcName);

      if (rowIndex >= 0) {
        const rowNumber = rowIndex + 1;
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `odc_master!B${rowNumber}:C${rowNumber}`,
          valueInputOption: "RAW",
          requestBody: { values: [[newPin, now]] },
        });
      }

      // update log status
      const logIndex = rows.length - rows.indexOf(last);
      const rowNumber = rows.length - logIndex + 1;
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `log_request_pin!H${rowNumber}`,
        valueInputOption: "RAW",
        requestBody: { values: [["DONE"]] },
      });

      await sendMessage(
        chatId,
        `🔒 Terima kasih.\nPIN baru untuk *${odcName}* adalah *${newPin}*\nMohon segera ganti PIN gembok.`,
        { parse_mode: "Markdown" }
      );

      return res.sendStatus(200);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Error:", err);
    res.sendStatus(500);
  }
});

export default app;
