# ArtFollow

X (旧Twitter) のフォロワーの中から、実際に自分の作品(イラスト・漫画など)を投稿している「絵描きアカウント」をAIで判定してリストアップし、内容を確認したうえでフォローバックできるセルフホスト用Webツールです。スマートフォンのブラウザから利用することを想定しています。

## できること

1. Xアカウント(OAuth2)を連携する
2. 自分のフォロワー一覧を取得する
3. まだフォローバックしていないフォロワーについて、
   - プロフィール文(bio)
   - 直近の投稿(最大50件)の本文サンプル・画像/動画の有無・画像のalt text
   を元にOpenAI APIで「絵描きアカウントかどうか」を判定する
4. 判定結果(確信度・判定理由)を一覧表示し、内容を確認しながらチェックボックスで選択する
5. 選択したアカウントだけをまとめてフォローバックする

フォローは自動実行されません。必ず一覧を確認し、ユーザーが選択したアカウントのみフォローします。

## 前提条件

- Node.js 20系以上
- X Developer Portal で **Basic以上のAPIプラン** を契約していること
  - Freeプランでは `GET /2/users/:id/followers` などの取得系APIが使えないため、本ツールは動作しません
- OpenAI APIキー
- 自宅サーバーなど、HTTPSでインターネットに公開できる環境(本ツールはOAuthコールバックを受けるためHTTPS必須です)

## X Developer Portal 側の設定

1. https://developer.x.com/ でアプリを作成し、**User authentication settings** で OAuth 2.0 を有効化
2. App permissions: `Read and write`(フォロー実行に必要)
3. Type of App: `Web App, Automated App or Bot`(Confidential client)
4. Callback URI に、公開するURLのコールバックパスを設定
   - 例: `https://ochinpo.click/api/auth/x/callback`
5. 発行された **Client ID** / **Client Secret** を `.env.local` に設定

## セットアップ

```bash
cp .env.example .env.local
# .env.local を編集して各値を設定する
npm install
npm run build
npm start   # デフォルトで http://localhost:3000 で起動
```

`APP_PASSWORD` と `APP_SECRET` は自宅サーバーからインターネットに公開する都合上、**アプリ自体を守るための第二の認証**として必須です(他人にXアカウントを操作されないようにするため)。`APP_SECRET` は以下のように生成できます。

```bash
openssl rand -hex 32
```

## 自宅サーバーでの公開例(OCHINPO.CLICK)

本ツールは Next.js の standalone ビルドで動作するNode.jsサーバーです。ドメインへのHTTPS終端は、お使いのリバースプロキシ(例: Caddy, nginx + certbot)で行い、内部的に `localhost:3000` へフォワードしてください。

### Caddy の例 (`Caddyfile`)

```
ochinpo.click {
    reverse_proxy localhost:3000
}
```

### systemd での常駐例 (`/etc/systemd/system/artfollow.service`)

```ini
[Unit]
Description=ArtFollow
After=network.target

[Service]
WorkingDirectory=/opt/artfollow
EnvironmentFile=/opt/artfollow/.env.local
ExecStart=/usr/bin/npm start
Restart=on-failure
User=artfollow

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now artfollow
```

`data/app.db` にはXの暗号化済みアクセストークンが保存されます(`APP_SECRET` を鍵にAES-256-GCMで暗号化)。ファイル自体は外部に公開しないディレクトリに置き、バックアップする場合も取り扱いに注意してください。

## OpenAI APIキーを効率的に使うための工夫

フォロワー数が多いアカウントでもコストを抑えられるよう、以下の対策を実装しています。

1. **bio空欄・キーワード0件は即除外**: bioが空、または `CLASSIFY_ONLY_HEURISTIC_MATCHES=true`(デフォルト)の場合、日英の絵描き関連キーワード(イラスト/絵師/pixiv/commission/artist など)が一切ヒットしないアカウントはOpenAIを呼ばずに「対象外」と自動判定します。
2. **投稿本文をそのまま送らず要約**: 直近50件の投稿を取得しますが、OpenAIに送るのは「テキストサンプル最大12件(各200文字)」「画像altテキスト最大10件」「画像/動画付き投稿の件数」のみです。画像そのものをVision APIに送ることはしません。
3. **バッチ処理**: 判定対象を `OPENAI_BATCH_SIZE`(デフォルト10件)ごとにまとめ、1リクエストで複数アカウントを構造化出力(JSON Schema)で一括判定します。
4. **永続キャッシュ**: 判定結果はSQLiteに保存され、bioが変化しない限り再スキャンしても再判定されません(APIを再度呼びません)。
5. **安価なモデルをデフォルト採用**: `OPENAI_MODEL` はデフォルトで `gpt-4o-mini`。精度を上げたい場合のみ環境変数で変更してください。

## X APIのレート制限について

Basic以上のプランでもフォロワー一覧・投稿取得・フォロー実行それぞれにレート制限があります。本ツールは429応答を検知すると処理を中断し、画面にメッセージを表示します。時間を置いてから「フォロワーを取得」「AIで判定する」ボタンを再度押すことで、続きから処理を再開できます(取得済みのページ・分類済みのアカウントは保持されます)。

## 開発

```bash
npm run dev       # 開発サーバー起動
npm run typecheck # 型チェック
npm run lint      # Lint
```

## ディレクトリ構成

```
src/
  app/                 Next.js App Router (ページ・APIルート)
    api/auth/          アプリログイン・X OAuth
    api/scan/          フォロワー取得・AI分類
    api/candidates/    絵描き候補一覧
    api/follow/        フォローバック実行
    api/status/         ダッシュボード用集計
  lib/
    db.ts              SQLiteスキーマ・KVストア
    xOAuth.ts           X OAuth2 PKCEフロー・トークン管理
    xClient.ts           X API v2 呼び出し(フォロワー/フォロー中/投稿/フォロー実行)
    heuristic.ts        キーワードによる事前フィルタ
    openaiClassify.ts   OpenAIバッチ分類
    session.ts / auth.ts アプリ保護用セッション
    crypto.ts            トークン暗号化
```
