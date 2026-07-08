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
      destination_root TEXT NOT NULL DEFAULT '/115/Anime',
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
      rss_guid TEXT,
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
      release_revision INTEGER NOT NULL DEFAULT 1,
      resolution TEXT,
      subtitle_language TEXT,
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

    CREATE TABLE IF NOT EXISTS worker_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      subscription_id INTEGER REFERENCES subscriptions(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      payload_json TEXT NOT NULL DEFAULT '{}',
      error_message TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      started_at TEXT,
      finished_at TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_feed_items_subscription
      ON feed_items(subscription_id, first_seen_at DESC);
    CREATE INDEX IF NOT EXISTS idx_jobs_status
      ON download_jobs(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_files_subscription
      ON episode_files(subscription_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_worker_tasks_status
      ON worker_tasks(status, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_worker_tasks_target
      ON worker_tasks(type, subscription_id, status);
  `);
  ensureColumn(database, "feed_items", "rss_guid", "TEXT");
  normalizeReleaseMetadataSchema(database);
  ensureColumn(database, "release_metadata", "release_revision", "INTEGER NOT NULL DEFAULT 1");
  backfillReleaseRevisions(database);
}

function normalizeReleaseMetadataSchema(database: Database.Database) {
  const columns = database
    .prepare("PRAGMA table_info(release_metadata)")
    .all() as Array<{ name: string }>;
  const names = new Set(columns.map((column) => column.name));
  const removedColumns = ["source", "codec", "bit_depth", "audio", "video_tag"];
  if (!removedColumns.some((column) => names.has(column))) return;

  database.exec(`
    DROP TABLE IF EXISTS release_metadata_next;

    CREATE TABLE release_metadata_next (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      feed_item_id INTEGER NOT NULL UNIQUE REFERENCES feed_items(id) ON DELETE CASCADE,
      release_group TEXT,
      parsed_title TEXT,
      episode_number INTEGER,
      episode_text TEXT,
      release_revision INTEGER NOT NULL DEFAULT 1,
      resolution TEXT,
      subtitle_language TEXT,
      container TEXT,
      tags_json TEXT NOT NULL DEFAULT '[]',
      parse_confidence INTEGER NOT NULL DEFAULT 0,
      needs_review INTEGER NOT NULL DEFAULT 0
    );

    INSERT INTO release_metadata_next (
      id, feed_item_id, release_group, parsed_title, episode_number,
      episode_text, release_revision, resolution, subtitle_language, container,
      tags_json, parse_confidence, needs_review
    )
    SELECT
      id, feed_item_id, release_group, parsed_title, episode_number,
      episode_text, 1, resolution, subtitle_language, container,
      tags_json, parse_confidence, needs_review
    FROM release_metadata;

    DROP TABLE release_metadata;
    ALTER TABLE release_metadata_next RENAME TO release_metadata;
  `);
}

function backfillReleaseRevisions(database: Database.Database) {
  const rows = database
    .prepare(
      `SELECT m.id, f.title
       FROM release_metadata m
       JOIN feed_items f ON f.id = m.feed_item_id
       WHERE f.title LIKE '%v%'`
    )
    .all() as Array<{ id: number; title: string }>;
  if (rows.length === 0) return;

  const update = database.prepare(
    "UPDATE release_metadata SET release_revision = ? WHERE id = ?"
  );
  const tx = database.transaction(() => {
    for (const row of rows) {
      update.run(inferReleaseRevisionFromTitle(row.title), row.id);
    }
  });
  tx();
}

function inferReleaseRevisionFromTitle(title: string) {
  const revision = Number.parseInt(
    title.match(/\b(?:S\d{1,2}E|EP\s*)?\d{1,3}\s*v(\d{1,2})\b/i)?.[1] ?? "",
    10
  );
  return Number.isFinite(revision) && revision > 1 ? revision : 1;
}

function ensureColumn(
  database: Database.Database,
  table: string,
  column: string,
  definition: string
) {
  const columns = database
    .prepare(`PRAGMA table_info(${table})`)
    .all() as Array<{ name: string }>;
  if (columns.some((item) => item.name === column)) return;
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
