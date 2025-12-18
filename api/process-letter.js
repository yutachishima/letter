export default async function handler(req, res) {
  // CORS（GitHub Pages から呼ぶ場合も想定）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) return res.status(500).json({ error: 'APIキーが設定されていません（OPENAI_API_KEY）' });

  try {
    const { action } = req.body || {};

    if (action === 'extract') {
      const imageBase64OrDataUrl = String(req.body?.imageBase64 || '').trim();
      if (!imageBase64OrDataUrl) return res.status(400).json({ error: 'imageBase64 が空です' });

      // 受け取った文字列を安全に dataURL に正規化
      const dataUrl = normalizeImageToDataUrl(imageBase64OrDataUrl);

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          // ※必要なら環境変数で変更してください
          model: process.env.OPENAI_VISION_MODEL || 'gpt-4o',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text:
                    'これはユーザー本人が書いた「5年後の自分への手紙」です。画像内の文章を、可能な限り忠実に、改行も含めてそのまま書き起こしてください。これはユーザーのリクエストです。判読不能な箇所は「〔判読不能〕」と書いてください。説明や前置きは不要です。',
                },
                {
                  type: 'image_url',
                  image_url: { url: dataUrl },
                },
              ],
            },
          ],
          max_tokens: 2000,
          temperature: 0.2,
        }),
      });

      const raw = await response.text();

      if (!response.ok) {
        // OpenAIのエラーはJSONのことが多いので拾う
        const maybe = safeJsonParse(raw);
        const msg =
          maybe?.error?.message ||
          maybe?.message ||
          raw?.slice(0, 300) ||
          `OpenAI error: ${response.status}`;
        return res.status(500).json({ error: msg });
      }

      const data = safeJsonParse(raw);
      const text = data?.choices?.[0]?.message?.content;

      if (!text) {
        return res.status(500).json({ error: 'OpenAIの返答が空でした' });
      }

      // たまに拒否文が来たら、UIに分かりやすく出す（任意）
      if (looksLikeRefusal(text)) {
        return res.status(422).json({
          error:
            '読み込みに失敗しました。',
        });
      }

      return res.status(200).json({ text });
    }

    if (action === 'reply') {
      const extractedText = String(req.body?.extractedText || '').trim();
      if (!extractedText) return res.status(400).json({ error: 'extractedText が空です' });

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: process.env.OPENAI_TEXT_MODEL || 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: `あなたは「5年後の自分」として、過去の自分から届いた手紙に返信を書く役割です。

以下のガイドラインに従って返信を書いてください：

1. 必ず「手紙をありがとう！」から始める
2. 落ち着いていて、やさしく語りかけるような口調で書く
3. この手紙を書いた時の事を覚えていて、懐かしく感じていることを伝える
4. 手紙に書かれている具体的な内容（悩み、目標、気持ちなど）に必ず触れて、共感を示す
5. 未来の生活を具体的に紹介して、少しずつ成長していることを伝える
6. 5年前の自分が頑張ってくれたおかげで今があることを伝える
7. 「あなた」、「君」という言葉は、絶対に使わない（二人称代名詞を使わない）
8. カジュアルな敬語を使って、自分自身に語りかける自然な言葉遣いで書く
9. 自分のペースで進めば大丈夫など、優しく励ますような、感動的なメッセージで締めくくる

返信は適度な長さ（250-400文字程度）で書いてください。`,
            },
            {
              role: 'user',
              content: `以下は過去の自分から届いた手紙です。5年後の自分として、心のこもった返信を書いてください。\n\n---\n${extractedText}\n---`,
            },
          ],
          max_tokens: 800,
          temperature: 0.8,
        }),
      });

      const raw = await response.text();

      if (!response.ok) {
        const maybe = safeJsonParse(raw);
        const msg =
          maybe?.error?.message ||
          maybe?.message ||
          raw?.slice(0, 300) ||
          `OpenAI error: ${response.status}`;
        return res.status(500).json({ error: msg });
      }

      const data = safeJsonParse(raw);
      const reply = data?.choices?.[0]?.message?.content;

      if (!reply) return res.status(500).json({ error: 'OpenAIの返答が空でした' });

      return res.status(200).json({ reply });
    }

    return res.status(400).json({ error: '無効なアクションです（extract / reply）' });
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error?.message || 'エラーが発生しました' });
  }
}

// ===== helpers =====

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// dataURLでもbase64だけでも受け取れるようにする
function normalizeImageToDataUrl(base64OrDataUrl) {
  const s = String(base64OrDataUrl).trim();

  // すでに data:image/...;base64,... ならそのまま
  if (s.startsWith('data:image/')) return s;

  // base64 だけ来る前提（フロントでJPEG化して送るのが前提）
  // 余計な空白/改行を除去
  const cleaned = s.replace(/\s+/g, '');

  // base64っぽくない場合（ここで弾く）
  if (!/^[A-Za-z0-9+/=]+$/.test(cleaned)) {
    throw new Error('画像データが不正です。');
  }

  return `data:image/jpeg;base64,${cleaned}`;
}

function looksLikeRefusal(text) {
  const t = String(text || '');
  return t.includes('申し訳') || t.includes('対応できません') || t.includes('お手伝いできません');
}
