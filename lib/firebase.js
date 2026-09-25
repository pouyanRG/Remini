const admin = require('firebase-admin');

/**
 * Firestore singleton — مهم در محیط Serverless:
 * در هر invocation سرد، app را فقط یک بار initialize می‌کنیم.
 */
function getDb() {
  if (!global.__db) {
    if (!admin.apps.length) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    }
    global.__db = admin.firestore();
    global.__db.settings({ ignoreUndefinedProperties: true });
  }
  return global.__db;
}

const COL = { users: 'users', prompts: 'prompts', admins: 'admins', usage: 'usage', queue: 'queue' };

/** resolve user: اگر وجود نداشت می‌سازد و برمی‌گرداند */
async function getOrCreateUser(tgUser) {
  const db = getDb();
  const ref = db.collection(COL.users).doc(String(tgUser.id));
  const snap = await ref.get();
  if (snap.exists) {
    await ref.update({ firstName: tgUser.first_name || '', username: tgUser.username || '', lastSeen: Date.now() });
    return { id: String(tgUser.id), ...snap.data() };
  }
  const fresh = {
    firstName: tgUser.first_name || '',
    username: tgUser.username || '',
    state: 'idle',
    pendingPromptId: null,
    history: [],
    memories: [],
    createdAt: Date.now(),
    lastSeen: Date.now(),
    isBlocked: false,
  };
  await ref.set(fresh);
  return { id: String(tgUser.id), ...fresh };
}

async function updateUser(id, patch) {
  await getDb().collection(COL.users).doc(String(id)).update({ ...patch, lastSeen: Date.now() });
}

/** آیا کاربر ادمین است؟ (صاحب توکن یا در مجموعه admins) */
async function isAdmin(id) {
  const sid = String(id);
  if (sid === String(process.env.TELEGRAM_OWNER_ID)) return true;
  const snap = await getDb().collection(COL.admins).doc(sid).get();
  return snap.exists;
}

async function listPrompts(category, limit = 30) {
  const snap = await getDb()
    .collection(COL.prompts)
    .where('category', '==', category)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

module.exports = { getDb, COL, getOrCreateUser, updateUser, isAdmin, listPrompts, FieldValue: admin.firestore.FieldValue };
