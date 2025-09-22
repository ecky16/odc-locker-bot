// _sheets.js
import { google } from "googleapis";

export const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const WANT_STATE = false; // set true kalau kamu MAU tab 'state'

// Nama tab KANONIK (string)
export const tabs = {
  WHITELIST: "whitelist",
  TOKENS: "tokens",
  LOGS: "logs",
  ...(WANT_STATE ? { STATE: "state" } : {}), // hanya ada jika WANT_STATE = true
};

function sheets() {
  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

async function listSheetTitles() {
  const api = sheets();
  const meta = await api.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  return (meta.data.sheets || [])
    .map((s) => s.properties?.title)
    .filter(Boolean);
}

async function ensureSheetExists(title) {
  const api = sheets();
  const titles = await listSheetTitles();
  if (!titles.includes(title)) {
    await api.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title } } }] },
    });
  }
}

export async function ensureHeaders(tabName, headers) {
  const api = sheets();
  await ensureSheetExists(tabName);

  const resp = await api.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tabName}!A1:Z1`,
  });
  const current = (resp.data.values && resp.data.values[0]) || [];

  const same =
    current.length === headers.length &&
    current.every((h, i) => String(h) === String(headers[i]));

  if (!same) {
    await api.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${tabName}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [headers] },
    });
  }
}

export async function setupSheets() {
  // Wajib
  await ensureHeaders(tabs.WHITELIST, ["telegram_id", "nama", "role"]);
  await ensureHeaders(tabs.TOKENS, [
    "token",
    "nama_teknisi",
    "nama_odc",
    "keperluan",
    "requester_id",
    "status",
    "issued_at",
    "expires_at",
    "used_at",
  ]);
  await ensureHeaders(tabs.LOGS, ["time", "actor", "action", "detail"]);

  // Opsional
  if (WANT_STATE && tabs.STATE) {
    await ensureHeaders(tabs.STATE, [
      "chat_id",
      "step",
      "requester_id",
      "nama_teknisi",
      "nama_odc",
      "keperluan",
      "updated_at",
    ]);
  }
}

export async function appendRow(tabName, row) {
  const api = sheets();
  await ensureSheetExists(tabName);
  await api.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tabName}!A1`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });
}

export async function readAll(tabName) {
  const api = sheets();
  await ensureSheetExists(tabName);
  const resp = await api.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tabName}!A1:Z`,
  });
  const values = resp.data.values || [];
  if (values.length === 0) return { header: [], rows: [] };
  return { header: values[0], rows: values.slice(1) };
}

// Contoh util yang kamu pakai
export async function findAndUpdateToken({ token, odc, toStatus, usedAt }) {
  const api = sheets();
  const { header, rows } = await readAll(tabs.TOKENS);
  if (!header.length) return false;

  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  let rowIndex = -1;

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const tokenCell = String(row[idx.token] || "");
    const odcCell = String(row[idx.nama_odc] || "");
    if (
      tokenCell === String(token) &&
      odcCell.toUpperCase() === String(odc).toUpperCase()
    ) {
      rowIndex = r + 2; // + header
      break;
    }
  }

  if (rowIndex === -1) return false;

  const statusRange = `${tabs.TOKENS}!F${rowIndex}`; // status
  const usedAtRange = `${tabs.TOKENS}!I${rowIndex}`; // used_at

  const data = [{ range: statusRange, values: [[toStatus]] }];
  if (usedAt) data.push({ range: usedAtRange, values: [[usedAt]] });

  await api.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { valueInputOption: "RAW", data },
  });
  return true;
}
