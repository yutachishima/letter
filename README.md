# 5年後の自分への手紙

手紙の画像をアップロードすると、5年後の自分からの返信が届くウェブアプリです。

## 🚀 Vercelへのデプロイ手順

### 1. GitHubにリポジトリを作成

1. [GitHub](https://github.com) で新しいリポジトリを作成
2. このフォルダの内容をリポジトリにプッシュ

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/あなたのユーザー名/リポジトリ名.git
git push -u origin main
```

### 2. Vercelでデプロイ

1. [Vercel](https://vercel.com) にアクセスしてログイン（GitHubアカウントでOK）
2. 「Add New...」→「Project」をクリック
3. 先ほど作成したGitHubリポジトリを選択
4. 「Import」をクリック

### 3. 環境変数を設定（重要！）

デプロイ画面で、以下の環境変数を設定してください：

| Name | Value |
|------|-------|
| `OPENAI_API_KEY` | `sk-proj-xxxxx...`（あなたのAPIキー） |

※ 「Environment Variables」セクションで設定

### 4. デプロイ完了！

「Deploy」ボタンをクリックすると、数分でデプロイが完了します。
`https://あなたのプロジェクト名.vercel.app` でアクセスできます。

## 📁 ファイル構成

```
future-letter-vercel/
├── index.html          # フロントエンド（APIキーなし）
├── api/
│   └── process-letter.js  # バックエンドAPI（APIキーを安全に管理）
├── vercel.json         # Vercel設定
└── README.md           # この説明ファイル
```

## 🔒 セキュリティ

- APIキーは環境変数として安全に管理されます
- フロントエンドのコードにAPIキーは含まれません
- ユーザーはAPIキーを見ることができません

## 💡 カスタマイズ

返信の口調を変更したい場合は、`api/process-letter.js` 内のプロンプトを編集してください。
