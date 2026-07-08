import { getDb } from "@/lib/db/client";
import {
  mapEpisodeFile,
  mapFeedItem,
  mapJob,
  mapMetadata,
  mapRule,
  mapSubscription
} from "@/lib/db/mappers";
import type {
  DashboardData,
  DownloadJob,
  EpisodeFile,
  FeedItem,
  FilterRule,
  JobStatus,
  ReleaseMetadata,
  RuleType,
  SystemSettings,
  Subscription
} from "@/lib/db/types";

const defaultSystemSettings: SystemSettings = {
  openlistBaseUrl: "",
  openlistToken: "",
  openlist115Mode: "115 Cloud",
  openlist115TempDir: "/115/anime/_incoming",
  openlistIncomingPath: "/115/anime/_incoming",
  mediaLibraryRoot: "/115/anime",
  seasonPathTemplate: "{title}/Season {season_pad}",
  episodeFileTemplate: "{title} - S{season_pad}E{episode_pad}.{ext}",
  proxyEnabled: false,
  proxyUrl: "http://127.0.0.1:7890",
  tmdbBearerToken: "",
  workerIntervalSeconds: 300
};

export interface SubscriptionInput {
  name: string;
  rssUrl: string;
  enabled?: boolean;
  autoDownload?: boolean;
  seasonNumber?: number;
  destinationRoot?: string;
  incomingPath?: string | null;
  tmdbSeriesId?: number | null;
}

export interface ParsedFeedInput {
  guid: string;
  title: string;
  link?: string | null;
  downloadUrl?: string | null;
  publishedAt?: string | null;
  rawXmlJson?: string | null;
  metadata: Omit<ReleaseMetadata, "id" | "feedItemId">;
}

export function listSubscriptions() {
  return getDb()
    .prepare("SELECT * FROM subscriptions ORDER BY enabled DESC, name ASC")
    .all()
    .map((row) => mapSubscription(row as Record<string, unknown>));
}

export function listEnabledSubscriptions() {
  return getDb()
    .prepare("SELECT * FROM subscriptions WHERE enabled = 1 ORDER BY name ASC")
    .all()
    .map((row) => mapSubscription(row as Record<string, unknown>));
}

