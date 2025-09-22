// api/_sheets.js
import { google } from "googleapis";
export const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

let _client;
function googleClient() {
  if (_client) return _client;

  // PILIH SALAH SATU SKEMA ENV
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    const creds = JSON.parse(raw);
    if (creds.private_key?.includes("\\n")) {
      creds.private_key = creds.private_key.replace(/\\n/g, "\n");
    }
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    _client = google.sheets({ version: "v4", auth });
    return _client;
  }

  // Atau skema email+key
  const client_email = process.env.GOOGLE_CLIENT_EMAIL;
  let private_key = process.env.GOOGLE_PRIVATE_KEY;
  if (!client_email || !private_key) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_CLIENT_EMAIL/GOOGLE_PRIVATE_KEY");
  }
  if (private_key.includes("\\n")) private_key = private_key.replace(/\\n/g, "\n");
  const auth = new google.auth.GoogleAuth({
    credentials: { client_email, private_key },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  _client = google.sheets({ version: "v4", auth });
  return _client;
}

function sheets() { return googleClient(); }

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
  const cur = (resp.data.values && resp.data.values[0]) || [];
  const same = cur.length === headers.length && cur.every((h,i)=> String(h)===String(headers[i]));
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
  await ensureHeaders("whitelist", ["telegram_id","nama","role"]);
  await ensureHeaders("tokens", [
    "token","nama_teknisi","nama_odc","keperluan",
    "requester_id","status","issued_at","expires_at","used_at"
  ]);
  await ensureHeaders("logs", ["time","actor","action","detail"]);
}

export async function readAll(tabName) {
  const api = sheets();
  const resp = await api.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tabName}!A1:Z`,
  });
  const v = resp.data.values || [];
  if (!v.length) return { header: [], rows: [] };
  return { header: v[0], rows: v.slice(1) };
}

export async function appendRow(tabName, row) {
  const api = sheets();
  await api.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tabName}!A1`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });
}

export async function isAllowed(telegramId) {
  const { header, rows } = await readAll("whitelist");
  if (!header.length) return false;
  const idx = Object.fromEntries(header.map((h,i)=>[h,i]));
  for (const r of rows) {
    const v = String(r[idx.telegram_id] || "").trim().replace(/\.0$/, "");
    if (v && v === String(telegramId)) return true;
  }
  return false;
}

function nowIso() { return new Date().toISOString(); }
function addMinutesISO(iso, minutes) { const d=new Date(iso); d.setMinutes(d.getMinutes()+minutes); return d.toISOString(); }
function rnd4() { return String(Math.floor(1000 + Math.random()*9000)); }
function makeToken() { return `${Date.now().toString(36)}-${rnd4()}`; }

export async function issueToken({ requesterId, nama_teknisi, nama_odc, keperluan, ttlMinutes=3 }) {
  const token = makeToken();
  const issued_at = nowIso();
  const expires_at = addMinutesISO(issued_at, ttlMinutes);
  await appendRow("tokens", [token, nama_teknisi, nama_odc, keperluan, requesterId, "PENDING", issued_at, expires_at, ""]);
  await appendRow("logs", [nowIso(), requesterId, "ISSUE_TOKEN", `${token}|${nama_odc}|${keperluan}`]);
  return { token, issued_at, expires_at };
}

export async function consumeToken({ token, odc, usedAtIso }) {
  const { header, rows } = await readAll("tokens");
  if (!header.length) return { ok:false, reason:"NO_HEADER" };
  const idx = Object.fromEntries(header.map((h,i)=>[h,i]));
  let rowIndex = -1;
  const now = new Date(usedAtIso || nowIso());

  for (let r=0; r<rows.length; r++) {
    const row = rows[r];
    const tk = String(row[idx.token] || "");
    const rowOdc = String(row[idx.nama_odc] || "");
    const status = String(row[idx.status] || "");
    const exp = new Date(String(row[idx.expires_at] || ""));
    if (tk === token && rowOdc.toUpperCase() === String(odc).toUpperCase()) {
      if (status !== "PENDING") return { ok:false, reason:"ALREADY_USED_OR_INVALID" };
      if (!(exp instanceof Date) || isNaN(exp)) return { ok:false, reason:"BAD_EXP" };
      if (now > exp) return { ok:false, reason:"EXPIRED" };
      rowIndex = r + 2; break;
    }
  }
  if (rowIndex === -1) return { ok:false, reason:"NOT_FOUND" };

  const api = sheets();
  await api.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      valueInputOption: "RAW",
      data: [
        { range: `tokens!F${rowIndex}`, values: [["USED"]] },  // status
        { range: `tokens!I${rowIndex}`, values: [[usedAtIso || nowIso()]] }, // used_at
      ],
    },
  });
  await appendRow("logs", [nowIso(), "ESP", "CONSUME_TOKEN", `${token}|${odc}`]);
  return { ok:true };
}
