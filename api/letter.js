/**
 * 閲覧ページ（/view）が呼ぶ。暗号化されたままの手紙を返すだけ。
 * 復号の鍵はURLの「#」以降にあり、ここには送られてこない。
 */

import { readJson, letterPathFromId, assertBlobConfigured } from '../lib/store.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const id = String(req.query?.id || '');
  const pathname = letterPathFromId(id);
  if (!pathname) {
    return res.status(400).json({ error: 'この手紙のURLが正しくありません。' });
  }

  try {
    assertBlobConfigured();

    const capsule = await readJson(pathname);
    if (!capsule) {
      return res.status(404).json({ error: 'この手紙は見つかりませんでした。' });
    }

    res.setHeader('Cache-Control', 'private, max-age=60');
    return res.status(200).json(capsule);
  } catch (error) {
    console.error('letter fetch error:', error?.message || error);
    return res.status(404).json({ error: 'この手紙は見つかりませんでした。' });
  }
}
