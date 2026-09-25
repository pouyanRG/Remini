const { updateUser, isAdmin, getDb, COL, FieldValue } = require('../lib/firebase');
const { sendMessage, editMessageText, answerCallback } = require('../lib/telegram');
const { adminMenu } = require('../lib/keyboards');

/** ورود به پنل ادمین — فقط صاحب توکن یا ادمین‌های ثبت‌شده در Firestore */
async function openAdminPanel(ctx) {
  const { user } = ctx;
  if (!(await isAdmin(user.id))) {
    return sendMessage(ctx.chatId, '⛔ دسترسی نداری.');
  }
  await updateUser(user.id, { state: 'idle' });
  return sendMessage(ctx.chatId, '🔐 پنل مدیریت\nیکی از گزینه‌ها را انتخاب کن:', { reply_markup: adminMenu() });
}

async function handleAdminCallback(ctx, cq) {
  const { user } = ctx;
  const chatId = cq.message.chat.id;
  const msgId = cq.message.message_id;
  const data = cq.data;

  if (!(await isAdmin(user.id))) return answerCallback(cq.id, '⛔');

  if (data === 'adm_menu') {
    await updateUser(user.id, { state: 'idle' });
    await editMessageText(chatId, msgId, '🔐 پنل مدیریت:', { reply_markup: adminMenu() });
    return answerCallback(cq.id);
  }

  /* ── افزودن پرامپت: ابتدا انتخاب دسته ── */
  if (data === 'adm_add_prompt') {
    await editMessageText(chatId, msgId, 'دستهٔ پرامپت را انتخاب کن:', {
      inline_keyboard: [
        [{ text: '✨ تولید تصویر', callback_data: 'adm_cat:create' }],
        [{ text: '🎨 ادیت تصویر', callback_data: 'adm_cat:edit' }],
        [{ text: '🔙', callback_data: 'adm_menu' }],
      ],
    });
    return answerCallback(cq.id);
  }

  const cat = data.match(/^adm_cat:(create|edit)$/);
  if (cat) {
    await updateUser(user.id, { state: `admin_add_prompt:${cat[1]}` });
    await editMessageText(
      chatId, msgId,
      `📝 دسته: ${cat[1] === 'create' ? 'تولید تصویر' : 'ادیت تصویر'}\n\n` +
      'حالا در «یک پیام» این ساختار را بفرست:\n' +
      'خط اول → عنوان پرامپت\n' +
      'خط دوم → متن پرامپت',
      { reply_markup: { inline_keyboard: [[{ text: '🔙', callback_data: 'adm_menu' }]] } }
    );
    return answerCallback(cq.id);
  }

  if (data === 'adm_stats') {
    await showStats(ctx, chatId, msgId);
    return answerCallback(cq.id);
  }

  /* ── لیست و حذف پرامپت‌ها ── */
  if (data === 'adm_list_prompts' || data.startsWith('adml:')) {
    const page = data.startsWith('adml:') ? Number(data.split(':')[1]) : 0;
    const snap = await getDb().collection(COL.prompts).orderBy('createdAt', 'desc').get();
    const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const per = 6;
    const slice = all.slice(page * per, page * per + per);
    const rows = slice.map((p) => [
      { text: `${p.category === 'edit' ? '🎨' : '✨'} ${p.title}`.slice(0, 55), callback_data: `noop` },
      { text: '🗑', callback_data: `admdel:${p.id}` },
    ]);
    const nav = [];
    if (page > 0) nav.push({ text: '⬅️', callback_data: `adml:${page - 1}` });
    if ((page + 1) * per < all.length) nav.push({ text: '➡️', callback_data: `adml:${page + 1}` });
    if (nav.length) rows.push(nav);
    rows.push([{ text: '🔙', callback_data: 'adm_menu' }]);
    await editMessageText(chatId, msgId, `📋 پرامپت‌ها (${all.length}):`, { reply_markup: { inline_keyboard: rows } });
    return answerCallback(cq.id);
  }

  const del = data.match(/^admdel:(.+)$/);
  if (del) {
    await getDb().collection(COL.prompts).doc(del[1]).delete();
    await answerCallback(cq.id, '🗑 حذف شد');
    const snap = await getDb().collection(COL.prompts).orderBy('createdAt', 'desc').limit(6).get();
    const rows = snap.docs.map((d) => [{ text: d.data().title.slice(0, 55), callback_data: 'noop' }, { text: '🗑', callback_data: `admdel:${d.id}` }]);
    rows.push([{ text: '🔙', callback_data: 'adm_menu' }]);
    await editMessageText(chatId, msgId, '🗑 حذف شد. لیست به‌روز:', { reply_markup: { inline_keyboard: rows } });
    return;
  }

  /* ── مدیریت ادمین‌ها ── */
  if (data === 'adm_add_admin') {
    if (String(user.id) !== String(process.env.TELEGRAM_OWNER_ID)) {
      return answerCallback(cq.id, '⛔ فقط صاحب توکن ادمین اضافه می‌کند');
    }
    await updateUser(user.id, { state: 'admin_add_admin' });
    await editMessageText(chatId, msgId, '👤 آیدی عددی تلگرام فرد را بفرست (مثلاً 123456789):', {
      reply_markup: { inline_keyboard: [[{ text: '🔙', callback_data: 'adm_menu' }]] },
    });
    return answerCallback(cq.id);
  }

  if (data === 'adm_list_admins' || data.startsWith('admrdel:') || data.startsWith('admla:')) {
    if (String(user.id) !== String(process.env.TELEGRAM_OWNER_ID)) {
      return answerCallback(cq.id, '⛔ فقط صاحب توکن');
    }
    if (data.startsWith('admrdel:')) {
      const target = data.split(':')[1];
      if (String(target) === String(process.env.TELEGRAM_OWNER_ID)) return answerCallback(cq.id, '⛔ نمی‌توان صاحب را حذف کرد');
      await getDb().collection(COL.admins).doc(target).delete();
      await answerCallback(cq.id, '🗑 حذف شد');
    }
    const page = data.startsWith('admla:') ? Number(data.split(':')[1]) : 0;
    const snap = await getDb().collection(COL.admins).get();
    const rows = snap.docs.map((d) => [
      { text: `👤 ${d.id}`, callback_data: 'noop' },
      { text: '🗑', callback_data: `admrdel:${d.id}` },
    ]);
    rows.push([{ text: '🔙', callback_data: 'adm_menu' }]);
    await editMessageText(chatId, msgId, `📃 ادمین‌ها (${rows.length - 1} نفر + صاحب توکن):`, { reply_markup: { inline_keyboard: rows } });
    return;
  }

  return answerCallback(cq.id);
}

