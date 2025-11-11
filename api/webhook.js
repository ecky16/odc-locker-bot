// api/webhook.js

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true });
  }

  // Security: cek secret token dari Telegram
  const secret = req.headers['x-telegram-bot-api-secret-token'];
  if (secret !== process.env.TG_WEBHOOK_SECRET) {
    console.error('Invalid secret token');
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  const update = req.body;

  try {
    if (update.message && update.message.text) {
      const text = update.message.text.trim();
      const chatId = update.message.chat.id;

      // /start
      if (text === '/start') {
        await sendTelegramMessage(chatId,
          'Halo, aku bot PIN gembok ODC 🔐\n\n' +
          'Perintah yang bisa dipakai:\n' +
          '`/minta_pin <ODC_ID>` – minta PIN ODC\n' +
          '`/selesai <ODC_ID>` – selesai kerja, ganti PIN baru',
          'Markdown'
        );
      }

      // /minta_pin
      if (text.startsWith('/minta_pin')) {
        await callGas('MINTA_PIN', update);
      }

      // /selesai
      if (text.startsWith('/selesai')) {
        await callGas('SELESAI_PIN', update);
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Error in webhook handler:', err);
    // Tetep balas 200 supaya Telegram nggak spam retry
    return res.status(200).json({ ok: true });
  }
}

async function sendTelegramMessage(chatId, text, parseMode) {
  const url = `https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`;

  const body = { chat_id: chatId, text };
  if (parseMode) body.parse_mode = parseMode;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('Error sendTelegramMessage:', errText);
  }
}

async function callGas(action, update) {
  if (!process.env.APP_SCRIPT_URL) {
    console.error('APP_SCRIPT_URL not set');
    return;
  }

  const payload = { action, update };

  const res = await fetch(process.env.APP_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  console.log('GAS response:', text);
}
