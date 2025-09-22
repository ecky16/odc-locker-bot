// _sheets.js
import { google } from "googleapis";

// === KONFIG ===
export const SPREADSHEET_ID = process.env.SPREADSHEET_ID; // wajib di-set di env
const SCOPE = ["https://www.googleapis.com/auth/spreadsheets"];

// === NAMA TAB (string) ===
export const tabs = {
  WHITELIST: "whitelist",
  TOKENS: "tokens",
  LOGS: "logs",
};

// === CLIENT ===
function sheets() {
  const auth = new google.auth.GoogleAuth({ scopes: SCOPE });
  return google.sheets({ version: "v4", auth });
}

async function listSheetTitles() {
  const api = sheets();
  const meta = await api.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  return (meta.data.sheets || []).map(s => s.properties?.title).filter(Boolean);
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
  const same = current.length === headers.length &&
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
  await ensureHeaders(tabs.WHITELIST, ["telegram_id","nama","role"]);
  await ensureHeaders(tabs.TOKENS, [
    "token","nama_teknisi","nama_odc","keperluan",
    "requester_id","status","issued_at","expires_at","used_at"
  ]);
  await ensureHeaders(tabs.LOGS, ["time","actor","action","detail"]);
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
  const v = resp.data.values || [];
  if (!v.length) return { header: [], rows: [] };
  return { header: v[0], rows: v.slice(1) };
}

// === UTIL BISNIS ===
export async function isAllowed(telegramId) {
  const { header, rows } = await readAll(tabs.WHITELIST);
  if (!header.length) return false;
  const idx = Object.fromEntries(header.map((h,i)=>[h,i]));
  for (const r of rows) {
    const v = String(r[idx.telegram_id] || "").trim().replace(/\.0$/, "");
    if (v && v === String(telegramId)) return true;
  }
  return false;
}

function nowIso() {
  return new Date().toISOString();
}
function addMinutesISO(iso, minutes) {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() + minutes);
  return d.toISOString();
}
function rnd4() { return String(Math.floor(1000 + Math.random()*9000)); }
function makeToken() {
  // token pendek mudah dicatat (bisa diubah sesuai selera)
  return `${Date.now().toString(36)}-${rnd4()}`;
}

export async function issueToken({ requesterId, nama_teknisi, nama_odc, keperluan, ttlMinutes=3 }) {
  const token = makeToken();
  const issued_at = nowIso();
  const expires_at = addMinutesISO(issued_at, ttlMinutes);
  await appendRow(tabs.TOKENS, [
    token, nama_teknisi, nama_odc, keperluan,
    requesterId, "PENDING", issued_at, expires_at, ""
  ]);
  await appendRow(tabs.LOGS, [nowIso(), requesterId, "ISSUE_TOKEN", `${token}|${nama_odc}|${keperluan}`]);
  return { token, issued_at, expires_at };
}

export async function consumeToken({ token, odc, usedAtIso }) {
  const api = sheets();
  const { header, rows } = await readAll(tabs.TOKENS);
  if (!header.length) return { ok:false, reason:"NO_HEADER" };

  const idx = Object.fromEntries(header.map((h,i)=>[h,i]));
  let rowIndex = -1;
  const now = new Date(usedAtIso || nowIso());

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const tk = String(row[idx.token] || "");
    const rowOdc = String(row[idx.nama_odc] || "");
    const status = String(row[idx.status] || "");
    const exp = new Date(String(row[idx.expires_at] || ""));

    if (tk === token && rowOdc.toUpperCase() === String(odc).toUpperCase()) {
      if (status !== "PENDING") return { ok:false, reason:"ALREADY_USED_OR_INVALID" };
      if (!(exp instanceof Date) || isNaN(exp)) return { ok:false, reason:"BAD_EXP" };
      if (now > exp) return { ok:false, reason:"EXPIRED" };
      rowIndex = r + 2; // + header
      break;
    }
  }

  if (rowIndex === -1) return { ok:false, reason:"NOT_FOUND" };

  const statusRange = `${tabs.TOKENS}!F${rowIndex}`; // status
  const usedAtRange = `${tabs.TOKENS}!I${rowIndex}`; // used_at

  await api.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      valueInputOption: "RAW",
      data: [
        { range: statusRange, values: [["USED"]] },
        { range: usedAtRange, values: [[usedAtIso || nowIso()]] },
      ],
    },
  });

  await appendRow(tabs.LOGS, [nowIso(), "ESP", "CONSUME_TOKEN", `${token}|${odc}`]);
  return { ok:true };
}
