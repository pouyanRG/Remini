const { claimPendingJobs, markJobDone, markJobFailed, cleanupOldJobs } = require('../lib/queue');
const { generateImage } = require('../lib/gemini');
const { sendPhotoBase64, sendMessage } = require('../lib/telegram');
const { getDb, COL, FieldValue } = require('../lib/firebase');

/**
 * GET /api/cron — هر ۳۰ ثانیه توسط Vercel Cron صدا زده می‌شود.
 * Authorization: هدر Authorization باید Bearer CRON_SECRET باشد.
 */
module.exports = async (req, res) => {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ ok: false });
  }

  const results = { processed: 0, failed: 0, cleaned: 0 };

  // ۱) پردازش jobهای pending
  const jobs = await claimPendingJobs(3);
  for (const job of jobs) {
    try {
      const img = await generateImage(job.promptText, job.photoBase64, job.photoMime);
      await sendPhotoBase64(job.chatId, img.base64, img.mimeType, {
        caption: job.kind === 'edit' ? '🎨 نتیجهٔ ادیت تصویر' : '✨ تصویر تولیدشده',
      });
      await markJobDone(job.id, {});
      results.processed++;
      // آمار استفاده از پرامپت
      if (job.promptId) {
        await getDb().collection(COL.prompts).doc(job.promptId)
          .update({ usageCount: FieldValue.increment(1) }).catch(() => {});
      }
    } catch (e) {
      console.error(`[cron job ${job.id}]`, e);
      await markJobFailed(job.id, e.message);
      results.failed++;
      if ((await getDb().collection(COL.queue).doc(job.id).get()).data()?.status === 'failed') {
        await sendMessage(job.chatId, '⚠️ پردازش تصویر با خطا مواجه شد. لطفاً دوباره تلاش کن.');
      }
    }
  }

  // ۲) پاکسازی jobهای قدیمی
  results.cleaned = await cleanupOldJobs();

  return res.json({ ok: true, ...results });
};