async function handleAdminMessage(ctx, msg) {
  const { user } = ctx;
  const chatId = msg.chat.id;

  /* افزودن پرامپت — فرمت دو خطی */
  const addState = (user.state || '').match(/^admin_add_prompt:(create|edit)$/);
  if (addState && msg.text) {
    const lines = msg.text.split('\n');
    if (lines.length < 2) return sendMessage(chatId, '⚠️ خط اول عنوان و خط دوم متن پرامپت باشد.');
    const title = lines[0].trim().slice(0, 80);
    const text = lines.slice(1).join('\n').trim().slice(0, 4000);
    if (!title || !text) return sendMessage(chatId, '⚠️ عنوان و متن نمی‌توانند خالی باشند.');
    await getDb().collection(COL.prompts).add({ title, text, category: addState[1], createdBy: String(user.id), createdAt: Date.now() });
    await updateUser(user.id, { state: 'idle' });
    return sendMessage(chatId, `✅ پرامپت «${title}» ذخیره شد.`, { reply_markup: adminMenu() });
  }

  /* افزودن ادمین — فقط صاحب توکن */
  if (user.state === 'admin_add_admin') {
    if (String(user.id) !== String(process.env.TELEGRAM_OWNER_ID)) {
      await updateUser(user.id, { state: 'idle' });
      return sendMessage(chatId, '⛔ فقط صاحب توکن.');
    }
    const target = (msg.text || '').trim();
    if (!/^\d{3,20}$/.test(target)) return sendMessage(chatId, '⚠️ آیدی باید عددی باشد (مثلاً 123456789).');
    await getDb().collection(COL.admins).doc(target).set({ addedBy: String(user.id), addedAt: Date.now() });
    await updateUser(user.id, { state: 'idle' });
    return sendMessage(chatId, `✅ ادمین ${target} اضافه شد.`, { reply_markup: adminMenu() });
  }

  await updateUser(user.id, { state: 'idle' });
  return sendMessage(chatId, 'نامشخص. به پنل برگرد.', { reply_markup: adminMenu() });
}

/** آمار کلی ربات */
async function showStats(ctx, chatId, msgId) {
  const db = getDb();
  const [users, prompts, queueSnap, usageSnap] = await Promise.all([
    db.collection(COL.users).get(),
    db.collection(COL.prompts).get(),
    db.collection(COL.queue).where('status', '==', 'pending').get(),
    db.collection(COL.usage).get(),
  ]);
  let totalImages = 0, totalChats = 0;
  usageSnap.docs.forEach((d) => { totalImages += d.data().image || 0; totalChats += d.data().chat || 0; });

  const topPrompts = prompts.docs
    .map((d) => ({ title: d.data().title, count: d.data().usageCount || 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const text =
    `📊 آمار ربات\n\n` +
    `👥 کاربران: ${users.size}\n` +
    `📌 پرامپت‌ها: ${prompts.size}\n` +
    `⏳ در صف: ${queueSnap.size}\n\n` +
    `🖼 کل تصاویر: ${totalImages}\n` +
    `💬 کل چت‌ها: ${totalChats}\n\n` +
    `🏆 پرکاربردترین پرامپت‌ها:\n` +
    (topPrompts.length
      ? topPrompts.map((p, i) => `${i + 1}. ${p.title} (${p.count})`).join('\n')
      : 'هنوز استفاده‌ای نشده');

  const kb = { inline_keyboard: [[{ text: '🔙', callback_data: 'adm_menu' }]] };
  if (msgId) await editMessageText(chatId, msgId, text, { reply_markup: kb });
  else await sendMessage(chatId, text, { reply_markup: kb });
}

module.exports = { openAdminPanel, handleAdminCallback, handleAdminMessage, showStats };