export function getSubscription(id: number) {
  const row = getDb()
    .prepare("SELECT * FROM subscriptions WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  return row ? mapSubscription(row) : null;
}

export function createSubscription(input: SubscriptionInput) {
  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO subscriptions (
        name, rss_url, enabled, auto_download, season_number,
        destination_root, incoming_path, tmdb_series_id
      ) VALUES (
        @name, @rssUrl, @enabled, @autoDownload, @seasonNumber,
        @destinationRoot, @incomingPath, @tmdbSeriesId
      )`
    )
    .run(normalizeSubscriptionInput(input));
  return getSubscription(Number(result.lastInsertRowid));
}

export function updateSubscription(id: number, input: SubscriptionInput) {
  getDb()
    .prepare(
      `UPDATE subscriptions SET
        name = @name,
        rss_url = @rssUrl,
        enabled = @enabled,
        auto_download = @autoDownload,
        season_number = @seasonNumber,
        destination_root = @destinationRoot,
        incoming_path = @incomingPath,
        tmdb_series_id = @tmdbSeriesId,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = @id`
    )
    .run({ id, ...normalizeSubscriptionInput(input) });
  return getSubscription(id);
}

export function touchSubscriptionPolled(id: number) {
  getDb()
    .prepare(
      "UPDATE subscriptions SET last_polled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    )
    .run(id);
}

export function deleteSubscription(id: number) {
  getDb().prepare("DELETE FROM subscriptions WHERE id = ?").run(id);
}

export function listRules(subscriptionId?: number) {
  const rows = subscriptionId
    ? getDb()
        .prepare(
          "SELECT * FROM filter_rules WHERE subscription_id = ? ORDER BY type ASC, value ASC"
        )
        .all(subscriptionId)
    : getDb()
        .prepare("SELECT * FROM filter_rules ORDER BY subscription_id ASC, type ASC")
        .all();
  return rows.map((row) => mapRule(row as Record<string, unknown>));
}

export function addRule(subscriptionId: number, type: RuleType, value: string) {
  getDb()
    .prepare(
      "INSERT INTO filter_rules (subscription_id, type, value) VALUES (?, ?, ?)"
    )
    .run(subscriptionId, type, value.trim());
}

export function deleteRule(id: number) {
  getDb().prepare("DELETE FROM filter_rules WHERE id = ?").run(id);
}

export function getSystemSettings(): SystemSettings {
  const rows = getDb()
    .prepare("SELECT key, value FROM settings")
    .all() as Array<{ key: string; value: string }>;
  const values = new Map(rows.map((row) => [row.key, row.value]));

  return {
    openlistBaseUrl:
      values.get("openlistBaseUrl") ?? defaultSystemSettings.openlistBaseUrl,
    openlistToken:
      values.get("openlistToken") ?? defaultSystemSettings.openlistToken,
    openlist115Mode: normalize115Mode(
      values.get("openlist115Mode") ?? values.get("openlistDownloadTool")
    ),
    openlist115TempDir:
      values.get("openlist115TempDir") ??
      values.get("openlistIncomingPath") ??
      defaultSystemSettings.openlist115TempDir,
    openlistIncomingPath:
      values.get("openlistIncomingPath") ??
      defaultSystemSettings.openlistIncomingPath,
    mediaLibraryRoot:
      values.get("mediaLibraryRoot") ??
      values.get("defaultDestinationRoot") ??
      defaultSystemSettings.mediaLibraryRoot,
    seasonPathTemplate:
      values.get("seasonPathTemplate") ??
      defaultSystemSettings.seasonPathTemplate,
    episodeFileTemplate:
      values.get("episodeFileTemplate") ??
      defaultSystemSettings.episodeFileTemplate,
    proxyEnabled: boolSetting(values.get("proxyEnabled"), false),
    proxyUrl:
      values.get("proxyUrl") ??
      legacyProxyUrl(values) ??
      defaultSystemSettings.proxyUrl,
    tmdbBearerToken:
      values.get("tmdbBearerToken") ?? defaultSystemSettings.tmdbBearerToken,
    workerIntervalSeconds: Number(
      values.get("workerIntervalSeconds") ??
        defaultSystemSettings.workerIntervalSeconds
    )
  };
}

export function saveSystemSettings(input: SystemSettings) {
  const normalized = normalizeSystemSettings(input);
  const db = getDb();
  const write = db.prepare(
    `INSERT INTO settings (key, value, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = CURRENT_TIMESTAMP`
  );
  const tx = db.transaction((settings: SystemSettings) => {
    for (const [key, value] of Object.entries(settings)) {
      write.run(key, String(value));
    }
  });
  tx(normalized);
  return normalized;
}

export function upsertFeedItem(subscription: Subscription, item: ParsedFeedInput) {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT OR IGNORE INTO feed_items (
        subscription_id, guid, title, link, download_url, published_at, raw_xml_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      subscription.id,
      item.guid,
      item.title,
      item.link ?? null,
      item.downloadUrl ?? null,
      item.publishedAt ?? null,
      item.rawXmlJson ?? null
    );

    const feedRow = db
      .prepare(
        `SELECT * FROM feed_items
         WHERE subscription_id = ? AND (guid = ? OR (download_url IS NOT NULL AND download_url = ?))
         ORDER BY id DESC LIMIT 1`
      )
      .get(subscription.id, item.guid, item.downloadUrl ?? null) as
      | Record<string, unknown>
      | undefined;

    if (!feedRow) throw new Error("Failed to read feed item after insert");
    const feedItem = mapFeedItem(feedRow);

    db.prepare(
      `INSERT INTO release_metadata (
        feed_item_id, release_group, parsed_title, episode_number, episode_text,
        resolution, subtitle_language, source, codec, audio, container,
        tags_json, parse_confidence, needs_review
      ) VALUES (
        @feedItemId, @releaseGroup, @parsedTitle, @episodeNumber, @episodeText,
        @resolution, @subtitleLanguage, @source, @codec, @audio, @container,
        @tagsJson, @parseConfidence, @needsReview
      )
      ON CONFLICT(feed_item_id) DO UPDATE SET
        release_group = excluded.release_group,
        parsed_title = excluded.parsed_title,
        episode_number = excluded.episode_number,
        episode_text = excluded.episode_text,
        resolution = excluded.resolution,
        subtitle_language = excluded.subtitle_language,
        source = excluded.source,
        codec = excluded.codec,
        audio = excluded.audio,
        container = excluded.container,
        tags_json = excluded.tags_json,
        parse_confidence = excluded.parse_confidence,
        needs_review = excluded.needs_review`
    ).run({
      feedItemId: feedItem.id,
      releaseGroup: item.metadata.releaseGroup,
      parsedTitle: item.metadata.parsedTitle,
      episodeNumber: item.metadata.episodeNumber,
      episodeText: item.metadata.episodeText,
      resolution: item.metadata.resolution,
      subtitleLanguage: item.metadata.subtitleLanguage,
      source: item.metadata.source,
      codec: item.metadata.codec,
      audio: item.metadata.audio,
      container: item.metadata.container,
      tagsJson: JSON.stringify(item.metadata.tags),
      parseConfidence: item.metadata.parseConfidence,
      needsReview: item.metadata.needsReview ? 1 : 0
    });

    return feedItem;
  });
  return tx();
}

export function getFeedItem(id: number) {
  const row = getDb()
    .prepare("SELECT * FROM feed_items WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  return row ? mapFeedItem(row) : null;
}

export function getMetadataForFeedItem(feedItemId: number) {
  const row = getDb()
    .prepare("SELECT * FROM release_metadata WHERE feed_item_id = ?")
    .get(feedItemId) as Record<string, unknown> | undefined;
  return mapMetadata(row);
}

export function getJobForFeedItem(feedItemId: number) {
  const row = getDb()
    .prepare("SELECT * FROM download_jobs WHERE feed_item_id = ?")
    .get(feedItemId) as Record<string, unknown> | undefined;
  return row ? mapJob(row) : null;
}

export function getJob(id: number) {
  const row = getDb()
    .prepare("SELECT * FROM download_jobs WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  return row ? mapJob(row) : null;
}

export function createOrUpdateJob(params: {
  subscriptionId: number;
  feedItemId: number;
  status: JobStatus;
  sourceUrl?: string | null;
  targetPath?: string | null;
  openlistTaskId?: string | null;
  errorMessage?: string | null;
}) {
  getDb()
    .prepare(
      `INSERT INTO download_jobs (
        subscription_id, feed_item_id, status, source_url, target_path,
        openlist_task_id, error_message, attempts
      ) VALUES (
        @subscriptionId, @feedItemId, @status, @sourceUrl, @targetPath,
        @openlistTaskId, @errorMessage, 0
      )
      ON CONFLICT(feed_item_id) DO UPDATE SET
        status = excluded.status,
        source_url = COALESCE(excluded.source_url, download_jobs.source_url),
        target_path = COALESCE(excluded.target_path, download_jobs.target_path),
        openlist_task_id = COALESCE(excluded.openlist_task_id, download_jobs.openlist_task_id),
        error_message = excluded.error_message,
        updated_at = CURRENT_TIMESTAMP`
    )
    .run({
      subscriptionId: params.subscriptionId,
      feedItemId: params.feedItemId,
      status: params.status,
      sourceUrl: params.sourceUrl ?? null,
      targetPath: params.targetPath ?? null,
      openlistTaskId: params.openlistTaskId ?? null,
      errorMessage: params.errorMessage ?? null
    });
  return getJobForFeedItem(params.feedItemId);
}

export function markJobAttempt(jobId: number, fields: Partial<DownloadJob>) {
  getDb()
    .prepare(
      `UPDATE download_jobs SET
        status = COALESCE(@status, status),
        openlist_task_id = COALESCE(@openlistTaskId, openlist_task_id),
        target_path = COALESCE(@targetPath, target_path),
        error_message = @errorMessage,
        attempts = attempts + 1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = @jobId`
    )
    .run({
      jobId,
      status: fields.status ?? null,
      openlistTaskId: fields.openlistTaskId ?? null,
      targetPath: fields.targetPath ?? null,
      errorMessage: fields.errorMessage ?? null
    });
}

export function listJobs(limit = 100) {
  return getDb()
    .prepare("SELECT * FROM download_jobs ORDER BY updated_at DESC LIMIT ?")
    .all(limit)
    .map((row) => mapJob(row as Record<string, unknown>));
}

export function listJobsByStatus(statuses: JobStatus[]) {
  if (statuses.length === 0) return [];
  const placeholders = statuses.map(() => "?").join(", ");
  return getDb()
    .prepare(
      `SELECT * FROM download_jobs WHERE status IN (${placeholders}) ORDER BY updated_at ASC`
    )
    .all(...statuses)
    .map((row) => mapJob(row as Record<string, unknown>));
}

export function updateJobStatus(
  jobId: number,
  status: JobStatus,
  fields?: {
    openlistTaskId?: string | null;
    targetPath?: string | null;
    errorMessage?: string | null;
  }
) {
  getDb()
    .prepare(
      `UPDATE download_jobs SET
        status = @status,
        openlist_task_id = COALESCE(@openlistTaskId, openlist_task_id),
        target_path = COALESCE(@targetPath, target_path),
        error_message = @errorMessage,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = @jobId`
    )
    .run({
      jobId,
      status,
      openlistTaskId: fields?.openlistTaskId ?? null,
      targetPath: fields?.targetPath ?? null,
      errorMessage: fields?.errorMessage ?? null
    });
}

export function findFeedItemsForSubscription(subscriptionId: number) {
  return getDb()
    .prepare(
      `SELECT * FROM feed_items
       WHERE subscription_id = ?
       ORDER BY first_seen_at DESC
       LIMIT 500`
    )
    .all(subscriptionId)
    .map((row) => mapFeedItem(row as Record<string, unknown>));
}

export function findMetadataBySubscription(subscriptionId: number) {
  return getDb()
    .prepare(
      `SELECT m.*
       FROM release_metadata m
       JOIN feed_items f ON f.id = m.feed_item_id
       WHERE f.subscription_id = ?
       ORDER BY f.first_seen_at DESC
       LIMIT 500`
    )
    .all(subscriptionId)
    .map((row) => mapMetadata(row as Record<string, unknown>))
    .filter((item): item is ReleaseMetadata => Boolean(item));
}

export function upsertEpisodeFile(input: {
  subscriptionId: number;
  feedItemId?: number | null;
  episodeNumber?: number | null;
  originalPath: string;
  finalPath?: string | null;
  sizeBytes?: number | null;
  status?: EpisodeFile["status"];
  errorMessage?: string | null;
}) {
  getDb()
    .prepare(
      `INSERT INTO episode_files (
        subscription_id, feed_item_id, episode_number, original_path, final_path,
        size_bytes, status, error_message
      ) VALUES (
        @subscriptionId, @feedItemId, @episodeNumber, @originalPath, @finalPath,
        @sizeBytes, @status, @errorMessage
      )
      ON CONFLICT(subscription_id, original_path) DO UPDATE SET
        feed_item_id = COALESCE(excluded.feed_item_id, episode_files.feed_item_id),
        episode_number = COALESCE(excluded.episode_number, episode_files.episode_number),
        final_path = COALESCE(excluded.final_path, episode_files.final_path),
        size_bytes = COALESCE(excluded.size_bytes, episode_files.size_bytes),
        status = excluded.status,
        error_message = excluded.error_message,
        updated_at = CURRENT_TIMESTAMP`
    )
    .run({
      subscriptionId: input.subscriptionId,
      feedItemId: input.feedItemId ?? null,
      episodeNumber: input.episodeNumber ?? null,
      originalPath: input.originalPath,
      finalPath: input.finalPath ?? null,
      sizeBytes: input.sizeBytes ?? null,
      status: input.status ?? "detected",
      errorMessage: input.errorMessage ?? null
    });
}

export function listEpisodeFiles(limit = 100) {
  return getDb()
    .prepare("SELECT * FROM episode_files ORDER BY updated_at DESC LIMIT ?")
    .all(limit)
    .map((row) => mapEpisodeFile(row as Record<string, unknown>));
}

export function getDashboardData(): DashboardData {
  const db = getDb();
  const subscriptions = listSubscriptions();
  const rules = listRules();
  const feedItems = db
    .prepare(
      `SELECT
        f.*,
        s.name AS subscription_name,
        m.id AS metadata_id,
        m.feed_item_id AS metadata_feed_item_id,
        m.release_group,
        m.parsed_title,
        m.episode_number,
        m.episode_text,
        m.resolution,
        m.subtitle_language,
        m.source,
        m.codec,
        m.audio,
        m.container,
        m.tags_json,
        m.parse_confidence,
        m.needs_review,
        j.id AS job_id,
        j.status AS job_status,
        j.openlist_task_id,
        j.source_url,
        j.target_path,
        j.error_message,
        j.attempts,
        j.created_at AS job_created_at,
        j.updated_at AS job_updated_at
      FROM feed_items f
      JOIN subscriptions s ON s.id = f.subscription_id
      LEFT JOIN release_metadata m ON m.feed_item_id = f.id
      LEFT JOIN download_jobs j ON j.feed_item_id = f.id
      ORDER BY f.first_seen_at DESC
      LIMIT 80`
    )
    .all()
    .map((row) => {
      const record = row as Record<string, unknown>;
      return {
        ...mapFeedItem(record),
        subscriptionName: String(record.subscription_name),
        metadata: mapMetadata(
          record.metadata_id == null
            ? null
            : {
                id: record.metadata_id,
                feed_item_id: record.metadata_feed_item_id,
                release_group: record.release_group,
                parsed_title: record.parsed_title,
                episode_number: record.episode_number,
                episode_text: record.episode_text,
                resolution: record.resolution,
                subtitle_language: record.subtitle_language,
                source: record.source,
                codec: record.codec,
                audio: record.audio,
                container: record.container,
                tags_json: record.tags_json,
                parse_confidence: record.parse_confidence,
                needs_review: record.needs_review
              }
        ),
        job:
          record.job_id == null
            ? null
            : mapJob({
                id: record.job_id,
                subscription_id: record.subscription_id,
                feed_item_id: record.id,
                status: record.job_status,
                openlist_task_id: record.openlist_task_id,
                source_url: record.source_url,
                target_path: record.target_path,
                error_message: record.error_message,
                attempts: record.attempts,
                created_at: record.job_created_at,
                updated_at: record.job_updated_at
              })
      };
    });

  const jobs = db
    .prepare(
      `SELECT
        j.*,
        s.name AS subscription_name,
        f.title AS feed_title,
        m.id AS metadata_id,
        m.feed_item_id AS metadata_feed_item_id,
        m.release_group,
        m.parsed_title,
        m.episode_number,
        m.episode_text,
        m.resolution,
        m.subtitle_language,
        m.source,
        m.codec,
        m.audio,
        m.container,
        m.tags_json,
        m.parse_confidence,
        m.needs_review
      FROM download_jobs j
      JOIN subscriptions s ON s.id = j.subscription_id
      JOIN feed_items f ON f.id = j.feed_item_id
      LEFT JOIN release_metadata m ON m.feed_item_id = f.id
      ORDER BY j.updated_at DESC
      LIMIT 100`
    )
    .all()
    .map((row) => {
      const record = row as Record<string, unknown>;
      return {
        ...mapJob(record),
        subscriptionName: String(record.subscription_name),
        feedTitle: String(record.feed_title),
        metadata: mapMetadata(
          record.metadata_id == null
            ? null
            : {
                id: record.metadata_id,
                feed_item_id: record.metadata_feed_item_id,
                release_group: record.release_group,
                parsed_title: record.parsed_title,
                episode_number: record.episode_number,
                episode_text: record.episode_text,
                resolution: record.resolution,
                subtitle_language: record.subtitle_language,
                source: record.source,
                codec: record.codec,
                audio: record.audio,
                container: record.container,
                tags_json: record.tags_json,
                parse_confidence: record.parse_confidence,
                needs_review: record.needs_review
              }
        )
      };
    });

  const stats = {
    activeSubscriptions: subscriptions.filter((item) => item.enabled).length,
    queuedJobs: jobs.filter((item) =>
      ["queued", "downloading", "ready_to_rename"].includes(item.status)
    ).length,
    needsReview:
      jobs.filter((item) => item.status === "needs_review").length +
      feedItems.filter((item) => item.metadata?.needsReview).length,
    completedJobs: jobs.filter((item) => item.status === "completed").length
  };

  return {
    subscriptions,
    rules,
    feedItems,
    jobs,
    episodeFiles: listEpisodeFiles(),
    stats
  };
}

function normalizeSubscriptionInput(input: SubscriptionInput) {
  return {
    name: input.name.trim(),
    rssUrl: input.rssUrl.trim(),
    enabled: input.enabled === false ? 0 : 1,
    autoDownload: input.autoDownload === false ? 0 : 1,
    seasonNumber: input.seasonNumber ?? 1,
    destinationRoot: input.destinationRoot?.trim() || defaultSystemSettings.mediaLibraryRoot,
    incomingPath: input.incomingPath?.trim() || null,
    tmdbSeriesId: input.tmdbSeriesId ?? null
  };
}

function normalizeSystemSettings(input: SystemSettings): SystemSettings {
  return {
    openlistBaseUrl: trimTrailingSlash(input.openlistBaseUrl.trim()),
    openlistToken: input.openlistToken.trim(),
    openlist115Mode: normalize115Mode(input.openlist115Mode),
    openlist115TempDir:
      input.openlist115TempDir.trim() ||
      input.openlistIncomingPath.trim() ||
      defaultSystemSettings.openlist115TempDir,
    openlistIncomingPath:
      input.openlistIncomingPath.trim() || defaultSystemSettings.openlistIncomingPath,
    mediaLibraryRoot:
      input.mediaLibraryRoot.trim() || defaultSystemSettings.mediaLibraryRoot,
    seasonPathTemplate:
      input.seasonPathTemplate.trim() || "{title}/Season {season_pad}",
    episodeFileTemplate:
      input.episodeFileTemplate.trim() ||
      "{title} - S{season_pad}E{episode_pad}.{ext}",
    proxyEnabled: Boolean(input.proxyEnabled),
    proxyUrl: normalizeProxyUrl(input.proxyUrl),
    tmdbBearerToken: input.tmdbBearerToken.trim(),
    workerIntervalSeconds: Math.max(30, Number(input.workerIntervalSeconds || 300))
  };
}

function normalize115Mode(value: unknown): SystemSettings["openlist115Mode"] {
  return value === "115 Open" ? "115 Open" : "115 Cloud";
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function legacyProxyUrl(values: Map<string, string>) {
  return (
    values.get("httpsProxy") ||
    values.get("httpProxy") ||
    values.get("allProxy") ||
    undefined
  );
}

function normalizeProxyUrl(value: string) {
  const trimmed = value.trim() || defaultSystemSettings.proxyUrl;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
  return trimTrailingSlash(withScheme);
}

function boolSetting(value: string | undefined, fallback: boolean) {
  if (value == null) return fallback;
  return value === "true" || value === "1";
}
