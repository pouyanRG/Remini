const { getDb, COL, FieldValue } = require('./firebase');

/**
 * صف سادهٔ تصویر روی Firestore.
 * وقتی کاربر درخواست ادیت/تولید می‌دهد، job ساخته می‌شود و
 * کرون هر ۳۰ ثانیه jobهای pending را پردازش می‌کند.
 * مزیت: ربات فوراً پاسخ می‌دهد («در صف قرار گرفت») و کاربر منتظر نمی‌ماند.
 */
async function enqueueImageJob({ userId, chatId, kind, promptId, promptText, photoBase64, photoMime }) {
  const db = getDb();
  const ref = await db.collection(COL.queue).add({
    userId: String(userId),
    chatId: String(chatId),
    kind,                 // 'create' | 'edit'
    promptId: promptId || null,
    promptText,
    photoBase64: photoBase64 || null,
    photoMime: photoMime || null,
    status: 'pending',    // pending | processing | done | failed
    attempts: 0,
    createdAt: Date.now(),
    processedAt: null,
    error: null,
  });
  return ref.id;
}

/** برداشتن batch از jobهای pending (قفل ساده با status=processing) */
async function claimPendingJobs(limit = 3) {
  const db = getDb();
  const snap = await db.collection(COL.queue)
    .where('status', '==', 'pending')
    .orderBy('createdAt', 'asc')
    .limit(limit)
    .get();
  const jobs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  for (const j of jobs) {
    await db.collection(COL.queue).doc(j.id).update({ status: 'processing', attempts: FieldValue.increment(1) });
  }
  return jobs;
}

async function markJobDone(id, patch) {
  await getDb().collection(COL.queue).doc(id).update({ status: 'done', processedAt: Date.now(), ...patch });
}

async function markJobFailed(id, error) {
  const ref = getDb().collection(COL.queue).doc(id);
  const snap = await ref.get();
  const attempts = snap.data()?.attempts || 1;
  // بعد از ۳ تلاش ناموفق => failed نهایی
  await ref.update({
    status: attempts >= 3 ? 'failed' : 'pending',
    error: String(error).slice(0, 300),
    processedAt: Date.now(),
  });
}

/** حذف jobهای قدیمی done/failed (Retention) */
async function cleanupOldJobs(olderThanMs = 24 * 3600 * 1000) {
  const db = getDb();
  const cutoff = Date.now() - olderThanMs;
  const snap = await db.collection(COL.queue)
    .where('status', 'in', ['done', 'failed'])
    .where('processedAt', '<', cutoff)
    .limit(200)
    .get();
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  return snap.size;
}

module.exports = { enqueueImageJob, claimPendingJobs, markJobDone, markJobFailed, cleanupOldJobs };
