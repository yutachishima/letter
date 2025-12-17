export default async function handler(req, res) {
  // CORSヘッダー
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: 'APIキーが設定されていません' });
  }

  try {
    const { action, imageBase64, extractedText } = req.body;

    if (action === 'extract') {
      // 画像からテキストを抽出
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'これはユーザー本人が書いた「5年後の自分への手紙」です。ユーザー自身がこの手紙の内容を読み取ってほしいとリクエストしています。画像に書かれている手紙の内容をそのままテキストとして出力してください。手書きの場合でも、できるだけ正確に読み取ってください。読み取った内容のみを出力し、説明や前置きは不要です。'
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:image/jpeg;base64,${imageBase64}`
                  }
                }
              ]
            }
          ],
          max_tokens: 2000
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'テキスト抽出に失敗しました');
      }

      const data = await response.json();
      return res.status(200).json({ text: data.choices[0].message.content });

    } else if (action === 'reply') {
      // 5年後の自分からの返信を生成
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: `あなたは「5年後の自分」として、過去の自分から届いた手紙に返信を書く役割です。

以下のガイドラインに従って返信を書いてください：

1. 必ず「手紙をありがとう！」から始める
2. 落ち着いていて、やさしく語りかけるような口調で書く
3. この手紙を書いた時の事を覚えていることを伝える
4. 手紙に書かれている具体的な内容（悩み、目標、気持ちなど）に必ず触れて、共感を示す
5. 未来は少しずつ良くなっていることを伝える
6. 5年前の自分が頑張ってくれたおかげで今があることへの感謝を伝える
7. 「あなた」、「君」という言葉は、絶対に使わない（二人称代名詞を使わない）
8. 敬語ではなく、でもカジュアルすぎない、自分自身に語りかける自然な言葉遣いで書く
9. 自分のペースで進めば大丈夫など、優しく励ますメッセージで締めくくる

返信は適度な長さ（250-400文字程度）で書いてください。`
            },
            {
              role: 'user',
              content: `以下は過去の自分から届いた手紙です。5年後の自分として、心のこもった返信を書いてください。\n\n---\n${extractedText}\n---`
            }
          ],
          max_tokens: 1500,
          temperature: 0.8
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || '返信の生成に失敗しました');
      }

      const data = await response.json();
      return res.status(200).json({ reply: data.choices[0].message.content });

    } else {
      return res.status(400).json({ error: '無効なアクションです' });
    }

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message || 'エラーが発生しました' });
  }
}
