# mailmanage 📬

複数のメールアドレスの受信箱の状態を、ひとつのダッシュボードでまとめて確認できるアプリです。

各アカウントの **未読件数・合計件数・最新10件のメール(差出人/件名/日時)** をカード形式で一覧表示します。

## 特徴

- IMAP 対応のメールアカウントを何個でも登録可能(Gmail / Outlook / Yahoo!メール / iCloud のプリセット付き)
- 全アカウントを並列チェックするので高速
- 未読合計のサマリー表示、1分ごとの自動更新(オプション)
- パスワードは AES-256-GCM で暗号化してローカルに保存(サーバー外には一切送信しません)
- 依存は `express` と `imapflow` のみ。DB 不要

## 使い方

```bash
npm install
npm start
```

ブラウザで http://localhost:3000 を開き、「＋ アカウント追加」からアカウントを登録してください。

### Gmail の場合

1. Google アカウントで 2 段階認証を有効にする
2. https://myaccount.google.com/apppasswords で **アプリパスワード** を発行する
3. 追加ダイアログでプロバイダ「Gmail」を選び、メールアドレスと発行したアプリパスワードを入力する

(通常のログインパスワードでは接続できません)

### その他のプロバイダ

| プロバイダ | IMAP サーバー | 備考 |
|---|---|---|
| Gmail | `imap.gmail.com:993` | アプリパスワード必須 |
| Outlook / Hotmail | `outlook.office365.com:993` | アプリパスワードが必要な場合あり |
| Yahoo!メール(日本) | `imap.mail.yahoo.co.jp:993` | 設定で IMAP アクセスを有効化 |
| iCloud | `imap.mail.me.com:993` | アプリ用パスワード必須 |
| その他 | プロバイダのドキュメント参照 | プリセット「カスタム」で入力 |

## 設定

環境変数:

- `PORT` — 待ち受けポート(デフォルト: 3000)
- `MAILMANAGE_PASSWORD` — **ダッシュボードのログインパスワード。インターネットに公開する場合は必須。** 設定するとログイン画面が有効になります(未設定時は認証なし=ローカル利用専用)
- `MAILMANAGE_SECRET` — パスワード暗号化キーの元になる秘密文字列。未設定の場合は初回起動時に `data/.key` が自動生成されます。コンテナ等でファイルが消える環境では必ず設定してください(消えると保存済みパスワードが復号できなくなります)

アカウント情報は `data/accounts.json` に保存されます(パスワードは暗号化済み)。

## インターネット公開(デプロイ)

公開時の必須事項:

1. **`MAILMANAGE_PASSWORD` を必ず設定する**(長いランダムな文字列推奨)。これがないと誰でもあなたの受信箱を見られます
2. **HTTPS で公開する**。Render や Railway は自動で HTTPS になります。VPS の場合は Caddy や nginx + Let's Encrypt を使ってください
3. **`MAILMANAGE_SECRET` を設定し、`data/` を永続化する**。しないと再デプロイのたびにアカウント登録がやり直しになります

### Render(いちばん簡単)

リポジトリに `render.yaml` を同梱しています。

1. https://render.com にサインアップし、「New → Blueprint」でこのリポジトリを選択
2. 環境変数 `MAILMANAGE_PASSWORD` にログインパスワードを設定
3. デプロイ完了後、発行された `https://〜.onrender.com` にアクセス

### Railway

1. https://railway.app で「New Project → Deploy from GitHub repo」
2. Variables で `MAILMANAGE_PASSWORD` と `MAILMANAGE_SECRET` を設定
3. Volume を作成して `/app/data` にマウント
4. Settings → Networking で「Generate Domain」

### VPS + Docker

```bash
git clone <このリポジトリ>
cd mailmanage
# docker-compose.yml の MAILMANAGE_PASSWORD / MAILMANAGE_SECRET を変更してから
docker compose up -d --build
```

HTTPS 化は Caddy を前段に置くのが簡単です:

```
# Caddyfile
mail.example.com {
    reverse_proxy localhost:3000
}
```

## セキュリティ上の注意

- ログインは単一パスワード方式です(ブルートフォース対策のレート制限つき、セッションは署名付き Cookie で30日有効)
- `MAILMANAGE_PASSWORD` 未設定のまま公開しないでください。起動ログにも警告が出ます
- メールには機微な情報が含まれます。公開する場合も、自分だけが使う前提で強いパスワードを設定してください
- `data/` ディレクトリには暗号化済みとはいえ機密情報が含まれます。`.gitignore` 済みですがバックアップの取り扱いには注意してください

## API

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/api/accounts` | 登録アカウント一覧(パスワードは含まない) |
| POST | `/api/accounts` | アカウント追加 `{label?, email, host, port?, user?, password}` |
| PUT | `/api/accounts/:id` | アカウント更新 |
| DELETE | `/api/accounts/:id` | アカウント削除 |
| GET | `/api/status` | 全アカウントの受信箱の状態を取得 |
| GET | `/api/status/:id` | 指定アカウントの状態を取得 |
