const { updateUser, listPrompts, getDb, COL } = require('../lib/firebase');
const { sendMessage, sendPhotoBase64, editMessageText, downloadFileBase64, answerCallback } = require('../lib/telegram');
const { chatReply, extractMemories, generateImage } = require('../lib/gemini');
const { mainMenu, imageMenu, promptsKeyboard, backToImage, cancelOnly, adminMenu } = require('../lib/keyboards');
const { consumeQuota, todayUsage } = require('../lib/ratelimit');
const { enqueueImageJob } = require('../lib/queue');

const GREETING =
  '👋 سلام!\n' +
  'به ربات هوش مصنوعی خوش آمدید.\n\n' +
  'از منوی پایین بخش موردنظرت را انتخاب کن:';

/* ─────────────────────────── Callback Router ─────────────────────────── */

async function handleCallback(ctx, cq) {
  const { user } = ctx;
  const data = cq.data || '';
  const chatId = cq.message.chat.id;
  const msgId = cq.message.message_id;
  const isOwner = String(user.id) === String(process.env.TELEGRAM_OWNER_ID);
  const ownerNote = isOwner ? '\n\n🔐 /admin — پنل مدیریت' : '';

  if (data === 'menu_main') {
    await updateUser(user.id, { state: 'idle', pendingPromptId: null });
    await editMessageText(chatId, msgId, GREETING + ownerNote, { reply_markup: mainMenu() });
    return answerCallback(cq.id);
  }

  if (data === 'menu_chat') {
    await updateUser(user.id, { state: 'chat' });
    await editMessageText(chatId, msgId, '💬 حالت چت فعال شد. هرچی دوست داری بنویس، با حافظهٔ بلندمدت باهات حرف می‌زنم.\nبرای خروج به منوی اصلی برگرد.', { reply_markup: cancelOnly() });
    return answerCallback(cq.id);
  }

  if (data === 'menu_image') {
    await updateUser(user.id, { state: 'idle', pendingPromptId: null });
    await editMessageText(chatId, msgId, '🖼 بخش تصویر — یکی را انتخاب کن:', { reply_markup: imageMenu() });
    return answerCallback(cq.id);
  }

  /* ── تولید تصویر ── */
  if (data === 'img_create') {
    await updateUser(user.id, { state: 'await_create_prompt' });
    const prompts = await listPrompts('create');
    const kb = prompts.length
      ? promptsKeyboard(prompts, 'create')
      : { inline_keyboard: [[{ text: '🔙 بازگشت', callback_data: 'menu_image' }]] };
    await editMessageText(
      chatId, msgId,
      '✨ حالت «تولید تصویر»\n\n📝 پرامپت خودت را بنویس، یا یکی از پرامپت‌های آماده را انتخاب کن:',
      { reply_markup: kb }
    );
    return answerCallback(cq.id);
  }

  /* ── ادیت تصویر ── */
  if (data === 'img_edit') {
    const prompts = await listPrompts('edit');
    const kb = prompts.length
      ? promptsKeyboard(prompts, 'edit')
      : { inline_keyboard: [[{ text: '🔙 بازگشت', callback_data: 'menu_image' }]] };
    await editMessageText(
      chatId, msgId,
      '🎨 حالت «ادیت تصویر»\n\nیکی از پرامپت‌های زیر را انتخاب کن، بعد عکست را بفرست:',
      { reply_markup: kb }
    );
    return answerCallback(cq.id);
  }

  /* ── صفحه‌بندی پرامپت‌ها ── */
  const pg = data.match(/^pg:(create|edit):(\d+)$/);
  if (pg) {
    const [, cat, p] = pg;
    const prompts = await listPrompts(cat);
    await editMessageText(chatId, msgId, 'یکی از پرامپت‌ها را انتخاب کن:', { reply_markup: promptsKeyboard(prompts, cat, Number(p)) });
    return answerCallback(cq.id);
  }

  /* ── انتخاب پرامپت ── */
  const pr = data.match(/^pr:(create|edit):(.+)$/);
  if (pr) {
    const [, cat, promptId] = pr;
    const doc = await getDb().collection(COL.prompts).doc(promptId).get();
    if (!doc.exists) return answerCallback(cq.id, 'این پرامپت حذف شده است');
    const prompt = doc.data();

    if (cat === 'edit') {
      await updateUser(user.id, { state: 'await_photo', pendingPromptId: promptId });
      await editMessageText(
        chatId, msgId,
        `🎨 پرامپت «${prompt.title}» انتخاب شد.\n\n📷 حالا عکسی که می‌خواهی ${prompt.title} شود را بفرست:`,
        { reply_markup: cancelOnly() }
      );
      return answerCallback(cq.id);
    }

    // تولید تصویر با پرامپت آماده → صف
    const quota = await consumeQuota(user.id, 'image');
    if (!quota.allowed) {
      await answerCallback(cq.id, `⏳ سقف ${quota.max} تصویر در دقیقه. ${quota.retryAfterSec} ثانیه دیگر.`);
      return;
    }
    await answerCallback(cq.id, '✅ در صف پردازش قرار گرفت');
    await editMessageText(chatId, msgId, `✨ پرامپت «${prompt.title}» در صف پردازش است...\n\n📊 امروز: ${quota.used}/${quota.max} تصویر`, { reply_markup: cancelOnly() });
    await enqueueImageJob({ userId: user.id, chatId, kind: 'create', promptId, promptText: prompt.text });
    return;
  }

  /* ── پنل ادمین ── */
  if (data.startsWith('adm_')) {
    const { handleAdminCallback } = require('./admin');
    return handleAdminCallback(ctx, cq);
  }

  return answerCallback(cq.id);
}

