const { getOrCreateUser } = require('../lib/firebase');
const { handleCallback, handleMessage } = require('../src/router');

/**
 * POST /api/webhook
 * تلگرام آپدیت‌ها را اینجا می‌فرستد.
 * امنیت: هدر مخفی secret_token باید مطابق WEBHOOK_SECRET باشد،
 * در غیر این صورت درخواست رد می‌شود (جلوگیری از اسپووفینگ).
 */
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  if (req.headers['x-telegram-bot-api-secret-token'] !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ ok: false });
  }

  const update = req.body || {};

  try {
    // ── User Resolver ──
    const tgUser = update.message?.from || update.callback_query?.from;
    if (!tgUser) return res.status(200).json({ ok: true });
    const user = await getOrCreateUser(tgUser);
    if (user.isBlocked) return res.status(200).json({ ok: true });
    const ctx = { user, chatId: update.message?.chat?.id || update.callback_query?.message?.chat?.id };

    if (update.callback_query) {
      await handleCallback(ctx, update.callback_query);
    } else if (update.message) {
      await handleMessage(ctx, update.message);
    }
  } catch (e) {
    // هر خطایی رخ دهد، به تلگرام 200 برمی‌گردانیم تا آپدیت ری‌تلای نشود
    console.error('[webhook]', e);
  }
  return res.status(200).json({ ok: true });
};
