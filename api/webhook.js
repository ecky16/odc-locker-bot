// api/webhook.js

export default async function handler(req, res) {
  // Telegram selalu kirim JSON
  const update = req.body;

  // 1. Pesan biasa (chat text)
  if (update.message) {
    const msg    = update.message;
    const chatId = msg.chat.id;
    const text   = msg.text || '';

    // Contoh command minta PIN ODC-PBL-FA
    // Kamu bisa gandakan pola ini buat ODC lain
    if (text.startsWith('/pin_pbl_fa')) {
      // Di sini keperluan masih sederhana
      await callGas({
        action: 'MINTA_PIN',
        idTelegram: String(chatId),
        odcName: 'ODC-PBL-FA',
        keperluan: 'Buka ODC PBL-FA'
      });

      // Biar user dapet feedback cepat (opsional)
      await sendTelegramMessage(chatId, '⏳ Memproses permintaan PIN ODC-PBL-FA...');
    }

    // Kamu bisa tambah:
    // if (text.startsWith('/pin_psn_xx')) { ... }
    // dst
  }

  // 2. Callback Query (tombol inline: Perpanjang / Selesai)
  if (update.callback_query) {
    const cq     = update.callback_query;
    const fromId = cq.from.id;
    const data   = cq.data; // "EXTEND:SessionId" atau "CLOSE:SessionId"

    if (data && data.startsWith('EXTEND:')) {
      const sessionId = data.split(':')[1];

      await callGas({
        action: 'EXTEND_SESSION',
        sessionId,
        fromId: String(fromId)
      });
    }

    if (data && data.startsWith('CLOSE:')) {
      const sessionId = data.split(':')[1];

      await callGas({
        action: 'CLOSE_SESSION',
        sessionId,
        fromId: String(fromId)
      });
    }

    // Jawab callback biar "loading..." di tombol hilang
    await answerCallbackQuery(cq.id);
  }

  // Telegram butuh respon 200 cepat
  res.status(200).json({ ok: true });
}


// =========================
// HELPER – PANGGIL GAS
// =========================
async function callGas(body) {
  const res = await fetch(process.env.GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  // Optional kalau mau lihat log
  // const json = await res.json();
  // console.log('GAS response:', json);
}


// =========================
// HELPER – TELEGRAM DI VERCEL
// =========================
async function sendTelegramMessage(chatId, text) {
  const url = `https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML'
    })
  });
}

async function answerCallbackQuery(callbackQueryId) {
  const url = `https://api.telegram.org/bot${process.env.BOT_TOKEN}/answerCallbackQuery`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId })
  });
}
