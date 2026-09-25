const mainMenu = () => ({
  inline_keyboard: [
    [{ text: '💬 چت با هوش مصنوعی', callback_data: 'menu_chat' }],
    [{ text: '🖼 تصویر', callback_data: 'menu_image' }],
  ],
});

const imageMenu = () => ({
  inline_keyboard: [
    [{ text: '✨ تولید تصویر', callback_data: 'img_create' }],
    [{ text: '🎨 ادیت تصویر', callback_data: 'img_edit' }],
    [{ text: '🔙 بازگشت', callback_data: 'menu_main' }],
  ],
});

const cancelOnly = () => ({ inline_keyboard: [[{ text: '❌ لغو', callback_data: 'menu_main' }]] });

const backToImage = () => ({
  inline_keyboard: [
    [{ text: '🖼 بخش تصویر', callback_data: 'menu_image' }],
    [{ text: '🏠 منوی اصلی', callback_data: 'menu_main' }],
  ],
});

/** ساخت کیبورد پرامپت‌ها با صفحه‌بندی؛ callback: pr:<cat>:<promptId> یا pr:<cat>:page:<n> */
function promptsKeyboard(prompts, category, page = 0, perPage = 8) {
  const total = prompts.length;
  const slice = prompts.slice(page * perPage, page * perPage + perPage);
  const rows = slice.map((p) => [{ text: `📌 ${p.title}`.slice(0, 60), callback_data: `pr:${category}:${p.id}`.slice(0, 64) }]);
  const nav = [];
  if (page > 0) nav.push({ text: '⬅️', callback_data: `pg:${category}:${page - 1}` });
  if ((page + 1) * perPage < total) nav.push({ text: '➡️', callback_data: `pg:${category}:${page + 1}` });
  if (nav.length) rows.push(nav);
  rows.push([{ text: '🔙 بازگشت', callback_data: 'menu_image' }]);
  return { inline_keyboard: rows };
}

const adminMenu = () => ({
  inline_keyboard: [
    [{ text: '➕ افزودن پرامپت', callback_data: 'adm_add_prompt' }],
    [{ text: '📋 لیست / حذف پرامپت‌ها', callback_data: 'adm_list_prompts' }],
    [{ text: '👤 افزودن ادمین', callback_data: 'adm_add_admin' }],
    [{ text: '📃 لیست ادمین‌ها', callback_data: 'adm_list_admins' }],
    [{ text: '📊 آمار ربات', callback_data: 'adm_stats' }],
  ],
});

module.exports = { mainMenu, imageMenu, cancelOnly, backToImage, promptsKeyboard, adminMenu };
