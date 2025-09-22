// /api/health.js
export default async function handler(req, res) {
  try {
    const token = process.env.BOT_TOKEN || "";
    const hasToken = !!token;
    let me = null, code = 0;
    if (hasToken) {
      const r = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      code = r.status;
      me = await r.json().catch(() => ({}));
    }
    return res.status(200).json({
      ok: true,
      env: { hasToken, NODE_ENV: process.env.NODE_ENV || null },
      getMe: { code, me }
    });
  } catch (e) {
    return res.status(500).json({ ok: false, err: String(e) });
  }
}
