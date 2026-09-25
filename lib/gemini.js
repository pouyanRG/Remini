const { GoogleGenAI } = require('@google/genai');

function getAI() {
  if (!global.__ai) global.__ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return global.__ai;
}

const CHAT_MODEL = () => process.env.GEMINI_CHAT_MODEL || 'gemini-3-flash-preview';
const IMAGE_MODEL = () => process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';

/** چت متنی با حافظهٔ کوتاه‌مدت (تاریخچه از Firestore بازسازی می‌شود — مناسب Serverless) */
async function chatReply({ system, history, message }) {
  const contents = [...history, { role: 'user', parts: [{ text: message }] }];
  const res = await getAI().models.generateContent({
    model: CHAT_MODEL(),
    contents,
    config: { systemInstruction: system, temperature: 0.7 },
  });
  return res.text || '…';
}

/** استخراج خاطرات ماندگار از پیام کاربر (خروجی فقط JSON) */
async function extractMemories(message) {
  try {
    const res = await getAI().models.generateContent({
      model: CHAT_MODEL(),
      contents:
        'از پیام کاربر فقط حقایق ماندگار (نام، علایق، اطلاعات شخصی) را استخراج کن. ' +
        'خروجی فقط یک JSON array از رشته‌ها باشد، هیچ توضیحی ننویس. اگر چیزی نیست: []\nپیام: ' +
        message.slice(0, 2000),
      config: { temperature: 0 },
    });
    const m = (res.text || '').match(/\[[\s\S]*\]/);
    return m ? JSON.parse(m[0]) : [];
  } catch {
    return [];
  }
}

/** تولید یا ادیت تصویر. اگر imageBase64 داده شود => ادیت، وگرنه تولید از متن */
async function generateImage(prompt, imageBase64, mimeType) {
  const parts = [];
  if (imageBase64) parts.push({ inlineData: { mimeType: mimeType || 'image/jpeg', data: imageBase64 } });
  parts.push({ text: prompt });
  const res = await getAI().models.generateContent({ model: IMAGE_MODEL(), contents: [{ role: 'user', parts }] });
  const inline = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!inline) throw new Error('no_image_in_response');
  return { base64: inline.inlineData.data, mimeType: inline.inlineData.mimeType || 'image/png' };
}

module.exports = { chatReply, extractMemories, generateImage };
