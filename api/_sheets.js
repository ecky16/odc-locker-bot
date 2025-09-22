// api/_sheets.js
import { google } from "googleapis";

export const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

export const tabs = {
  WHITELIST: "whitelist",
  TOKENS: "tokens",
  LOGS: "logs",
};

const SCOPES_RW = ["https://www.googleapis.com/auth/spreadsheets"];
const SCOPES_RO = ["https://www.googleapis.com/auth/spreadsheets.readonly"];

/* ================== AUTH BUILDER (LAZY) ================== */
function buildAuth(scopes) {
  // Opsi A: satu ENV JSON penuh
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    const creds = JSON.parse(raw);
    let pk = creds.private_key || "";
    pk = pk.trim().replace(/\r\n/g, "\n").replace(/\\n/g, "\n");
    if (pk.startsWith('"') && pk.endsWith('"')) pk = pk.slice(1, -1);
    creds.private_key = pk;
    return new google.auth.GoogleAuth({ credentials: creds, scopes });
  }

  // Opsi B: email + key terpisah
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  let pk = process.env.GOOGLE_PRIVATE_KEY || "";
  if (!email || !pk) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_CLIENT_EMAIL/GOOGLE_PRIVATE_KEY");
  }
  pk = pk.trim().replace(/\r\n/g, "\n").replace(/\\n/g, "\n");
  if (pk.startsWith('"') && pk.endsWith('"')) pk = pk.slice(1, -1);

  return new google.auth.GoogleAuth({
    credentials: { client_email: email, private_key: pk },
    scopes,
  });
}

/* ================== GOOGLE SHEETS CLIENT (SINGLETON) ================== */
let _sheetsClientRW = null;
let _sheetsClientRO = null;

function sheetsRW() {
  if (_sheetsClientRW) return _sheetsClientRW;
  const auth = buildAuth(SCOPES_RW);
  _sheetsClientRW = google.sheets({ version: "v4", auth });
  return _sheetsClientRW;
}

function sheetsRO() {
  if (_sheetsClientRO) return _sheetsClientRO;
  const auth = buildAuth(SCOPES_RO);
  _sheetsClientRO = google.sheets({ version: "v4", auth });
  return _sheetsClientRO;
}

/* ================== WAKTU (WIB UTC+7) & PIN ================== */
const WIB_OFFSET_MIN = 7 * 60;

function toOffsetIso(date, offsetMinutes) {
  // contoh: 2025-09-22T15:47:07+07:00
  const pad = (n) => String(n).padStart(2, "0");
  // date = waktu UTC; kita hanya menambahkan offset saat mem-format string
  const y = date.getUTCFullYear();
  const mo = pad(date.getUTCMonth() + 1);
  const d = pad(date.getUTCDate());
  const h = pad(date.getUTCHours());
  const mi = pad(date.getUTCMinutes());
  const s = pad(date.getUTCSeconds());
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const offH = pad(Math.floor(abs / 60));
  const offM = pad(abs % 60);

  // tampilkan jam lokal (UTC+offset) secara aritmetik
  const localMs = date.getTime() + offsetMinutes * 60_000;
  const local = new Date(localMs);
  const lh = pad(local.getUTCHours());
  const lmi = pad(local.getUTCMinutes());
  const ls = pad(local.getUTCSeconds());

  return `${y}-${mo}-${d}T${lh}:${lmi}:${ls}${sign}${offH}:${offM}`;
}

function nowIsoWIB() {
  return toOffsetIso(new Date(), WIB_OFFSET_MIN);
}

function addMinutesIsoWIB(isoLike, minutes) {
  // isoLike bisa Z/UTC atau sudah punya offset; Date akan parse absolutnya
  const d = new Date(isoLike);
  d.setMinutes(d.getMinutes() + minutes);
  return toOffsetIso(d, WIB_OFFSET_MIN);
}

function pin4() {
  return String(Math.floor(Math.random() * 10000)).padStart(4, "0");
}

/* ================== HOUSEKEEPING SHEET ================== */
async function listSheetTitles() {
  const api = sheetsRO();
  const meta = await api.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  return (meta.data.sheets || []).map(s => s?.properties?.title).filter(Boolean);
}

async function ensureSheetExists(title) {
  const api = sheetsRW();
  const titles = await listSheetTitles();
  if (!titles.includes(title)) {
    await api.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title } } }] },
    });
  }
}