/* ─────────────────────────── Message Router ─────────────────────────── */

async function handleMessage(ctx, msg) {
  const { user } = ctx;
  const chatId = msg.chat.id;

  // ── کامندها
  if (msg.text === '/start') {
    const isOwner = String(user.id) === String(process.env.TELEGRAM_OWNER_ID);
    await updateUser(user.id, { state: 'idle' });
    return sendMessage(chatId, GREETING + (isOwner ? '\n\n🔐 /admin — پنل مدیریت' : ''), { reply_markup: mainMenu() });
  }
  if (msg.text === '/cancel') {
    await updateUser(user.id, { state: 'idle', pendingPromptId: null });
    return sendMessage(chatId, 'لغو شد. به منوی اصلی برگشتی.', { reply_markup: mainMenu() });
  }
  if (msg.text === '/admin') {
    const { openAdminPanel } = require('./admin');
    return openAdminPanel(ctx);
  }

  // ── استیت‌های ادمین
  if (user.state && user.state.startsWith('admin_')) {
    const { handleAdminMessage } = require('./admin');
    return handleAdminMessage(ctx, msg);
  }

  // ── چت با Gemini
  if (user.state === 'chat' && msg.text) {
    const quota = await consumeQuota(user.id, 'chat');
    if (!quota.allowed) {
      return sendMessage(chatId, `⏳ سقف ${quota.max} پیام در دقیقه. ${quota.retryAfterSec} ثانیه دیگر.`, { reply_markup: cancelOnly() });
    }
    await sendMessage(chatId, '⏳ ...');
    const system = buildSystemPrompt(user.memories || []);
    try {
      const reply = await chatReply({ system, history: toGeminiHistory(user.history || []), message: msg.text });
      await updateUser(user.id, {
        history: trimHistory([...(user.history || []), { role: 'user', text: msg.text }, { role: 'model', text: reply }]),
      });
      await sendMessage(chatId, reply, { reply_markup: cancelOnly() });
    } catch (e) {
      console.error(e);
      await sendMessage(chatId, '⚠️ خطا در پاسخ‌دهی. دوباره تلاش کن.');
    }
    // Memory Detector — در پس‌زمینهٔ منطقی، نتیجه‌اش را ذخیره می‌کنیم
    detectAndSaveMemories(user.id, msg.text, user.memories || []);
    return;
  }

  // ── تولید تصویر با متن آزاد → صف
  if (user.state === 'await_create_prompt' && msg.text) {
    const prompt = msg.text.slice(0, 4000);
    const quota = await consumeQuota(user.id, 'image');
    if (!quota.allowed) {
      return sendMessage(chatId, `⏳ سقف ${quota.max} تصویر در دقیقه. ${quota.retryAfterSec} ثانیه دیگر دوباره تلاش کن.`, { reply_markup: backToImage() });
    }
    await sendMessage(chatId, `✅ در صف پردازش قرار گرفت.\n📊 امروز: ${quota.used}/${quota.max} تصویر`, { reply_markup: backToImage() });
    await enqueueImageJob({ userId: user.id, chatId, kind: 'create', promptText: prompt });
    return;
  }

  // ── ادیت تصویر: دریافت عکس
  if (user.state === 'await_photo') {
    const photo = msg.photo?.[msg.photo.length - 1];
    if (!photo) return sendMessage(chatId, '📷 لطفاً یک عکس ارسال کن (فایل یا عکس معمولی).');
    const doc = await getDb().collection(COL.prompts).doc(user.pendingPromptId).get();
    if (!doc.exists) {
      await updateUser(user.id, { state: 'idle', pendingPromptId: null });
      return sendMessage(chatId, '⚠️ پرامپت انتخاب‌شده دیگر موجود نیست.', { reply_markup: imageMenu() });
    }
    const prompt = doc.data();
    const quota = await consumeQuota(user.id, 'image');
    if (!quota.allowed) {
      return sendMessage(chatId, `⏳ سقف ${quota.max} تصویر در دقیقه. ${quota.retryAfterSec} ثانیه دیگر دوباره تلاش کن.`, { reply_markup: backToImage() });
    }
    await sendMessage(chatId, `✅ عکس دریافت شد. «${prompt.title}» در صف پردازش است...\n📊 امروز: ${quota.used}/${quota.max} تصویر`);
    try {
      const file = await downloadFileBase64(photo.file_id);
      await updateUser(user.id, { state: 'idle', pendingPromptId: null });
      await enqueueImageJob({ userId: user.id, chatId, kind: 'edit', promptId: user.pendingPromptId, promptText: prompt.text, photoBase64: file.base64, photoMime: file.mimeType });
    } catch (e) {
      console.error(e);
      await sendMessage(chatId, '⚠️ خطا در دریافت عکس. دوباره تلاش کن.', { reply_markup: backToImage() });
    }
    return;
  }

  // پیش‌فرض
  await sendMessage(chatId, 'از منوی پایین انتخاب کن:', { reply_markup: mainMenu() });
}

