const { setWebhook } = require('../lib/telegram');

/**
 * GET /api/set-webhook?key=SETUP_KEY
 * فقط یک‌بار بعد از دیپلوی اجرا کن تا webhook روی آدرس Vercel تنظیم شود.
 * با VERSEC_URL خودِ Vercel کار می‌کند.
 */
module.exports = async (req, res) => {
  if (req.query.key !== process.env.SETUP_KEY) return res.status(401).json({ ok: false });
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const url = `${proto}://${host}/api/webhook`;
  const r = await setWebhook(url, process.env.WEBHOOK_SECRET);
  return res.json({ ok: r.ok, url, result: r });
};
