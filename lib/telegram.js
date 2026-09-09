const BASE = () => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

async function tg(method, payload = {}, isForm = false) {
  const res = await fetch(`${BASE()}/${method}`, {
    method: 'POST',
    headers: isForm ? undefined : { 'Content-Type': 'application/json' },
    body: isForm ? payload : JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) console.error(`[tg:${method}]`, JSON.stringify(data).slice(0, 400));
  return data;
}

async function sendMessage(chatId, text, extra = {}) {
  return tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
}

/** ارسال عکس از روی base64 (خروجی Gemini) */
async function sendPhotoBase64(chatId, base64, mimeType = 'image/png', extra = {}) {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  if (extra.caption) form.append('caption', extra.caption);
  if (extra.reply_markup) form.append('reply_markup', JSON.stringify(extra.reply_markup));
  form.append('photo', new Blob([Buffer.from(base64, 'base64')], { type: mimeType }), 'result.png');
  return tg('sendPhoto', form, true);
}

async function editMessageText(chatId, messageId, text, extra = {}) {
  return tg('editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', ...extra });
}

async function answerCallback(id, text = '') {
  return tg('answerCallbackQuery', { callback_query_id: id, text });
}

/** دانلود فایل (عکس ارسالی کاربر) و تبدیل به base64 */
async function downloadFileBase64(fileId) {
  const f = await tg('getFile', { file_id: fileId });
  const filePath = f?.result?.file_path;
  if (!filePath) throw new Error('file_not_found');
  const url = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${filePath}`;
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  if (buf.length > 20 * 1024 * 1024) throw new Error('file_too_large'); // سقف امنیتی ۲۰MB
  const mime = filePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
  return { base64: buf.toString('base64'), mimeType: mime };
}

async function setWebhook(url, secret) {
  return tg('setWebhook', { url, secret_token: secret, drop_pending_updates: false, allowed_updates: ['message', 'callback_query'] });
}

module.exports = { tg, sendMessage, sendPhotoBase64, editMessageText, answerCallback, downloadFileBase64, setWebhook };
