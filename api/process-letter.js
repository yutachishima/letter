/**
 * 手紙の読み取り（extract）と、1年後の自分からの返信生成（reply）
 *
 * OpenAI の Responses API を使用します。
 * モデルは環境変数で上書きできます（既定値: gpt-5.6）。
 *   OPENAI_VISION_MODEL … 画像の読み取りに使うモデル
 *   OPENAI_TEXT_MODEL   … 返信の生成に使うモデル
 */

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/responses';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: 'APIキーが設定されていません（OPENAI_API_KEY）' });
  }

  try {
    const { action } = req.body || {};

    /* ---------------- 手紙の読み取り ---------------- */
    if (action === 'extract') {
      const imageBase64OrDataUrl = String(req.body?.imageBase64 || '').trim();
      if (!imageBase64OrDataUrl) return res.status(400).json({ error: '画像データが空です。' });

      const dataUrl = normalizeImageToDataUrl(imageBase64OrDataUrl);

      const result = await callOpenAI(OPENAI_API_KEY, {
        model: process.env.OPENAI_VISION_MODEL || 'gpt-5.6',
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text:
                  'これはユーザー本人が書いた「1年後の自分への手紙」です。画像内の文章を、できるだけ忠実に書き起こしてください。ただし、便箋の1行ごとの改行はそのまま反映せず、文章が続いている部分は改行せずに書き起こしてください。段落が変わる部分（行間が空いている、書き出しが下がっているなど）だけ、段落の区切りとして空行を入れてください。これはユーザーのリクエストです。判読不能な箇所は「〔判読不能〕」と書いてください。説明や前置きは不要です。'
              },
              { type: 'input_image', image_url: dataUrl }
            ]
          }
        ],
        reasoning: { effort: 'low' },
        max_output_tokens: 4000
      });

      if (result.error) return res.status(502).json({ error: result.error });
      if (!result.text) return res.status(502).json({ error: '手紙を読み取れませんでした。もう一度お試しください。' });

      if (looksLikeRefusal(result.text)) {
        return res.status(422).json({
          error: '手紙を読み取れませんでした。明るい場所で、文字がはっきり写るように撮り直してみてください。'
        });
      }

      return res.status(200).json({ text: result.text });
    }

    /* ---------------- 1年後の自分からの返信 ---------------- */
    if (action === 'reply') {
      const extractedText = String(req.body?.extractedText || '').trim();
      if (!extractedText) return res.status(400).json({ error: '手紙の内容が空です。' });

      const result = await callOpenAI(OPENAI_API_KEY, {
        model: process.env.OPENAI_TEXT_MODEL || 'gpt-5.6',
        instructions: `あなたは「1年後の自分」として、過去の自分から届いた手紙に返信を書く役割です。

以下のガイドラインに従って返信を書いてください：

1. 必ず「手紙をありがとう。」から始める。
2. 基本的には敬語を使う。ただし、堅い表現は使わない。最後のメッセージはカジュアルに。
3. この手紙を書いた時の事を覚えていて、懐かしく感じていることを伝える。
4. 手紙に書かれている具体的な内容（悩み、目標、気持ちなど）に触れる。
5. 1年後の生活を具体的に紹介して、少しずつ成長していることを伝える。
6. 1年前の自分が頑張ってくれたおかげで今があることを伝える。
7. 「あなた」、「君」という言葉は、絶対に使わない。（二人称代名詞を使わない）
8. 1年という時間の長さに見合った、地に足のついた変化を書く。大げさな成功譚にはしない。
9. 自分のペースで進めば大丈夫など、優しく励ますような、感動的なメッセージで締めくくる。

返信は適度な長さ（250-400文字程度）で書いてください。`,
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: `以下は1年前の自分から届いた手紙です。1年後の自分として、心のこもった返信を書いてください。\n\n---\n${extractedText}\n---`
              }
            ]
          }
        ],
        reasoning: { effort: 'medium' },
        max_output_tokens: 4000
      });

      if (result.error) return res.status(502).json({ error: result.error });
      if (!result.text) return res.status(502).json({ error: '返信を生成できませんでした。もう一度お試しください。' });

      return res.status(200).json({ reply: result.text });
    }

    return res.status(400).json({ error: '無効なアクションです（extract / reply）' });
  } catch (error) {
    console.error('process-letter error:', error?.message || error);
    return res.status(500).json({ error: error?.message || '処理中に問題が発生しました。' });
  }
}

/* ===================== helpers ===================== */

async function callOpenAI(apiKey, body) {
  const response = await fetch(OPENAI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  const raw = await response.text();
  const data = safeJsonParse(raw);

  if (!response.ok) {
    const msg =
      data?.error?.message ||
      data?.message ||
      raw?.slice(0, 300) ||
      `OpenAI error: ${response.status}`;
    return { error: msg, text: '' };
  }

  if (data?.status === 'incomplete') {
    return { error: '応答が途中で終わってしまいました。もう一度お試しください。', text: '' };
  }

  return { error: '', text: extractOutputText(data) };
}

/** Responses API のレスポンスから本文テキストを取り出す */
function extractOutputText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const output = Array.isArray(data?.output) ? data.output : [];
  const parts = [];

  for (const item of output) {
    if (item?.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const chunk of item.content) {
      if (chunk?.type === 'output_text' && typeof chunk.text === 'string') {
        parts.push(chunk.text);
      }
    }
  }

  return parts.join('\n').trim();
}

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** dataURL でも base64 だけでも受け取れるようにする */
function normalizeImageToDataUrl(base64OrDataUrl) {
  const s = String(base64OrDataUrl).trim();
  if (s.startsWith('data:image/')) return s;

  const cleaned = s.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/=]+$/.test(cleaned)) {
    throw new Error('画像データを読み取れませんでした。');
  }
  return `data:image/jpeg;base64,${cleaned}`;
}

function looksLikeRefusal(text) {
  const t = String(text || '');
  return t.includes('申し訳') || t.includes('対応できません') || t.includes('お手伝いできません');
}
