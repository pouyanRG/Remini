# Telegram AI Bot v2.0.0 — Gemini + Vercel + Firestore

ربات تلگرامی هوش مصنوعی با دو بخش **چت** (Gemini 3 Flash) و **تصویر** (تولید/ادیت با مدل تصویری Gemini)،
دیپلوی‌شده روی Vercel (Serverless Webhook) با Firestore به‌عنوان دیتابیس.

## تغییرات نسخه 2.0.0
| قابلیت | توضیح |
|---|---|
| 🛡️ Rate Limiting | سقف درخواست تصویر/چت per-user (پنجره زمانی قابل تنظیم با env) |
| 📊 Usage Tracking | شمارش استفاده از هر پرامپت + آمار کلی ربات در پنل ادمین |
| ⏳ Image Queue | درخواست‌های تصویر در صف Firestore قرار می‌گیرند و کرون هر ۳۰ ثانیه پردازش می‌کند |
| 🗑️ Auto Cleanup | کرون روزانه: trim تاریخچه به ۲۰ پیام + غیرفعال‌سازی کاربران ۹۰ روزه |
| 📈 Admin Stats | دکمه «آمار ربات» در پنل ادمین |

## معماری
```
Telegram ──webhook──▶ Vercel /api/webhook ──▶ User Resolver ──▶ Firestore (users/admins/prompts)
                         │ Memory Detector (استخراج خاطره با Gemini + regex name = X)
                         ├─ حالت chat ────────▶ Gemini 3 Flash (با تاریخچه + خاطرات)
                         ├─ حالت create image ▶ Gemini Image (متن آزاد یا پرامپت آماده از DB)
                         └─ حالت edit image ──▶ دانلود عکس کاربر ──▶ Gemini Image (پرامپت + عکس)
                                                        │ base64
                                                        ▼
                                              Telegram sendPhoto ◀── Save Result در Firestore
```

## ساختار
```
api/webhook.js        ← نقطه ورود تلگرام (POST + احراز secret_token)
api/set-webhook.js    ← تنظیم webhook (یک‌بار، با SETUP_KEY)
lib/firebase.js       ← اتصال Firestore + User Resolver + isAdmin
lib/telegram.js       ← متدهای Bot API + دانلود فایل + sendPhoto با base64
lib/gemini.js         ← چت، استخراج خاطره، تولید/ادیت تصویر
lib/keyboards.js      ← همه کیبوردهای Inline
src/router.js         ← مسیریابی پیام/کال‌بک + State Machine کاربر
src/admin.js          ← پنل مدیریت (پرامپت‌ها و ادمین‌ها + آمار)
lib/ratelimit.js      ← Rate limiting per-user (پنجره زمانی + سقف قابل تنظیم)
lib/queue.js          ← صف تصویر روی Firestore (enqueue/claim/cleanup)
api/cron.js           ← کرون ۳۰ ثانیه: پردازش صف + پاکسازی
api/cleanup.js        ← کرون روزانه: trim تاریخچه + غیرفعال‌سازی کاربران
```

## فلوهای ربات
1. **/start** → منوی اصلی: [💬 چت] [🖼 تصویر]
2. **چت** → گفتگو با Gemini Flash 3؛ حافظه بلندمدت (Memory Detector) در system prompt تزریق می‌شود.
3. **تصویر → تولید**: یا متن می‌نویسد یا پرامپت آماده (از Firestore) را کلیک می‌کند → عکس تولید و ارسال می‌شود.
4. **تصویر → ادیت**: پرامپت (مثل «لباس عروس»، «چهره جوان/پیر») را کلیک می‌کند → ربات عکس می‌خواهد → عکس + پرامپت به Gemini می‌رود → نتیجه برمی‌گردد.
5. **ادمین‌پنل** (`/admin`): فقط صاحب توکن و ادمین‌های ثبت‌شده در مجموعه `admins`.
   - ➕ افزودن پرامپت (دسته create/edit، فرمت دوخطی: عنوان / متن)
   - 📋 لیست و 🗑 حذف پرامپت‌ها (صفحه‌بندی‌شده)
   - 👤 افزودن ادمین با آیدی عددی (فقط صاحب توکن) / 📃 لیست و حذف ادمین‌ها

## راه‌اندازی
```bash
npm install
# env vars را در Vercel → Settings → Environment Variables ست کن:
#   TELEGRAM_BOT_TOKEN, WEBHOOK_SECRET, TELEGRAM_OWNER_ID,
#   GEMINI_API_KEY, GEMINI_CHAT_MODEL, GEMINI_IMAGE_MODEL,
#   FIREBASE_SERVICE_ACCOUNT (JSON تک‌خطی), SETUP_KEY
#   RATE_LIMIT_WINDOW_MIN=1, RATE_LIMIT_IMAGE_MAX=5, RATE_LIMIT_CHAT_MAX=30
#   CRON_SECRET=random-secret
```

## کرون‌ها (vercel.json)
| مسیر | زمان‌بندی | کار |
|---|---|---|
| `/api/cron` | هر ۳۰ ثانیه | پردازش jobهای pending صف تصویر + پاکسازی jobهای قدیمی |
| `/api/cleanup` | روزی یک‌بار ساعت ۳ | Trim تاریخچه + غیرفعال‌سازی کاربران ۹۰ روزه |

سرویس‌اکانت Firebase: Firebase Console → Project Settings → Service Accounts → Generate new private key → محتوای JSON را به‌صورت `{"type":"service_account",...}` تک‌خطی در env بگذار.

قوانین Firestore (برای اکانت سرویس لازم نیست، ولی برای دفاع در عمق):
```
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    match /{document=**} {
      allow read, write: if false;  // فقط از طریق Admin SDK (سِرور)
    }
  }
}
```

بعد از دیپلوی، یک‌بار:
```
curl "https://YOUR-APP.vercel.app/api/set-webhook?key=SETUP_KEY"
```
روی `ok: true` باید ببینی.

## نکات امنیتی (مهم)
- ✅ تمام کلیدها فقط در Environment Variables ورسل؛ هیچ‌کجای کد یا client لود نمی‌شوند.
- ✅ احراز هویت webhook با `secret_token` — بدون آن هدر، درخواست 401 می‌شود.
- ✅ ادمین بودن فقط از Firestore (مجموعه `admins`) + `TELEGRAM_OWNER_ID` سنجیده می‌شود، نه از متن پیام.
- ✅ آیدی ادمین جدید با regex عددی اعتبارسنجی می‌شود؛ صاحب توکن غیرقابل حذف است.
- ✅ سقف اندازه فایل ورودی ۲۰MB؛ متن پرامپت‌ها truncate می‌شود؛ callback_data به ۶۴ بایت محدود است.
- ✅ در محیط Serverless همیشه خطاها را catch و 200 برمی‌گردانیم تا آپدیت تلگرام ری‌تلای نشود.
- ⚠️ در فایربیس، `.settings({ ignoreUndefinedProperties: true })` ست شده تا undefined در فیلدها خطا نسازد.
- ✅ Rate-limit per-user پیاده شد (نسخه 2)
- 🔜 قدم بعدی پیشنهادی: پرداخت درون‌خطی (Telegram Stars) برای حذف سقف تصویر

## مدل‌ها
- چت: `GEMINI_CHAT_MODEL=gemini-3-flash-preview` (قابل تغییر)
- تصویر: `GEMINI_IMAGE_MODEL=gemini-2.5-flash-image` — اگر حسابت مدل‌های جدیدتر (سری ۳) را دارد، همان env را عوض کن.
