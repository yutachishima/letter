/**
 * 共通ヘルパー
 *  - 予約情報（メールアドレス・閲覧鍵）をサーバー側の秘密鍵で封をして保管する
 *  - Vercel Blob への読み書き
 *  - 日本時間での日付計算
 *  - Resend でのメール送信
 */

import crypto from 'node:crypto';
import { put, list, del, get } from '@vercel/blob';

export const QUEUE_PREFIX = 'queue/';
export const LETTER_PREFIX = 'letters/';

/* ===================== 封をする / 開ける ===================== */

function secretKey() {
  const secret = process.env.CAPSULE_SECRET;
  if (!secret) throw new Error('CAPSULE_SECRET が設定されていません。');
  return crypto.createHash('sha256').update(String(secret)).digest();
}

export function seal(obj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secretKey(), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  return {
    v: 1,
    iv: iv.toString('base64'),
    ct: ct.toString('base64'),
    tag: cipher.getAuthTag().toString('base64')
  };
}

export function unseal(sealed) {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    secretKey(),
    Buffer.from(sealed.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(sealed.ct, 'base64')),
    decipher.final()
  ]);
  return JSON.parse(plain.toString('utf8'));
}

/* ===================== Blob ===================== */

export function assertBlobConfigured() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error('保管先が設定されていません（BLOB_READ_WRITE_TOKEN）。');
  }
}

// 既定は private。ストアが private に対応していない場合だけ BLOB_ACCESS=public にする。
// どちらの場合でも、手紙の中身は鍵がなければ読めない。
const BLOB_ACCESS = process.env.BLOB_ACCESS === 'public' ? 'public' : 'private';

export async function writeJson(pathname, obj) {
  return put(pathname, JSON.stringify(obj), {
    access: BLOB_ACCESS,
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60
  });
}

export async function readJson(pathname) {
  const result = await get(pathname, { access: BLOB_ACCESS, useCache: false });
  if (!result || !result.stream) return null;

  const stream = result.stream;
  let text;

  if (typeof stream.getReader === 'function') {
    text = await new Response(stream).text();
  } else {
    const chunks = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    text = Buffer.concat(chunks).toString('utf8');
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function listAll(prefix) {
  const all = [];
  let cursor;

  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    all.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  return all;
}

export async function remove(pathnameOrUrl) {
  await del(pathnameOrUrl);
}

/* ===================== 日付・時刻 ===================== */

// 送信時刻は日本時間の18時に固定（= 09:00 UTC）
export const SEND_HOUR_UTC = 9;

/** 日本時間での YYYY-MM-DD */
export function jstDateString(date = new Date()) {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

/** YYYY-MM-DD（日本時間の日付）→ その日の18時（日本時間）の瞬間 */
export function sendAtFromJstDate(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr))) return null;
  const at = new Date(`${dateStr}T${String(SEND_HOUR_UTC).padStart(2, '0')}:00:00Z`);
  return isNaN(at.getTime()) ? null : at;
}

/** 日本時間の日付を年・日単位でずらす */
export function shiftJstDate(dateStr, { years = 0, days = 0 } = {}) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y + years, m - 1, d + days)).toISOString().slice(0, 10);
}

/** 送信予定を日本時間の文字列にする（確認メール用） */
export function formatJaDateTime(date) {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = jst.getUTCMonth() + 1;
  const d = jst.getUTCDate();
  const hh = String(jst.getUTCHours()).padStart(2, '0');
  const mm = String(jst.getUTCMinutes()).padStart(2, '0');
  return `${y}年${m}月${d}日 ${hh}:${mm}`;
}

/**
 * 配信待ちの置き場所。パス名から送信日時が分かるようにしておくと、
 * 中身を開かなくても「まだ送る時間ではない」と判断できる。
 *   queue/2027-09-03/0900-<hex>.json  ← UTCの日付と時刻
 */
export function queuePath(sendAt, hex) {
  const iso = sendAt.toISOString();
  const date = iso.slice(0, 10);
  const time = iso.slice(11, 13) + iso.slice(14, 16);
  return `${QUEUE_PREFIX}${date}/${time}-${hex}.json`;
}

