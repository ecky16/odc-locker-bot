import { google } from "googleapis";

const BOT_TOKEN = process.env.BOT_TOKEN;
const SPREADSHEET_ID = process.env.SPRE ADSHEET_ID;
const GS_CREDS_JSON = process.env.GS_CREDS_JSON;

const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// helper sheets
async function getSheetsClient() {
  const creds = JSON.parse(GS_CREDS_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client });
}

// helper telegram
async function sendMessage(chatId, text, extra = {}) {
  await fetch(TELEGRAM_API + "/sendMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, ...extra }),
  });
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(200).send("ok");
  }

  try {
    const sheets = await getSheetsClient();

    // ambil log_request_pin
    const logRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "log_request_pin!A:L",
    });
    const logRows = logRes.data.values || [];
    if (logRows.length <= 1) {
      return res.status(200).send("no logs");
    }

    // ambil user_telegram
    const userRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "user_telegram!A:D",
    });
    const userRows = userRes.data.values || [];

    const now = new Date();

    // fungsi cari area & leader berdasarkan chatId teknisi
    function getAreaAndLeaders(telegramId) {
      const idStr = String(telegramId);

      const teknisiRow = userRows.find(
        (r) => String(r[0]) === idStr && (r[2] || "").toUpperCase() === "TEKNISI"
      );
      if (!teknisiRow) return { area: null, leaders: [] };

      const area = teknisiRow[3] || null;
      if (!area) return { area: null, leaders: [] };

      const leaders = userRows.filter(
        (r) =>
          (r[2] || "").toUpperCase() === "LEADER" &&
          String(r[3] || "").toUpperCase() === String(area).toUpperCase()
      );

      return { area, leaders };
    }

    // iterasi log
    for (let i = 1; i < logRows.length; i++) {
      const r = logRows[i];

      const chatId = r[1];
      const nama = r[2] || "-";
      const odc = r[3] || "-";
      const status = r[7] || "";
      const openIso = r[8] || "";
      const warningSent = r[10] || "";
      const adminNotified = r[11] || "";

      if (status !== "PENDING" || !openIso) continue;

      const openTime = new Date(openIso);
      if (isNaN(openTime.getTime())) continue;

      const diffMinutes = (now - openTime) / 60000;
      const rowNum = i + 1;

      // 30 menit -> warning ke teknisi
      if (diffMinutes >= 30 && !warningSent) {
        await sendMessage(
          chatId,
          `⚠️ *Peringatan Waktu Buka ODC*\n\n` +
            `ODC: *${odc}*\n` +
            `Teknisi: *${nama}*\n` +
            `Waktu buka sudah lebih dari *30 menit*.\n\n` +
            `Silakan segera tutup ODC atau ajukan penambahan waktu jika masih diperlukan.`,
          { parse_mode: "Markdown" }
        );

        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `log_request_pin!K${rowNum}`,
          valueInputOption: "RAW",
          requestBody: { values: [["Y"]] },
        });
      }

      // 40 menit -> laporan ke LEADER area yang sama
      if (diffMinutes >= 40 && !adminNotified) {
        const { area, leaders } = getAreaAndLeaders(chatId);

        if (area && leaders.length > 0) {
          for (const leader of leaders) {
            const leaderChatId = leader[0]; // TELEGRAM_ID leader
            const leaderName = leader[1] || "-";

            await sendMessage(
              leaderChatId,
              `🚨 *Alert ODC Belum Ditutup*\n\n` +
                `Area: *${area}*\n` +
                `Leader: *${leaderName}*\n\n` +
                `Teknisi: *${nama}* (ID: ${chatId})\n` +
                `ODC: *${odc}*\n` +
                `Sudah lebih dari *40 menit* sejak ODC dibuka dan belum ada konfirmasi /selesai.\n\n` +
                `Mohon dicek kondisi di lapangan.`,
              { parse_mode: "Markdown" }
            );
          }

          await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `log_request_pin!L${rowNum}`,
            valueInputOption: "RAW",
            requestBody: { values: [["Y"]] },
          });
        }
      }
    }

    return res.status(200).send("checked");
  } catch (err) {
    console.error("Error check-odc:", err);
    return res.status(200).send("error");
  }
}
