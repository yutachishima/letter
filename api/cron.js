/**
 * 定期的に動いて、送信時刻を過ぎた手紙をメールで送る。
 *
 * 送信が終わった予約は、その場で削除する（宛先も鍵も残さない）。
 * 保管期限を過ぎた手紙も、あわせて削除する。
 *
 * Vercel Cron から呼ばれる。外部の無料cronサービスから呼んでもよい。
 * どちらの場合も CRON_SECRET を Authorization: Bearer で渡すこと。
 */

import {
  unseal,
  readJson,
  listAll,
  remove,
  parseQueuePath,
  parseLetterExpiry,
  jstDateString,
  siteUrl,
  sendEmail,
  deliveryMailText,
  DELIVERY_SUBJECT,
  QUEUE_PREFIX,
  LETTER_PREFIX,
  assertBlobConfigured
} from '../lib/store.js';

// 送信に失敗し続けた予約をあきらめるまでの日数
const GIVE_UP_AFTER_DAYS = 14;

// Cron の起動は数分ずれることがあるので、少し手前から「送ってよい」とみなす
const DUE_GRACE_MS = 30 * 60 * 1000;

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${secret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    assertBlobConfigured();
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  const now = Date.now();
  const base = siteUrl(req);
  const summary = { now: new Date(now).toISOString(), sent: 0, failed: 0, givenUp: 0, cleaned: 0 };

  /* ---------- 送信時刻を過ぎた手紙を送る ---------- */
  let queued = [];
  try {
    queued = await listAll(QUEUE_PREFIX);
  } catch (e) {
    console.error('queue list failed:', e?.message || e);
    return res.status(500).json({ error: 'queue list failed' });
  }

  for (const blob of queued) {
    const parsed = parseQueuePath(blob.pathname);
    if (!parsed) continue;

    const overdueMs = now - parsed.sendAt.getTime();
    if (overdueMs < -DUE_GRACE_MS) continue; // まだ送る時間ではない

    if (overdueMs > GIVE_UP_AFTER_DAYS * 86400000) {
      try {
        await remove(blob.pathname);
        summary.givenUp += 1;
      } catch {
        console.error('give-up delete failed');
      }
      continue;
    }

    try {
      const sealed = await readJson(blob.pathname);
      if (!sealed) {
        await remove(blob.pathname);
        continue;
      }

      const job = unseal(sealed);
      const url = `${base}/view#id=${job.id}&k=${job.key}`;

      await sendEmail({
        to: job.email,
        subject: DELIVERY_SUBJECT,
        text: deliveryMailText(url)
      });

      // 送信できたら、宛先と鍵はここで消す
      await remove(blob.pathname);
      summary.sent += 1;
    } catch (e) {
      // 残しておいて次回に再挑戦する
      summary.failed += 1;
      console.error('delivery failed for', blob.pathname, e?.message || e);
    }
  }

  /* ---------- 保管期限を過ぎた手紙を消す ---------- */
  const today = jstDateString(new Date(now));

  try {
    const letters = await listAll(LETTER_PREFIX);
    for (const blob of letters) {
      const expiry = parseLetterExpiry(blob.pathname);
      if (!expiry || expiry > today) continue;
      try {
        await remove(blob.pathname);
        summary.cleaned += 1;
      } catch {
        // 次回に持ち越す
      }
    }
  } catch (e) {
    console.error('cleanup failed:', e?.message || e);
  }

  return res.status(200).json(summary);
}
