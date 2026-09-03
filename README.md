# 1年後の自分への手紙

手紙を写真で撮るか、その場で入力すると、AIが読み取って「1年後の自分」からの返信を返します。
そのうえで、手紙と返信を **1年後の自分のメールアドレスに届ける** ことができます。

## 画面の流れ

1. 手紙を撮影する（または「写真でなく直接手紙を入力する場合はこちら」から入力する）
2. 画像をアップロードする / 入力内容を確認する
3. 返信を受け取る（AI返信が不要なら「AI返信をスキップして1年後への送信へ進む」）
4. 1年後に送る（メールアドレスと送信日時を入力して予約）

送信日は **1年後が初期値** で、前後の日付に変えられます。
選べるのは明日から2年後までです。**送信時刻は18時（日本時間）に固定**です。

指定した日の18時に、次の件名でメールが届きます。

- 件名: `1年前のあなたから手紙が届きました`
- 本文: 閲覧用URLと、問い合わせ先

URLを開くと、アップロードした写真・AIが読み取った手紙・AIが返信した内容が表示されます。
（AI返信をスキップした場合は、その部分は表示されません）

## 手紙の扱い

- 手紙は **ブラウザの中で暗号化してから** 送られます。復号の鍵はURLの `#` 以降にだけ入り、
  サーバーには送信されません。閲覧ページを開いても、鍵はサーバーに届きません。
- 宛先のメールアドレスと復号の鍵は、`CAPSULE_SECRET` で封をした状態で保管され、
  **1年後の送信が終わった時点で削除されます。**
- 管理画面はありません。運用者が中身を読むための入り口は用意していません。
- 手紙そのものは、**配信日から** `LETTER_RETENTION_DAYS`（既定730日）を過ぎると
  自動で削除されます。届いたメールのURLは、その間だけ有効です。

> 注意: 1年後に必ず届けるためには、宛先と鍵をどこかに保持しておく必要があります。
> 「一切保存しない」ことは仕組み上できません。保持するものを最小限にし、
> 暗号化し、送信後すぐ消す、という設計にしています。

## ファイル構成

```
├── index.html            フロントエンド（手紙を書く・返信・予約）
├── view.html             1年後のメールから開くページ
├── lib/
│   └── store.js          保管・暗号化・日付・メール送信の共通処理
├── api/
│   ├── process-letter.js OpenAI（読み取り／返信生成）
│   ├── schedule.js       1年後の配信を予約する
│   ├── letter.js         暗号化された手紙を返す
│   └── cron.js           毎日1回、配信日の手紙を送る
├── vercel.json
└── package.json
```

## セットアップ

### 1. Vercel Blob を作る

Vercel のダッシュボード → Storage → Create → Blob。
プロジェクトに接続すると `BLOB_READ_WRITE_TOKEN` が自動で入ります。

### 2. メール送信を用意する

無料で使える方法が2つあります。**独自ドメインを持っていない場合は Brevo を選んでください。**

#### A. Brevo（既定・ドメイン不要）

無料枠は 300通/日、クレジットカード不要、期限なし。

1. https://www.brevo.com でアカウントを作る
2. Senders, Domains & Dedicated IPs → Senders → Add Sender で、
   送信元にしたいメールアドレスを1つ登録して認証する（受信したメールのリンクを押すだけ）
3. SMTP & API → API Keys で APIキーを発行する

環境変数は `MAIL_PROVIDER=brevo`（既定なので省略可）と `BREVO_API_KEY`。

#### B. Resend（独自ドメインが必要）

無料枠は 3,000通/月・100通/日。送信元ドメインの認証（SPF / DKIM）が必要なため、
自分で管理しているドメインがない場合は使えません。

環境変数は `MAIL_PROVIDER=resend` と `RESEND_API_KEY`。

### 3. 環境変数を設定する

Vercel → Settings → Environment Variables

