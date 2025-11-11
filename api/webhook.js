// api/webhook.js

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true });
  }

  const secret = req.headers['x-telegram-bot-api-secret-token'];
  if (secret !== process.env.TG_WEBHOOK_SECRET) {
    console.error('Invalid secret token');
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  const update = req.body;

  try {
    if (!process.env.APP_SCRIPT_URL) {
      console.error('APP_SCRIPT_URL not set');
    } else {
      await fetch(process.env.APP_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ update }),
      });
    }

    // Selalu balas 200 ke Telegram biar nggak retry
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Error forwarding to GAS:', err);
    return res.status(200).json({ ok: true });
  }
}