export async function ensureHeaders(tabName, headers) {
  const apiRW = sheetsRW();
  const apiRO = sheetsRO();

  await ensureSheetExists(tabName);
  const resp = await apiRO.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tabName}!A1:Z1`,
  });
  const current = (resp.data.values && resp.data.values[0]) || [];
  const same = current.length === headers.length && current.every((h, i) => String(h) === String(headers[i]));
  if (!same) {
    await apiRW.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${tabName}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [headers] },
    });
  }
}

export async function setupSheets() {
  if (!SPREADSHEET_ID) throw new Error("ENV SPREADSHEET_ID missing");
  await ensureHeaders(tabs.WHITELIST, ["telegram_id", "nama", "role"]);
  await ensureHeaders(tabs.TOKENS, [
    "token","nama_teknisi","nama_odc","keperluan",
    "requester_id","status","issued_at","expires_at","used_at"
  ]);
  await ensureHeaders(tabs.LOGS, ["time","actor","action","detail"]);
}

/* ================== CRUD ================== */
export async function appendRow(tabName, row) {
  const api = sheetsRW();
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
  const api = sheetsRO();
  const resp = await api.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tabName}!A1:Z`,
  });
  const v = resp.data.values || [];
  if (!v.length) return { header: [], rows: [] };
  return { header: v[0], rows: v.slice(1) };
}

/* ================== BISNIS ================== */
export async function isAllowed(telegramId) {
  const { header, rows } = await readAll(tabs.WHITELIST);
  if (!header.length) return false;
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  for (const r of rows) {
    const v = String(r[idx.telegram_id] || "").trim().replace(/\.0$/, "");
    if (v && v === String(telegramId)) return true;
  }
  return false;
}

async function makeUniquePin4() {
  const { header, rows } = await readAll(tabs.TOKENS);
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const now = new Date();
  for (let i = 0; i < 25; i++) {
    const p = pin4();
    const clash = header.length > 0 && rows.some(r => {
      const tk = String(r[idx.token] || "");
      const st = String(r[idx.status] || "");
      const expStr = String(r[idx.expires_at] || "");
      const exp = new Date(expStr);
      return tk === p && st === "PENDING" && exp instanceof Date && !isNaN(exp) && now <= exp;
    });
    if (!clash) return p;
  }
  return pin4();
}

export async function issueToken({ requesterId, nama_teknisi, nama_odc, keperluan, ttlMinutes = 3 }) {
  const token      = await makeUniquePin4();
  const issued_at  = nowIsoWIB();                         // WIB
  const expires_at = addMinutesIsoWIB(issued_at, ttlMinutes); // WIB

  await appendRow(tabs.TOKENS, [
    token, nama_teknisi, nama_odc, keperluan,
    requesterId, "PENDING", issued_at, expires_at, ""
  ]);

  await appendRow(tabs.LOGS, [
    nowIsoWIB(), requesterId, "ISSUE_TOKEN", `${token}|${nama_odc}|${keperluan}`
  ]);

  return { token, issued_at, expires_at };
}

export async function consumeToken({ token, odc, usedAtIso }) {
  const api = sheetsRW();
  const { header, rows } = await readAll(tabs.TOKENS);
  if (!header.length) return { ok: false, reason: "NO_HEADER" };

  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  let rowIndex = -1;
  const now = new Date(usedAtIso || nowIsoWIB());

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const tk = String(row[idx.token] || "");
    const rowOdc = String(row[idx.nama_odc] || "");
    const status = String(row[idx.status] || "");
    const exp = new Date(String(row[idx.expires_at] || ""));
    if (tk === token && rowOdc.toUpperCase() === String(odc).toUpperCase()) {
      if (status !== "PENDING") return { ok: false, reason: "ALREADY_USED_OR_INVALID" };
      if (!(exp instanceof Date) || isNaN(exp)) return { ok: false, reason: "BAD_EXP" };
      if (now > exp) return { ok: false, reason: "EXPIRED" };
      rowIndex = r + 2; // + header
      break;
    }
  }
  if (rowIndex === -1) return { ok: false, reason: "NOT_FOUND" };

  await api.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      valueInputOption: "RAW",
      data: [
        { range: `${tabs.TOKENS}!F${rowIndex}`, values: [["USED"]] },
        { range: `${tabs.TOKENS}!I${rowIndex}`, values: [[usedAtIso || nowIsoWIB()]] }, // WIB
      ],
    },
  });

  await appendRow(tabs.LOGS, [nowIsoWIB(), "ESP", "CONSUME_TOKEN", `${token}|${odc}`]); // WIB
  return { ok: true };
}
