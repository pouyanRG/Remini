const { getDb, COL } = require('../lib/firebase');

/**
 * GET /api/cleanup — روزی یک‌بار (Vercel Cron).
 * - تاریخچهٔ چت کاربران را به ۲۰ پیام آخر محدود می‌کند.
 * - کاربرانی که ۹۰ روز غیرفعال بودند، soft-delete (isBlocked=true).
 */
module.exports = async (req, res) => {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ ok: false });
  }

  const db = getDb();
  let trimmed = 0, deactivated = 0;

  // ۱) Trim تاریخچه
  const usersSnap = await db.collection(COL.users).get();
  const batch = db.batch();
  usersSnap.docs.forEach((d) => {
    const h = d.data().history || [];
    if (h.length > 20) {
      batch.update(d.ref, { history: h.slice(-20) });
      trimmed++;
    }
  });
  await batch.commit();

  // ۲) غیرفعال‌سازی کاربران ۹۰ روزه
  const cutoff = Date.now() - 90 * 24 * 3600 * 1000;
  const stale = await db.collection(COL.users)
    .where('lastSeen', '<', cutoff)
    .where('isBlocked', '==', false)
    .limit(200)
    .get();
  const batch2 = db.batch();
  stale.docs.forEach((d) => batch2.update(d.ref, { isBlocked: true }));
  await batch2.commit();
  deactivated = stale.size;

  return res.json({ ok: true, trimmed, deactivated });
};