| Name | 必須 | 説明 |
| --- | --- | --- |
| `OPENAI_API_KEY` | 必須 | OpenAI の APIキー |
| `BLOB_READ_WRITE_TOKEN` | 必須 | Vercel Blob を接続すると自動で入る |
| `MAIL_FROM` | 必須 | 送信元。Brevo で認証したアドレス。例: `1年後の手紙 <letter@example.com>` |
| `BREVO_API_KEY` | Brevoの場合 | Brevo の APIキー |
| `MAIL_PROVIDER` | 任意 | `brevo`（既定）または `resend` |
| `RESEND_API_KEY` | Resendの場合 | Resend の APIキー |
| `CAPSULE_SECRET` | 必須 | 予約情報を封じる秘密鍵。長いランダム文字列 |
| `CRON_SECRET` | 必須 | Cron の呼び出しを守るための秘密鍵 |
| `SITE_URL` | 必須 | 例: `https://letter-xi-rosy.vercel.app`。メール内のURLに使う |
| `MAIL_REPLY_TO` | 任意 | 返信先。例: `chishima.yuta.fw@u.tsukuba.ac.jp` |
| `OPENAI_VISION_MODEL` | 任意 | 既定 `gpt-5.6` |
| `OPENAI_TEXT_MODEL` | 任意 | 既定 `gpt-5.6` |
| `LETTER_RETENTION_DAYS` | 任意 | 既定 `730` |
| `SEND_CONFIRMATION` | 任意 | `false` にすると予約時の確認メールを止める |
| `BLOB_ACCESS` | 任意 | 既定 `private`。ストアが private に対応していない場合のみ `public` |
| `ALLOW_TEST_SEND` | 任意 | `1` のときだけ動作確認用の即時送信を許可する |

`CAPSULE_SECRET` と `CRON_SECRET` は、こう作れます。

```
openssl rand -hex 32
```

`CAPSULE_SECRET` を後から変更すると、**変更前に予約された手紙は送れなくなります。**
一度決めたら変えないでください。

### 4. デプロイ

GitHub に push すると Vercel が自動でデプロイします。
Cron は毎日 09:00 UTC（日本時間 18:00）に `/api/cron` を呼びます。
送信時刻を変えたい場合は、`vercel.json` の `crons` と `lib/store.js` の
`SEND_HOUR_UTC` を同じ時刻に揃えて変更してください。

### 5. 配信のタイミングについて

Cron は1日1回だけ動き、その日が送信日になっている手紙をまとめて送ります。
送信時刻を18時に固定してあるのは、この1日1回の実行と揃えるためです。

何らかの理由でその日の実行が失敗しても、予約は消えません。翌日の実行で再送します。
14日間送れなかった予約だけ、あきらめて削除します。

## 費用

1年後に送る仕組みは、無料枠の中で動きます。

| | 無料枠 | 超えたら |
| --- | --- | --- |
| Vercel Hobby（ホスティング・Cron） | 個人／非商用なら無料。Cron は1日1回まで | 課金ではなく停止する |
| Vercel Blob（手紙の保管） | 1GB・データ転送10GB/月 | 課金ではなく停止する |
| Brevo（メール送信） | 300通/日 | 送信が止まる |

写真1枚あたり約300KBなので、1GB でおよそ3,000通分です。
Vercel Hobby も Blob も、上限を超えると請求ではなく停止する仕組みなので、
知らないうちに課金されることはありません。

**別途かかるのは OpenAI の API 利用料だけです。**（読み取りと返信生成の分。
これは作り直し前から同じで、1年後に送る機能とは別のものです）

## 動作確認

1年待たずに配信を確認したいときは、`ALLOW_TEST_SEND=1` を設定したうえで、
ブラウザのコンソールから次を実行します。

```js
await fetch('/api/schedule', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'あなたのアドレス@example.com',
    key: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    capsule: { v: 1, alg: 'AES-GCM', iv: 'AAAAAAAAAAAAAAAA', ct: 'AAAA' },
    sendDate: '2027-09-03',
    testSendNow: true
  })
});
```

本番のメールがすぐ届きます（中身は開けません）。確認が終わったら
`ALLOW_TEST_SEND` は必ず削除してください。

Cron 自体の確認は、`CRON_SECRET` を添えて `/api/cron` を呼びます。

```
curl -H "Authorization: Bearer $CRON_SECRET" https://<your-domain>/api/cron
```

## 返信の文面を変える

`api/process-letter.js` の `instructions` を編集してください。
