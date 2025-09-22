// api/_sheets.js
// -----------------------------------------------------------------------------
// Google Sheets helper untuk ODC Locker Bot
// - Tab: whitelist | tokens | logs
// - Token: PIN 4 digit (0000–9999), unik di window non-expired & status PENDING
// - TTL default: 3 menit
// -----------------------------------------------------------------------------
// ENV WAJIB (pilih salah satu skema kredensial):
//   BOT_TOKEN=...                             (dipakai di handler telegram, bukan file ini)
//   SPREADSHEET_ID=1AbCdE...                  (HANYA ID, bukan full URL)
//
//   Opsi A (paling mudah):
//     GOOGLE_SERVICE_ACCOUNT_JSON={...JSON SA...}   <-- boleh multiline; kalau \n akan di-fix
//
//   Opsi B:
//     GOOGLE_CLIENT_EMAIL=xxx@xxx.iam.gserviceaccount.com
//     GOOGLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n
//
// JANGAN lupa: share file spreadsheet ke email Service Account (Editor).
// -----------------------------------------------------------------------------

import { google } from "googleapis";

export const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

export const tabs = {
  WHITELIST: "whitelist",
  TOKENS: "tokens",
  LOGS: "logs",
};

const SCOPES_RW = ["https://www.googleapis.com/auth/spreadsheets"];
const SCOPES_RO = ["https://www.googleapis.com/auth/spreadsheets.readonly"];

// Singleton client
let _sheetsClientRW = null;
let _sheetsClientRO = null;

function buildAuth(scopes) {
  // Skema A: JSON penuh di satu ENV
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    const creds = JSON.parse(raw);
    if (creds.private_key?.includes("\\n")) {
      creds.private_key = creds.private_key.replace(/\\n/g, "\n");
    }
    return new google.auth.GoogleAuth({ credentials: creds, scopes });
  }

  // Skema B: email + key dipisah
  const client_email = process.env.GOOGLE_CLIENT_EMAIL;
  let private_key = process.env.GOOGLE_PRIVATE_KEY;
  if (!client_email || !private_key) {
    throw new Error(
      "Missing GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_CLIENT_EMAIL/GOOGLE_PRIVATE_KEY"
    );
  }
  if (private_key.includes("\\n")) private_key = private_key.replace(/\\n/g, "\n");
  return new google.auth.GoogleAuth({
    credentials: { client_email, private_key },
    scopes,
  });
}

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

// ---------- Utils waktu & token ----------
function nowIso() {
  return new Date().toISOString();
}
function addMinutesISO(iso, minutes) {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() + minutes);
  return d.toISOString();
}
function pin4() {
  // Selalu 4 digit dengan leading zero
  return String(Math.floor(Math.random() * 10000)).padStart(4, "0");
}

// ---------- Sheet housekeeping ----------
async function listSheetTitles() {
  const api = sheetsRO();
  const meta = await api.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  return (meta.data.sheets || [])
    .map((s) => s?.properties?.title)
    .filter(Boolean);
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

  const same =
    current.length === headers.length &&
    current.every((h, i) => String(h) === String(headers[i]));

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
}

// ---------- CRUD sederhana ----------
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

// ---------- Domain logic ----------
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
  // Hindari PIN tabrakan dengan token PENDING yang belum expired
  const { header, rows } = await readAll(tabs.TOKENS);
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const now = new Date();

  for (let attempt = 0; attempt < 25; attempt++) {
    const p = pin4();
    const clash =
      header.length > 0 &&
      rows.some((r) => {
        const tk = String(r[idx.token] || "");
        const st = String(r[idx.status] || "");
        const expStr = String(r[idx.expires_at] || "");
        const exp = new Date(expStr);
        const validExp = exp instanceof Date && !isNaN(exp);
        return tk === p && st === "PENDING" && validExp && now <= exp;
      });
    if (!clash) return p;
  }
  // fallback—peluang clash sangat kecil
  return pin4();
}

export async function issueToken({
  requesterId,
  nama_teknisi,
  nama_odc,
  keperluan,
  ttlMinutes = 3,
}) {
  const token = await makeUniquePin4();
  const issued_at = nowIso();
  const expires_at = addMinutesISO(issued_at, ttlMinutes);

  await appendRow(tabs.TOKENS, [
    token,
    nama_teknisi,
    nama_odc,
    keperluan,
    requesterId,
    "PENDING",
    issued_at,
    expires_at,
    "",
  ]);

  await appendRow(tabs.LOGS, [
    nowIso(),
    requesterId,
    "ISSUE_TOKEN",
    `${token}|${nama_odc}|${keperluan}`,
  ]);

  return { token, issued_at, expires_at };
}

export async function consumeToken({ token, odc, usedAtIso }) {
  const api = sheetsRW();

  const { header, rows } = await readAll(tabs.TOKENS);
  if (!header.length) return { ok: false, reason: "NO_HEADER" };

  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  let rowIndex = -1;
  const now = new Date(usedAtIso || nowIso());

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
      rowIndex = r + 2; // +1 header, +1 index base
      break;
    }
  }

  if (rowIndex === -1) return { ok: false, reason: "NOT_FOUND" };

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

  return { ok: true };
}
