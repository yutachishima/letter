/**
 * 指定した日時の配信を予約する
 *
 * 受け取るもの:
 *   capsule … ブラウザ内で暗号化済みの手紙（写真・読み取り結果・返信）
 *   key     … capsule を開くための鍵（この鍵は届くメール本文のURLにだけ入る）
 *   email   … 宛先
 *   sendDate … 送信日（YYYY-MM-DD）。時刻は日本時間の18時に固定。
 *
 * 保管のしかた:
 *   letters/<保管期限>/<乱数>.json … 暗号化された手紙。鍵がなければ誰も読めない。
 *   queue/<送信日>/<時刻>-<乱数>.json … 宛先と鍵。サーバー側の秘密鍵で封をして保管し、
 *                                       送信が終わった時点で削除する。
 */

import crypto from 'node:crypto';
import {
  seal,
  writeJson,
  assertBlobConfigured,
  queuePath,
  sendAtFromJstDate,
  shiftJstDate,
  jstDateString,
  letterPathFromId,
  makeLetterId,
  expiryDateString,
  retentionDays,
  formatJaDateTime,
  isValidEmail,
  siteUrl,
  sendEmail,
  deliveryMailText,
  DELIVERY_SUBJECT
} from '../lib/store.js';

// 予約できる範囲。明日から2年後まで。
const MAX_YEARS_AHEAD = 2;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    assertBlobConfigured();

    const { email, capsule, key, sendDate } = req.body || {};

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'メールアドレスの形式を確認してください。' });
    }
    if (!capsule || typeof capsule.iv !== 'string' || typeof capsule.ct !== 'string') {
      return res.status(400).json({ error: '手紙のデータが正しく届きませんでした。もう一度お試しください。' });
    }
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{20,100}$/.test(key)) {
      return res.status(400).json({ error: '手紙のデータが正しく届きませんでした。もう一度お試しください。' });
    }

    const sendAt = sendAtFromJstDate(sendDate);
    if (!sendAt) {
      return res.status(400).json({ error: '送信日を確認してください。' });
    }

    const today = jstDateString();
    const earliest = shiftJstDate(today, { days: 1 });
    const latest = shiftJstDate(today, { years: MAX_YEARS_AHEAD });
    if (sendDate < earliest || sendDate > latest) {
      return res.status(400).json({ error: `送信日は ${earliest} から ${latest} までの範囲で選んでください。` });
    }

    const hex = crypto.randomBytes(16).toString('hex');
    const expiry = expiryDateString(sendAt, retentionDays());
    const id = makeLetterId(expiry, hex);

    // 1. 暗号化された手紙を保管する（鍵はここには入れない）
    await writeJson(letterPathFromId(id), {
      v: capsule.v || 1,
      alg: capsule.alg || 'AES-GCM',
      iv: capsule.iv,
      ct: capsule.ct
    });

    // 2. 宛先と鍵に封をして、配信待ちの棚に置く
    await writeJson(queuePath(sendAt, hex), seal({
      id,
      email: String(email).trim(),
      key,
      sendAt: sendAt.toISOString()
    }));

    const sendAtLabel = formatJaDateTime(sendAt);

    // 動作確認用（既定では無効）。ALLOW_TEST_SEND=1 のときだけ、すぐに本番のメールを送る。
    if (req.body?.testSendNow === true && process.env.ALLOW_TEST_SEND === '1') {
      const url = `${siteUrl(req)}/view#id=${id}&k=${key}`;
      await sendEmail({
        to: String(email).trim(),
        subject: DELIVERY_SUBJECT,
        text: deliveryMailText(url)
      });
    }

    return res.status(200).json({
      ok: true,
      sendDate,
      sendAt: sendAt.toISOString(),
      sendAtLabel
    });
  } catch (error) {
    console.error('schedule error:', error?.message || error);
    return res.status(500).json({ error: error?.message || '予約できませんでした。' });
  }
}
