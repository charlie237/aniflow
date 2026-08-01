import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { appConfig } from "@/lib/config";
import { schema } from "@/lib/db/schema";

type AppDatabase = BetterSQLite3Database<typeof schema>;

let sqlite: Database.Database | null = null;
let db: AppDatabase | null = null;

/** Drizzle query API (preferred). */
export function getDb(): AppDatabase {
  if (db) return db;
  const raw = getSqlite();
  db = drizzle(raw, { schema });
  return db;
}

/** Raw better-sqlite3 handle for bootstrap, complex SQL, and tests. */
export function getSqlite(): Database.Database {
  if (sqlite) return sqlite;

  const databasePath = resolve(appConfig.databasePath);
  mkdirSync(dirname(databasePath), { recursive: true });

  sqlite = new Database(databasePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  bootstrapSchema(sqlite);
  return sqlite;
}

/** @deprecated Use getDb() (Drizzle) or getSqlite() explicitly. */
export function getRawDb() {
  return getSqlite();
}

function bootstrapSchema(database: Database.Database) {
  // Keep imperative bootstrap so existing SQLite files upgrade in place.
  // Table shapes match src/lib/db/schema.ts.
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
      info_hash TEXT,
      offline_name TEXT,
      source_url TEXT,
      target_path TEXT,
      error_message TEXT,
      scan_miss_count INTEGER NOT NULL DEFAULT 0,
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
  ensureColumn(database, "download_jobs", "info_hash", "TEXT");
  ensureColumn(database, "download_jobs", "offline_name", "TEXT");
  ensureColumn(
    database,
    "download_jobs",
    "force_download",
    "INTEGER NOT NULL DEFAULT 0"
  );
  ensureColumn(
    database,
    "download_jobs",
    "scan_miss_count",
    "INTEGER NOT NULL DEFAULT 0"
  );
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_jobs_info_hash ON download_jobs(info_hash);
    CREATE INDEX IF NOT EXISTS idx_jobs_openlist_task ON download_jobs(openlist_task_id);
  `);
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
  // Keep bootstrap free of app-module imports (client loads early). Mirror title-parser coverage.
  const candidates: number[] = [];
  const push = (raw: string | undefined) => {
    if (!raw) return;
    const revision = Number.parseInt(raw.match(/v\s*(\d{1,2})/i)?.[1] ?? raw, 10);
    if (Number.isFinite(revision) && revision > 1) candidates.push(revision);
  };
  push(title.match(/[\[【(（]\s*v\s*(\d{1,2})\s*[\]】)）]/i)?.[1]);
  push(title.match(/\bS\d{1,2}E\d{1,3}\s*[._\-]?\s*v\s*(\d{1,2})\b/i)?.[1]);
  push(title.match(/(?:^|[^A-Za-z0-9])(?:EP|E)\s*\d{1,3}\s*[._\-]?\s*v\s*(\d{1,2})\b/i)?.[1]);
  push(title.match(/第\s*\d{1,3}\s*(?:话|話|集|夜|回)\s*[._\-]?\s*v\s*(\d{1,2})\b/i)?.[1]);
  push(
    title.match(
      /(?:^|[^A-Za-z0-9])\d{1,3}\s*[._\-]?\s*v\s*(\d{1,2})\b/i
    )?.[1]
  );
  if (candidates.length === 0) {
    push(title.match(/(?:^|[\s_\-])v\s*(\d{1,2})\b(?![\w-])/i)?.[1]);
  }
  return candidates.length > 0 ? Math.max(...candidates) : 1;
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
