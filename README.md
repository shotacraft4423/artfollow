# ArtFollow

X (旧Twitter) のフォロワーの中から、自由なテキストで指定した条件(「絵を描いている人」「コスプレイヤー」「猫の写真をよく投稿している人」など何でも)に当てはまるアカウントをAIで判定してリストアップし、内容を確認したうえでフォローバックできるセルフホスト用Webツールです。スマートフォンのブラウザから利用することを想定しています。

## できること

1. Xアカウント(OAuth2)を連携する
2. 自分のフォロワー一覧を取得する
3. 「どんな人を探したいか」を自由テキストで入力すると(プリセットも用意)、
   - プロフィール文(bio)
   - 直近の投稿(最大50件)の本文サンプル・画像/動画の有無・画像のalt text
   を元にOpenAI APIで条件に当てはまるかどうかを検索クエリごとに判定する
4. 判定結果(確信度・判定理由)を**タイル表示/詳細表示**で一覧し、AIコメント・信頼度の表示はオン/オフ切替可能
5. フォロー状況(フォロー中/未フォロー/すべて)・フォロワー数・知り合いのフォロワー数で絞り込み、確信度/フォロワー数/知り合い数などで昇順・降順に並び替え
6. 候補ごとに「知り合いのフォロワー数」(自分がフォローしている人のうち、その候補者もフォローしている人数)をオンデマンドで調べられる
7. 内容を確認しながらチェックボックスで選択し、選択したアカウントだけをまとめてフォローバックする

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

## 検索の仕組みとOpenAI APIキーを効率的に使うための工夫

検索クエリ(「探したい人物像」)は自由テキストです。同じフォロワーでも検索クエリが変われば判定結果も変わるため、判定結果は `(フォロワーID, 検索クエリ)` 単位でSQLiteにキャッシュされます。フォロワー数が多いアカウントでもコストを抑えられるよう、以下の対策を実装しています。

1. **検索クエリごとにキーワードを自動生成してbioで事前フィルタ**: 検索クエリを初めて使う際、OpenAIに1回だけ問い合わせて「そのクエリに当てはまるアカウントのbioにありそうなキーワード」を15〜30個生成し、DBにキャッシュします。以降は同じクエリなら再生成しません。`CLASSIFY_ONLY_HEURISTIC_MATCHES=true`(デフォルト)の場合、bioにこれらのキーワードが1つもヒットしないアカウントは本判定(OpenAI呼び出し)を行わずに「対象外」と自動判定します。
2. **投稿本文をそのまま送らず要約**: 直近50件の投稿を取得しますが、OpenAIに送るのは「テキストサンプル最大12件(各200文字)」「画像altテキスト最大10件」「画像/動画付き投稿の件数」のみです。画像そのものをVision APIに送ることはしません。
3. **投稿データはクエリ横断でキャッシュ**: 直近投稿の取得結果(`TWEETS_CACHE_MAX_AGE_DAYS`日、デフォルト14日)は検索クエリに依存しないため、別のクエリで同じフォロワーを判定する際もX APIを呼び直さず使い回します。
4. **バッチ処理**: 判定対象を `OPENAI_BATCH_SIZE`(デフォルト10件)ごとにまとめ、1リクエストで複数アカウントを構造化出力(JSON Schema)で一括判定します。
5. **永続キャッシュ**: 判定結果はSQLiteに保存され、同じ検索クエリでは再スキャンしても再判定されません(APIを再度呼びません)。
6. **安価なモデルをデフォルト採用**: `OPENAI_MODEL` はデフォルトで `gpt-4o-mini`。精度を上げたい場合のみ環境変数で変更してください。

## 「知り合いのフォロワー数」について

候補者ごとに「自分がフォローしている人のうち、その候補者もフォローしている人数」を調べられます。これは候補者のフォロー中一覧を取得してAPI呼び出しが発生する(最大 `MUTUAL_FOLLOW_MAX_PAGES` ページ)ため、**全候補に自動実行はせず、カード個別の「知り合いを調べる」ボタン、または選択した候補分をまとめて調べるボタンでのみ実行**します。一度計算した値はフォロワーデータとしてキャッシュされます。

## X APIのレート制限・利用コストについて

Basic以上のプランでもフォロワー一覧・投稿取得・フォロー実行それぞれにレート制限があります。本ツールは429応答を検知すると処理を中断し、画面にメッセージを表示します。時間を置いてから「フォロワーを取得」「AI検索する」ボタンを再度押すことで、続きから処理を再開できます(取得済みのページ・分類済みのアカウントは保持されます)。

また、X Developer Consoleの **Pay Per Use** プランで運用している場合、APIリクエストごとにクレジットが消費されます。402エラー(`credits depleted`)が出た場合はクレジット切れなので、Developer Consoleの「請求書作成 → クレジット/支払い」から残高を確認・チャージしてください。「知り合いのフォロワー数」機能は候補者ごとに複数リクエストを消費する可能性がある点に留意し、必要な候補だけオンデマンドで調べる運用を推奨します。

## 既存環境をアップデートする場合の注意

検索の汎用化に伴いデータベーススキーマを変更しました(判定結果を検索クエリ単位で保存する方式に変更)。以前のバージョンで動かしていた `data/app.db` がある場合、そのまま起動するとテーブル構造の不整合が起きるため、更新前に一度削除してください(フォロワーの再取得・再判定が必要になります)。

```bash
cd /opt/artfollow
git pull
sudo systemctl stop artfollow
rm -f data/app.db data/app.db-wal data/app.db-shm
npm install
npm run build
sudo systemctl start artfollow
```

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
    api/scan/          フォロワー取得・AI分類(検索クエリ単位)
    api/candidates/    検索結果一覧(フィルタ・ソート対応)
    api/mutual/        知り合いのフォロワー数オンデマンド計算
    api/follow/        フォローバック実行
    api/status/         ダッシュボード用集計(検索クエリ単位)
  lib/
    db.ts              SQLiteスキーマ・KVストア
    xOAuth.ts           X OAuth2 PKCEフロー・トークン管理
    xClient.ts           X API v2 呼び出し(フォロワー/フォロー中/投稿/フォロー実行)
    searchQuery.ts       検索クエリ文からのキーワード自動生成・キャッシュ
    heuristic.ts        動的キーワードによる事前フィルタ
    openaiClassify.ts   OpenAIバッチ分類(検索クエリ単位)
    session.ts / auth.ts アプリ保護用セッション
    crypto.ts            トークン暗号化
```
