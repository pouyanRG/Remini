const { getDb, COL, FieldValue } = require('./firebase');

/**
 * Rate Limit ساده per-user با پنجرهٔ زمانی ثابت.
 * سقف‌ها از env خوانده می‌شوند:
 *   RATE_LIMIT_IMAGE_MAX  (پیش‌فرض 5 در RATE_LIMIT_WINDOW_MIN دقیقه)
 *   RATE_LIMIT_CHAT_MAX   (پیش‌فرض 30 در همان پنجره)
 */
const WINDOW_MS = () => Number(process.env.RATE_LIMIT_WINDOW_MIN || 1) * 60 * 1000;

function windowStart() {
  return Math.floor(Date.now() / WINDOW_MS()) * WINDOW_MS();
}

/**
 * بررسی و ثبت مصرف. اگر سقف پر شده باشد { allowed:false, retryAfterSec } برمی‌گرداند.
 * @param {'image'|'chat'} kind
 */
async function consumeQuota(userId, kind) {
  const db = getDb();
  const ws = windowStart();
  const ref = db.collection(COL.usage).doc(`${userId}_${ws}`);
  const max = kind === 'image'
    ? Number(process.env.RATE_LIMIT_IMAGE_MAX || 5)
    : Number(process.env.RATE_LIMIT_CHAT_MAX || 30);

  const snap = await ref.get();
  const data = snap.exists ? snap.data() : { image: 0, chat: 0 };
  const used = data[kind] || 0;

  if (used >= max) {
    const retryAfterSec = Math.ceil((ws + WINDOW_MS() - Date.now()) / 1000);
    return { allowed: false, retryAfterSec, used, max };
  }

  await ref.set({ [kind]: FieldValue.increment(1), userId, windowStart: ws }, { merge: true });
  return { allowed: true, used: used + 1, max };
}

/** آمار مصرف امروز کاربر (برای نمایش در پروفایل) */
async function todayUsage(userId) {
  const db = getDb();
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const snap = await db.collection(COL.usage)
    .where('userId', '==', String(userId))
    .where('windowStart', '>=', start.getTime())
    .get();
  let image = 0, chat = 0;
  snap.docs.forEach((d) => { image += d.data().image || 0; chat += d.data().chat || 0; });
  return { image, chat };
}

module.exports = { consumeQuota, todayUsage, WINDOW_MS };
