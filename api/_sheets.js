import { google } from "googleapis";
export async function setupSheets() {
await ensureHeaders(whitelist, ["telegram_id","nama","role"]);
await ensureHeaders(tokens, [
"token","nama_teknisi","nama_odc","keperluan","requester_id","status","issued_at","expires_at","used_at"
]);
await ensureHeaders(state, [
"chat_id","step","requester_id","nama_teknisi","nama_odc","keperluan","updated_at"
]);
await ensureHeaders(logs, ["time","actor","action","detail"]);
}


export async function appendRow(tab, row) {
const api = sheets();
await api.spreadsheets.values.append({
spreadsheetId: SPREADSHEET_ID,
range: `${tab}!A1`,
valueInputOption: "RAW",
insertDataOption: "INSERT_ROWS",
requestBody: { values: [row] }
});
}


export async function readAll(tab) {
const api = sheets();
const resp = await api.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${tab}!A1:Z` });
const values = resp.data.values || [];
if (values.length === 0) return { header: [], rows: [] };
const header = values[0];
const rows = values.slice(1);
return { header, rows };
}


export async function findAndUpdateToken({ token, odc, toStatus, usedAt }) {
const api = sheets();
const { header, rows } = await readAll(tokens);
const idx = Object.fromEntries(header.map((h, i) => [h, i]));
let rowIndex = -1;
for (let r = 0; r < rows.length; r++) {
const row = rows[r];
if (String(row[idx.token]) === String(token) && String(row[idx.nama_odc]).toUpperCase() === String(odc).toUpperCase()) {
rowIndex = r + 2; // 1-based + header
break;
}
}
if (rowIndex === -1) return false;
const statusRange = `${tokens}!F${rowIndex}`; // status
const usedAtRange = `${tokens}!I${rowIndex}`; // used_at
const data = [
{ range: statusRange, values: [[toStatus]] },
...(usedAt ? [{ range: usedAtRange, values: [[usedAt]] }] : [])
];
await api.spreadsheets.values.batchUpdate({
spreadsheetId: SPREADSHEET_ID,
requestBody: { valueInputOption: "RAW", data }
});
return true;
}


export const tabs = { whitelist, tokens, state, logs };
