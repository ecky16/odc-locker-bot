// _tg.js
export async function sendMessage(chatId, text, token = process.env.BOT_TOKEN) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
}

// util parsing: /minta_kunci Nama;ODC;Keperluan
export function parseMintaKunci(text) {
  const m = text.match(/^\/minta_kunci\s+(.+)$/i);
  if (!m) return null;
  const parts = m[1].split(";").map(s => s.trim());
  if (parts.length < 3) return null;
  const [nama_teknisi, nama_odc, keperluan] = parts;
  if (!nama_teknisi || !nama_odc || !keperluan) return null;
  return { nama_teknisi, nama_odc, keperluan };
}

