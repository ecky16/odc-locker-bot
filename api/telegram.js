// api/telegram.js — sanity check
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("OK"); // GET di browser harus tampil "OK"
  }
  return res.status(200).send("OK");   // POST dari Telegram juga "OK"
}
export const config = { api: { bodyParser: { sizeLimit: "1mb" } } };
