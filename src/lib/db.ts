import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config";

let instance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (instance) return instance;

  const dbPath = config.dbPath;
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS following (
      id TEXT PRIMARY KEY,
      synced_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS followers (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      name TEXT,
      description TEXT,
      profile_image_url TEXT,
      followers_count INTEGER,
      following_count INTEGER,
      tweet_count INTEGER,
      is_following INTEGER NOT NULL DEFAULT 0,
      fetched_at TEXT NOT NULL,

      -- 直近投稿のキャッシュ(検索クエリに依存しないため全クエリで使い回す)
      tweets_checked_at TEXT,
      tweets_checked_count INTEGER,
      tweets_media_count INTEGER,
      tweets_sample TEXT,

      -- 「知り合いのフォロワー数」はオンデマンド計算・検索クエリに依存しないためここに保持
      mutual_follow_count INTEGER,
      mutual_follow_checked_at TEXT,
      mutual_follow_error TEXT,

      followed_back INTEGER NOT NULL DEFAULT 0,
      followed_back_at TEXT,
      follow_error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_followers_is_following ON followers(is_following);
    CREATE INDEX IF NOT EXISTS idx_followers_followed_back ON followers(followed_back);
    CREATE INDEX IF NOT EXISTS idx_followers_followers_count ON followers(followers_count);
    CREATE INDEX IF NOT EXISTS idx_followers_mutual_follow_count ON followers(mutual_follow_count);

    -- 検索クエリごとにOpenAIへ渡すキーワード群をキャッシュし、クエリ切替のたびに
    -- キーワード抽出APIを呼び直さないようにする
    CREATE TABLE IF NOT EXISTS search_queries (
      query_hash TEXT PRIMARY KEY,
      query_text TEXT NOT NULL,
      keywords_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    -- フォロワー x 検索クエリ 単位の判定結果。同じフォロワーでも検索クエリが変われば
    -- 判定結果も変わるため、followersテーブルとは分離してキャッシュする。
    CREATE TABLE IF NOT EXISTS classifications (
      follower_id TEXT NOT NULL REFERENCES followers(id),
      query_hash TEXT NOT NULL REFERENCES search_queries(query_hash),
      is_match INTEGER,
      confidence REAL,
      reason TEXT,
      skip_reason TEXT,
      classified_at TEXT NOT NULL,
      classifier_model TEXT,
      content_hash TEXT,
      PRIMARY KEY (follower_id, query_hash)
    );

    CREATE INDEX IF NOT EXISTS idx_classifications_query_match ON classifications(query_hash, is_match, confidence);
  `);

  instance = db;
  return db;
}

export function getSetting(key: string): string | null {
  const row = getDb()
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    )
    .run(key, value);
}

export function deleteSetting(key: string): void {
  getDb().prepare("DELETE FROM settings WHERE key = ?").run(key);
}