/* ─────────────────────────── Helpers ─────────────────────────── */

function buildSystemPrompt(memories) {
  const base =
    'تو یک دستیار فارسی‌زبان دوستانه و کاربلد هستی. به فارسی روان و محاوره‌ای پاسخ بده. ' +
    'اگر کاربر اطلاعاتی دربارهٔ خودش داده، در پاسخ‌ها به آن‌ها اشاره کن.';
  return memories.length ? `${base}\n\nخاطرات کاربر:\n- ${memories.join('\n- ')}` : base;
}

function toGeminiHistory(history) {
  return history.slice(-20).map((h) => ({ role: h.role, parts: [{ text: h.text }] }));
}

function trimHistory(h) {
  return h.length > 40 ? h.slice(-40) : h;
}

/** Memory Detector: تشخیص سریع الگوی name = X + استخراج هوشمند با Gemini */
async function detectAndSaveMemories(userId, text, existing) {
  const facts = [];
  const m = text.match(/(?:^|\s)name\s*=\s*([^\n]+)/i);
  if (m) facts.push(`نام کاربر: ${m[1].trim()}`);
  const aiFacts = await extractMemories(text);
  facts.push(...aiFacts.filter((f) => typeof f === 'string' && f.trim()));
  if (!facts.length) return;
  const merged = [...existing];
  for (const f of facts) if (!merged.includes(f)) merged.push(f);
  await updateUser(userId, { memories: merged.slice(-50) });
}

module.exports = { handleCallback, handleMessage };
