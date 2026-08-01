import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex
} from "drizzle-orm/sqlite-core";

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`)
});

export const subscriptions = sqliteTable(
  "subscriptions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    rssUrl: text("rss_url").notNull().unique(),
    enabled: integer("enabled").notNull().default(1),
    autoDownload: integer("auto_download").notNull().default(1),
    seasonNumber: integer("season_number").notNull().default(1),
    destinationRoot: text("destination_root").notNull().default("/115/Anime"),
    incomingPath: text("incoming_path"),
    tmdbSeriesId: integer("tmdb_series_id"),
    lastPolledAt: text("last_polled_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
  }
);

export const filterRules = sqliteTable("filter_rules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  subscriptionId: integer("subscription_id")
    .notNull()
    .references(() => subscriptions.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  value: text("value").notNull(),
  enabled: integer("enabled").notNull().default(1),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`)
});

export const feedItems = sqliteTable(
  "feed_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    subscriptionId: integer("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    guid: text("guid").notNull(),
    rssGuid: text("rss_guid"),
    title: text("title").notNull(),
    link: text("link"),
    downloadUrl: text("download_url"),
    publishedAt: text("published_at"),
    rawXmlJson: text("raw_xml_json"),
    firstSeenAt: text("first_seen_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
  },
  (table) => [
    uniqueIndex("feed_items_subscription_guid").on(table.subscriptionId, table.guid),
    uniqueIndex("feed_items_subscription_download_url").on(
      table.subscriptionId,
      table.downloadUrl
    ),
    index("idx_feed_items_subscription").on(table.subscriptionId, table.firstSeenAt)
  ]
);

export const releaseMetadata = sqliteTable("release_metadata", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  feedItemId: integer("feed_item_id")
    .notNull()
    .unique()
    .references(() => feedItems.id, { onDelete: "cascade" }),
  releaseGroup: text("release_group"),
  parsedTitle: text("parsed_title"),
  episodeNumber: integer("episode_number"),
  episodeText: text("episode_text"),
  releaseRevision: integer("release_revision").notNull().default(1),
  resolution: text("resolution"),
  subtitleLanguage: text("subtitle_language"),
  container: text("container"),
  tagsJson: text("tags_json").notNull().default("[]"),
  parseConfidence: integer("parse_confidence").notNull().default(0),
  needsReview: integer("needs_review").notNull().default(0)
});

export const downloadJobs = sqliteTable(
  "download_jobs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    subscriptionId: integer("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    feedItemId: integer("feed_item_id")
      .notNull()
      .unique()
      .references(() => feedItems.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    openlistTaskId: text("openlist_task_id"),
    /**
     * User-forced download of a superseded / skipped release: bypasses the
     * preferred-revision guards at submit and organize time.
     */
    forceDownload: integer("force_download").notNull().default(0),
    /** BitTorrent info-hash (hex), set when torrent/magnet is resolved. */
    infoHash: text("info_hash"),
    /**
     * OpenList offline task name or magnet dn= — used to adopt incoming folders
     * without re-querying the full task list every scan.
     */
    offlineName: text("offline_name"),
    sourceUrl: text("source_url"),
    targetPath: text("target_path"),
    errorMessage: text("error_message"),
    scanMissCount: integer("scan_miss_count").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
  },
  (table) => [
    index("idx_jobs_status").on(table.status, table.updatedAt),
    index("idx_jobs_info_hash").on(table.infoHash),
    index("idx_jobs_openlist_task").on(table.openlistTaskId)
  ]
);

export const episodeFiles = sqliteTable(
  "episode_files",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    subscriptionId: integer("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    feedItemId: integer("feed_item_id").references(() => feedItems.id, {
      onDelete: "set null"
    }),
    episodeNumber: integer("episode_number"),
    originalPath: text("original_path").notNull(),
    finalPath: text("final_path"),
    sizeBytes: integer("size_bytes"),
    status: text("status").notNull().default("detected"),
    errorMessage: text("error_message"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
  },
  (table) => [
    uniqueIndex("episode_files_subscription_original").on(
      table.subscriptionId,
      table.originalPath
    ),
    index("idx_files_subscription").on(table.subscriptionId, table.updatedAt)
  ]
);

export const workerTasks = sqliteTable(
  "worker_tasks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    type: text("type").notNull(),
    subscriptionId: integer("subscription_id").references(() => subscriptions.id, {
      onDelete: "set null"
    }),
    status: text("status").notNull().default("queued"),
    payloadJson: text("payload_json").notNull().default("{}"),
    errorMessage: text("error_message"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
  },
  (table) => [
    index("idx_worker_tasks_status").on(table.status, table.createdAt),
    index("idx_worker_tasks_target").on(table.type, table.subscriptionId, table.status)
  ]
);

export const schema = {
  settings,
  subscriptions,
  filterRules,
  feedItems,
  releaseMetadata,
  downloadJobs,
  episodeFiles,
  workerTasks
};
