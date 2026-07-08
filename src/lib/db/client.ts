import Database from "better-sqlite3";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { appConfig } from "@/lib/config";

let db: Database.Database | null = null;

export function getDb() {
  if (db) return db;

  const databasePath = resolve(appConfig.databasePath);
  mkdirSync(dirname(databasePath), { recursive: true });

  db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  return db;
}

function migrate(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      rss_url TEXT NOT NULL UNIQUE,
      enabled INTEGER NOT NULL DEFAULT 1,
      auto_download INTEGER NOT NULL DEFAULT 1,
      season_number INTEGER NOT NULL DEFAULT 1,
      destination_root TEXT NOT NULL DEFAULT '/115/anime',
      incoming_path TEXT,
      tmdb_series_id INTEGER,
      last_polled_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS filter_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      value TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS feed_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
      guid TEXT NOT NULL,
      title TEXT NOT NULL,
      link TEXT,
      download_url TEXT,
      published_at TEXT,
      raw_xml_json TEXT,
      first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(subscription_id, guid),
      UNIQUE(subscription_id, download_url)
    );

    CREATE TABLE IF NOT EXISTS release_metadata (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      feed_item_id INTEGER NOT NULL UNIQUE REFERENCES feed_items(id) ON DELETE CASCADE,
      release_group TEXT,
      parsed_title TEXT,
      episode_number INTEGER,
      episode_text TEXT,
      resolution TEXT,
      subtitle_language TEXT,
      source TEXT,
      codec TEXT,
      audio TEXT,
      container TEXT,
      tags_json TEXT NOT NULL DEFAULT '[]',
      parse_confidence INTEGER NOT NULL DEFAULT 0,
      needs_review INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS download_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
      feed_item_id INTEGER NOT NULL UNIQUE REFERENCES feed_items(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      openlist_task_id TEXT,
      source_url TEXT,
      target_path TEXT,
      error_message TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS episode_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
      feed_item_id INTEGER REFERENCES feed_items(id) ON DELETE SET NULL,
      episode_number INTEGER,
      original_path TEXT NOT NULL,
      final_path TEXT,
      size_bytes INTEGER,
      status TEXT NOT NULL DEFAULT 'detected',
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(subscription_id, original_path)
    );

    CREATE INDEX IF NOT EXISTS idx_feed_items_subscription
      ON feed_items(subscription_id, first_seen_at DESC);
    CREATE INDEX IF NOT EXISTS idx_jobs_status
      ON download_jobs(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_files_subscription
      ON episode_files(subscription_id, updated_at DESC);
  `);
}