export function parseQueuePath(pathname) {
  const m = pathname.match(/^queue\/(\d{4}-\d{2}-\d{2})\/(\d{2})(\d{2})-([a-f0-9]{32})\.json$/);
  if (!m) return null;
  const sendAt = new Date(`${m[1]}T${m[2]}:${m[3]}:00Z`);
  if (isNaN(sendAt.getTime())) return null;
  return { sendAt, hex: m[4] };
}

/**
 * 手紙の置き場所。保管期限をパス名に入れておくと、掃除のときに
 * 中身を読まずに期限切れが分かる。閲覧用のIDは「期限-乱数」の形。
 *   letters/2029-09-03/<hex>.json  ←  id は 2029-09-03-<hex>
 */
export function letterPathFromId(id) {
  const m = String(id).match(/^(\d{4}-\d{2}-\d{2})-([a-f0-9]{32})$/);
  if (!m) return null;
  return `${LETTER_PREFIX}${m[1]}/${m[2]}.json`;
}

export function makeLetterId(expiryDateStr, hex) {
  return `${expiryDateStr}-${hex}`;
}

export function parseLetterExpiry(pathname) {
  const m = pathname.match(/^letters\/(\d{4}-\d{2}-\d{2})\//);
  return m ? m[1] : null;
}

/** 送信日時から保管期限（YYYY-MM-DD）を出す */
export function expiryDateString(sendAt, retentionDays) {
  const d = new Date(sendAt.getTime() + retentionDays * 86400000);
  return d.toISOString().slice(0, 10);
}

export function retentionDays() {
  const n = Number(process.env.LETTER_RETENTION_DAYS || 730);
  return Number.isFinite(n) && n > 0 ? n : 730;
}

/* ===================== メール送信 ===================== */

/**
 * MAIL_PROVIDER で送信サービスを選ぶ。
 *   brevo  … 独自ドメインなしで使える（送信元アドレスを1つ認証するだけ／無料300通/日）
 *   resend … 独自ドメインが必要（無料3,000通/月・100通/日）
 * 既定は brevo。
 */
export async function sendEmail({ to, subject, text }) {
  const provider = (process.env.MAIL_PROVIDER || 'brevo').toLowerCase();
  const from = process.env.MAIL_FROM;
  if (!from) throw new Error('送信元メールアドレスが設定されていません（MAIL_FROM）。');

  if (provider === 'resend') return sendViaResend({ to, subject, text, from });
  if (provider === 'brevo') return sendViaBrevo({ to, subject, text, from });
  throw new Error(`MAIL_PROVIDER の値が不正です: ${provider}`);
}

/** "名前 <mail@example.com>" と "mail@example.com" の両方を受け付ける */
function parseFrom(from) {
  const m = String(from).match(/^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/);
  if (m) return { name: m[1] || undefined, email: m[2] };
  return { name: undefined, email: String(from).trim() };
}

async function sendViaBrevo({ to, subject, text, from }) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) throw new Error('メール送信の設定がありません（BREVO_API_KEY）。');

  const sender = parseFrom(from);
  const replyTo = process.env.MAIL_REPLY_TO;

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'api-key': apiKey
    },
    body: JSON.stringify({
      sender,
      to: [{ email: to }],
      subject,
      textContent: text,
      replyTo: replyTo ? { email: replyTo } : undefined
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`メールを送信できませんでした: ${body.slice(0, 300)}`);
  }

  return response.json();
}

async function sendViaResend({ to, subject, text, from }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('メール送信の設定がありません（RESEND_API_KEY）。');

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      text,
      reply_to: process.env.MAIL_REPLY_TO || undefined
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`メールを送信できませんでした: ${body.slice(0, 300)}`);
  }

  return response.json();
}

/** 1年後に届くメールの本文 */
export function deliveryMailText(url) {
  return [
    '以下のURLをクリックすると、あなたが1年前に書いた手紙を閲覧することができます。',
    '',
    url,
    '',
    '感想や不明点がありましたら、以下の連絡先までお願いします。',
    '筑波大学人間系　千島雄太',
    'chishima.yuta.fw@u.tsukuba.ac.jp'
  ].join('\n');
}

export const DELIVERY_SUBJECT = '1年前のあなたから手紙が届きました';

/* ===================== その他 ===================== */

export function newId() {
  return crypto.randomBytes(16).toString('hex');
}

export function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim()) && String(value).length <= 254;
}

export function siteUrl(req) {
  if (process.env.SITE_URL) return String(process.env.SITE_URL).replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}
