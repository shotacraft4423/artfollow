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

      heuristic_match INTEGER,

      tweets_checked_at TEXT,
      tweets_checked_count INTEGER,
      tweets_media_count INTEGER,
      tweets_sample TEXT,

      classified INTEGER NOT NULL DEFAULT 0,
      classify_skip_reason TEXT,
      is_artist INTEGER,
      confidence REAL,
      reason TEXT,
      classified_at TEXT,
      classifier_model TEXT,
      content_hash TEXT,

      followed_back INTEGER NOT NULL DEFAULT 0,
      followed_back_at TEXT,
      follow_error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_followers_is_following ON followers(is_following);
    CREATE INDEX IF NOT EXISTS idx_followers_classified ON followers(classified);
    CREATE INDEX IF NOT EXISTS idx_followers_is_artist ON followers(is_artist);
    CREATE INDEX IF NOT EXISTS idx_followers_followed_back ON followers(followed_back);
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
