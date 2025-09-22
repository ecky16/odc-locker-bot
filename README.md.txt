# ODC Locker Bot — Vercel + Google Sheets


Webhook Telegram di Vercel, database 100% di Google Sheets (whitelist, tokens, logs, state).


## Setup
1. Buat Service Account di Google Cloud → aktifkan Google Sheets API.
2. Ambil `client_email` & `private_key` SA → isi ke env:
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY` (newline jadi `\n`)
3. Share Spreadsheet ke email SA (Editor). Catat `SPREADSHEET_ID`.
4. Isi env Telegram:
- `BOT_TOKEN` (dari @BotFather)
- `TOKEN_TTL_MIN` (menit, default 3)
5. Deploy via GitHub → Vercel.
6. Set webhook: