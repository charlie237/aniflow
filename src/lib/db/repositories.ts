import { getDb } from "@/lib/db/client";
import {
  mapEpisodeFile,
  mapFeedItem,
  mapJob,
  mapMetadata,
  mapRule,
  mapSubscription,
  mapWorkerTask
} from "@/lib/db/mappers";
import type {
  DashboardData,
  DashboardEpisodePage,
  DashboardEpisodeRow,
  DownloadJob,
  EpisodeStatusFilter,
  EpisodeFile,
  FeedItem,
  FilterRule,
  JobStatus,
  ReleaseMetadata,
  RuleType,
  SystemSettings,
  Subscription,
  WorkerHealth,
  WorkerTask,
  WorkerTaskStatus,
  WorkerTaskType
} from "@/lib/db/types";
import { evaluateRules } from "@/lib/rules/engine";

const defaultSystemSettings: SystemSettings = {
  openlistBaseUrl: "",
  openlistToken: "",
  openlist115Mode: "115 Cloud",
  openlistIncomingPath: "/115/Anime/_incoming",
  mediaLibraryRoot: "/115/Anime",
  seasonPathTemplate: "{title}/Season {season_pad}",
  episodeFileTemplate: "{title} - S{season_pad}E{episode_pad}.{ext}",
  replaceExistingOnRevision: true,
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
  rssGuid?: string | null;
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
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM episode_files WHERE subscription_id = ?").run(id);
    db.prepare("DELETE FROM download_jobs WHERE subscription_id = ?").run(id);
    db.prepare(
      `DELETE FROM release_metadata
       WHERE feed_item_id IN (
         SELECT id FROM feed_items WHERE subscription_id = ?
       )`
    ).run(id);
    db.prepare("DELETE FROM feed_items WHERE subscription_id = ?").run(id);
    db.prepare("DELETE FROM filter_rules WHERE subscription_id = ?").run(id);
    db.prepare("DELETE FROM worker_tasks WHERE subscription_id = ?").run(id);
    db.prepare("DELETE FROM subscriptions WHERE id = ?").run(id);
  });
  tx();
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

export function replaceSubscriptionAllowRules(
  subscriptionId: number,
  rules: Array<{ type: Extract<RuleType, "group_allow" | "resolution_allow" | "language_allow">; value: string }>
) {
  const db = getDb();
  const transaction = db.transaction(() => {
    db.prepare(
      `DELETE FROM filter_rules
       WHERE subscription_id = ?
         AND type IN ('group_allow', 'resolution_allow', 'language_allow')`
    ).run(subscriptionId);

    const insert = db.prepare(
      "INSERT INTO filter_rules (subscription_id, type, value) VALUES (?, ?, ?)"
    );
    for (const rule of rules) {
      insert.run(subscriptionId, rule.type, rule.value.trim());
    }
  });
  transaction();
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
    openlist115Mode: normalize115Mode(values.get("openlist115Mode")),
    openlistIncomingPath:
      values.get("openlistIncomingPath") ??
      defaultSystemSettings.openlistIncomingPath,
    mediaLibraryRoot:
      values.get("mediaLibraryRoot") ??
      defaultSystemSettings.mediaLibraryRoot,
    seasonPathTemplate:
      values.get("seasonPathTemplate") ??
      defaultSystemSettings.seasonPathTemplate,
    episodeFileTemplate:
      values.get("episodeFileTemplate") ??
      defaultSystemSettings.episodeFileTemplate,
    replaceExistingOnRevision: boolSetting(
      values.get("replaceExistingOnRevision"),
      defaultSystemSettings.replaceExistingOnRevision
    ),
    proxyEnabled: boolSetting(values.get("proxyEnabled"), false),
    proxyUrl:
      values.get("proxyUrl") ??
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

export function touchWorkerHeartbeat() {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value, updated_at)
       VALUES ('workerLastSeenAt', ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = CURRENT_TIMESTAMP`
    )
    .run(new Date().toISOString());
}

export function getWorkerHealth(): WorkerHealth {
  const settings = getSystemSettings();
  const row = getDb()
    .prepare("SELECT value FROM settings WHERE key = 'workerLastSeenAt'")
    .get() as { value: string } | undefined;
  const lastSeenAt = row?.value ?? null;
  const staleAfterSeconds = Math.max(settings.workerIntervalSeconds * 2 + 60, 180);
  const secondsSinceLastSeen = lastSeenAt
    ? Math.floor((Date.now() - new Date(lastSeenAt).getTime()) / 1000)
    : null;

  return {
    lastSeenAt,
    secondsSinceLastSeen:
      secondsSinceLastSeen == null || Number.isNaN(secondsSinceLastSeen)
        ? null
        : secondsSinceLastSeen,
    staleAfterSeconds,
    ok:
      secondsSinceLastSeen != null &&
      Number.isFinite(secondsSinceLastSeen) &&
      secondsSinceLastSeen <= staleAfterSeconds
  };
}

export function upsertFeedItem(subscription: Subscription, item: ParsedFeedInput) {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT OR IGNORE INTO feed_items (
        subscription_id, guid, rss_guid, title, link, download_url, published_at, raw_xml_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      subscription.id,
      item.guid,
      item.rssGuid ?? null,
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
    db.prepare(
      `UPDATE feed_items SET
        rss_guid = ?,
        title = ?,
        link = ?,
        download_url = COALESCE(?, download_url),
        published_at = COALESCE(?, published_at),
        raw_xml_json = ?
       WHERE id = ?`
    ).run(
      item.rssGuid ?? null,
      item.title,
      item.link ?? null,
      item.downloadUrl ?? null,
      item.publishedAt ?? null,
      item.rawXmlJson ?? null,
      Number(feedRow.id)
    );

    const updatedFeedRow = db
      .prepare("SELECT * FROM feed_items WHERE id = ?")
      .get(feedRow.id) as Record<string, unknown> | undefined;
    if (!updatedFeedRow) throw new Error("Failed to read feed item after update");
    const feedItem = mapFeedItem(updatedFeedRow);

    db.prepare(
      `INSERT INTO release_metadata (
        feed_item_id, release_group, parsed_title, episode_number, episode_text,
        release_revision, resolution, subtitle_language, container,
        tags_json, parse_confidence, needs_review
      ) VALUES (
        @feedItemId, @releaseGroup, @parsedTitle, @episodeNumber, @episodeText,
        @releaseRevision, @resolution, @subtitleLanguage, @container,
        @tagsJson, @parseConfidence, @needsReview
      )
      ON CONFLICT(feed_item_id) DO UPDATE SET
        release_group = excluded.release_group,
        parsed_title = excluded.parsed_title,
        episode_number = excluded.episode_number,
        episode_text = excluded.episode_text,
        release_revision = excluded.release_revision,
        resolution = excluded.resolution,
        subtitle_language = excluded.subtitle_language,
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
      releaseRevision: item.metadata.releaseRevision,
      resolution: item.metadata.resolution,
      subtitleLanguage: item.metadata.subtitleLanguage,
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

export function getPreferredFeedItemIdForRelease(
  subscriptionId: number,
  metadata: ReleaseMetadata
) {
  if (metadata.episodeNumber == null) return null;
  const row = getDb()
    .prepare(
      `SELECT f.id
       FROM feed_items f
       JOIN release_metadata m ON m.feed_item_id = f.id
       WHERE f.subscription_id = @subscriptionId
         AND m.episode_number = @episodeNumber
         AND COALESCE(m.release_group, '') = COALESCE(@releaseGroup, '')
         AND COALESCE(m.resolution, '') = COALESCE(@resolution, '')
         AND COALESCE(m.subtitle_language, '') = COALESCE(@subtitleLanguage, '')
       ORDER BY m.release_revision DESC,
         datetime(COALESCE(f.published_at, f.first_seen_at)) DESC,
         f.id DESC
       LIMIT 1`
    )
    .get({
      subscriptionId,
      episodeNumber: metadata.episodeNumber,
      releaseGroup: metadata.releaseGroup,
      resolution: metadata.resolution,
      subtitleLanguage: metadata.subtitleLanguage
    }) as { id: number } | undefined;

  return row?.id ?? null;
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

export function listJobs(limit = 200) {
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
       ORDER BY first_seen_at DESC, id DESC`
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
       ORDER BY f.first_seen_at DESC, f.id DESC`
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

export function listEpisodeFiles(limit = 200) {
  return getDb()
    .prepare("SELECT * FROM episode_files ORDER BY updated_at DESC LIMIT ?")
    .all(limit)
    .map((row) => mapEpisodeFile(row as Record<string, unknown>));
}

export function enqueueWorkerTask(input: {
  type: WorkerTaskType;
  subscriptionId?: number | null;
  payload?: Record<string, unknown>;
}) {
  const db = getDb();
  const subscriptionId = input.subscriptionId ?? null;
  const payloadJson = JSON.stringify(input.payload ?? {});
  const dedupeKey =
    typeof input.payload?.dedupeKey === "string" ? input.payload.dedupeKey : null;
  const active = dedupeKey
    ? (db
        .prepare(
          `SELECT * FROM worker_tasks
           WHERE type = ?
             AND payload_json = ?
             AND status IN ('queued', 'running')
           ORDER BY id DESC
           LIMIT 1`
        )
        .get(input.type, payloadJson) as Record<string, unknown> | undefined)
    : (db
        .prepare(
          `SELECT * FROM worker_tasks
           WHERE type = ?
             AND COALESCE(subscription_id, 0) = COALESCE(?, 0)
             AND status IN ('queued', 'running')
           ORDER BY id DESC
           LIMIT 1`
        )
        .get(input.type, subscriptionId) as Record<string, unknown> | undefined);
  if (active) return mapWorkerTask(active);

  const result = db
    .prepare(
      `INSERT INTO worker_tasks (type, subscription_id, payload_json)
       VALUES (?, ?, ?)`
    )
    .run(input.type, subscriptionId, payloadJson);

  return getWorkerTask(Number(result.lastInsertRowid));
}

export function getWorkerTask(id: number) {
  const row = getDb()
    .prepare("SELECT * FROM worker_tasks WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  return row ? mapWorkerTask(row) : null;
}

export function listWorkerTasksByStatus(statuses: WorkerTaskStatus[]) {
  if (statuses.length === 0) return [];
  const placeholders = statuses.map(() => "?").join(", ");
  return getDb()
    .prepare(
      `SELECT * FROM worker_tasks
       WHERE status IN (${placeholders})
       ORDER BY created_at ASC, id ASC`
    )
    .all(...statuses)
    .map((row) => mapWorkerTask(row as Record<string, unknown>));
}

export function listWorkerTasks(limit = 200) {
  return getDb()
    .prepare(
      `SELECT * FROM worker_tasks
       ORDER BY updated_at DESC, id DESC
       LIMIT ?`
    )
    .all(limit)
    .map((row) => mapWorkerTask(row as Record<string, unknown>));
}

export function claimNextWorkerTask() {
  const db = getDb();
  const tx = db.transaction((): WorkerTask | null => {
    const row = db
      .prepare(
        `SELECT * FROM worker_tasks
         WHERE status = 'queued'
         ORDER BY created_at ASC, id ASC
         LIMIT 1`
      )
      .get() as Record<string, unknown> | undefined;
    if (!row) return null;

    const result = db.prepare(
      `UPDATE worker_tasks SET
        status = 'running',
        attempts = attempts + 1,
        started_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'queued'`
    ).run(Number(row.id));
    if (result.changes === 0) return null;

    return getWorkerTask(Number(row.id));
  });

  return tx();
}

export function completeWorkerTask(id: number) {
  getDb()
    .prepare(
      `UPDATE worker_tasks SET
        status = 'completed',
        error_message = NULL,
        finished_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .run(id);
}

export function failWorkerTask(id: number, errorMessage: string) {
  getDb()
    .prepare(
      `UPDATE worker_tasks SET
        status = 'failed',
        error_message = ?,
        finished_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .run(errorMessage, id);
}

export function requeueStaleWorkerTasks(maxRunningSeconds = 1800) {
  return getDb()
    .prepare(
      `UPDATE worker_tasks SET
        status = 'queued',
        error_message = 'Previous run timed out',
        updated_at = CURRENT_TIMESTAMP
       WHERE status = 'running'
         AND datetime(updated_at) < datetime('now', ?)`
    )
    .run(`-${maxRunningSeconds} seconds`).changes;
}

export function resetRuntimeData() {
  const db = getDb();
  const tx = db.transaction(() => {
    const workerTasks = db.prepare("DELETE FROM worker_tasks").run().changes;
    const downloadJobs = db.prepare("DELETE FROM download_jobs").run().changes;
    const episodeFiles = db.prepare("DELETE FROM episode_files").run().changes;
    const releaseMetadata = db.prepare("DELETE FROM release_metadata").run().changes;
    const feedItems = db.prepare("DELETE FROM feed_items").run().changes;
    const subscriptionsTouched = db
      .prepare("UPDATE subscriptions SET last_polled_at = NULL")
      .run().changes;

    return {
      downloadJobs,
      episodeFiles,
      releaseMetadata,
      feedItems,
      workerTasks,
      subscriptionsTouched
    };
  });

  return tx();
}

export interface DashboardQueryInput {
  episodeSubscriptionId?: string;
  episodeSeason?: string;
  episodeStatus?: string;
  episodePage?: string;
  episodePageSize?: string;
}

export function getDashboardData(input: DashboardQueryInput = {}): DashboardData {
  const subscriptions = listSubscriptions();
  const episodePage = getDashboardEpisodePage(input, subscriptions, listRules());
  const activeWorkerTasks = listWorkerTasksByStatus(["queued", "running"]);
  const stats = getDashboardStats(subscriptions, activeWorkerTasks.length);

  return {
    subscriptions,
    rules: listRules(),
    rssItems: [],
    feedItems: [],
    jobs: [],
    workerTasks: listWorkerTasks(),
    episodeFiles: [],
    episodePage,
    workerHealth: getWorkerHealth(),
    stats
  };
}

export function getDashboardEpisodePage(
  input: DashboardQueryInput = {},
  subscriptions = listSubscriptions(),
  rules = listRules()
): DashboardEpisodePage {
  const query = normalizeEpisodeQuery(input);
  const rows = listDashboardEpisodeRows(subscriptions, rules);
  const subscriptionOptions = subscriptionOptionsForSubscriptions(subscriptions);
  const validSubscriptionId = subscriptionOptions.some(
    (option) => option.id === query.subscriptionId
  )
    ? query.subscriptionId
    : subscriptionOptions.length === 1
      ? subscriptionOptions[0].id
      : null;
  const seasonOptions = seasonOptionsForSubscriptions(
    subscriptions,
    validSubscriptionId
  );
  const validSeason =
    query.season != null && seasonOptions.includes(query.season)
      ? query.season
      : seasonOptions.length === 1
        ? seasonOptions[0]
        : null;
  const scopedRows = rows.filter(
    (row) =>
      (validSubscriptionId == null || row.subscriptionId === validSubscriptionId) &&
      (validSeason == null || row.seasonNumber === validSeason)
  );
  const counts = {
    all: scopedRows.length,
    active: scopedRows.filter((row) => episodeStatusMatches(row, "active")).length,
    completed: scopedRows.filter((row) => episodeStatusMatches(row, "completed")).length,
    failed: scopedRows.filter((row) => episodeStatusMatches(row, "failed")).length,
    waiting: scopedRows.filter((row) => episodeStatusMatches(row, "waiting")).length
  };
  const statusRows = scopedRows.filter((row) =>
    episodeStatusMatches(row, query.status)
  );
  const total = statusRows.length;
  const pageCount = Math.max(1, Math.ceil(total / query.pageSize));
  const page = Math.min(query.page, pageCount);
  const offset = (page - 1) * query.pageSize;

  return {
    rows: statusRows.slice(offset, offset + query.pageSize),
    total,
    page,
    pageSize: query.pageSize,
    pageCount,
    filters: {
      subscriptionId: validSubscriptionId,
      season: validSeason,
      status: query.status
    },
    counts,
    subscriptionOptions,
    manualSubscriptionOptions: subscriptions.map((subscription) => ({
      id: subscription.id,
      name: subscription.name,
      seasonNumber: subscription.seasonNumber
    })),
    seasonOptions
  };
}

function subscriptionOptionsForSubscriptions(subscriptions: Subscription[]) {
  return subscriptions.map((subscription) => ({
      id: subscription.id,
      name: subscription.name,
      seasonNumber: subscription.seasonNumber
    }));
}

function listDashboardEpisodeRows(
  subscriptions: Subscription[],
  rules: FilterRule[]
): DashboardEpisodeRow[] {
  const db = getDb();
  const subscriptionById = new Map(
    subscriptions.map((subscription) => [subscription.id, subscription])
  );

  const rows = db
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
        m.release_revision,
        m.resolution,
        m.subtitle_language,
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
        j.updated_at AS job_updated_at,
        COALESCE(ef_feed.id, ef_episode.id) AS file_id,
        COALESCE(ef_feed.subscription_id, ef_episode.subscription_id) AS file_subscription_id,
        COALESCE(ef_feed.feed_item_id, ef_episode.feed_item_id) AS file_feed_item_id,
        COALESCE(ef_feed.episode_number, ef_episode.episode_number) AS file_episode_number,
        COALESCE(ef_feed.original_path, ef_episode.original_path) AS file_original_path,
        COALESCE(ef_feed.final_path, ef_episode.final_path) AS file_final_path,
        COALESCE(ef_feed.size_bytes, ef_episode.size_bytes) AS file_size_bytes,
        COALESCE(ef_feed.status, ef_episode.status) AS file_status,
        COALESCE(ef_feed.error_message, ef_episode.error_message) AS file_error_message,
        COALESCE(ef_feed.created_at, ef_episode.created_at) AS file_created_at,
        COALESCE(ef_feed.updated_at, ef_episode.updated_at) AS file_updated_at
      FROM feed_items f
      JOIN subscriptions s ON s.id = f.subscription_id
      LEFT JOIN release_metadata m ON m.feed_item_id = f.id
      LEFT JOIN download_jobs j ON j.feed_item_id = f.id
      LEFT JOIN episode_files ef_feed ON ef_feed.id = (
        SELECT id FROM episode_files
        WHERE feed_item_id = f.id
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
      )
      LEFT JOIN episode_files ef_episode ON ef_episode.id = (
        SELECT id FROM episode_files
        WHERE feed_item_id IS NULL
          AND subscription_id = f.subscription_id
          AND episode_number = m.episode_number
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
      )
      ORDER BY f.first_seen_at DESC, f.id DESC
      `
    )
    .all()
    .map((row): DashboardEpisodeRow | null => {
      const record = row as Record<string, unknown>;
      const metadata = mapMetadata(
        record.metadata_id == null
          ? null
          : {
              id: record.metadata_id,
              feed_item_id: record.metadata_feed_item_id,
              release_group: record.release_group,
              parsed_title: record.parsed_title,
              episode_number: record.episode_number,
              episode_text: record.episode_text,
              release_revision: record.release_revision,
              resolution: record.resolution,
              subtitle_language: record.subtitle_language,
              container: record.container,
              tags_json: record.tags_json,
              parse_confidence: record.parse_confidence,
              needs_review: record.needs_review
            }
      );
      const item = mapFeedItem(record);
      const job =
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
            });
      const decision = metadata
        ? ruleDecisionForSubscription(
            item.subscriptionId,
            item.title,
            metadata,
            rules
          )
        : { allowed: true, reasons: [] };
      if (!decision.allowed) return null;

      const subscription = subscriptionById.get(item.subscriptionId);
      const file = mapEpisodeFileFromEpisodeRow(record);
      const updatedAt = latestDate([
        job?.updatedAt,
        file?.updatedAt,
        item.publishedAt,
        item.firstSeenAt
      ]);
      return {
        id: `feed:${item.id}`,
        subscriptionId: item.subscriptionId,
        subscriptionName: String(record.subscription_name),
        title: item.title,
        item,
        job,
        metadata,
        files: file ? [file] : [],
        seasonNumber: subscription?.seasonNumber ?? null,
        episodeNumber: metadata?.episodeNumber ?? null,
        episodeText: metadata?.episodeText ?? null,
        updatedAt
      };
    })
    .filter((row): row is DashboardEpisodeRow => Boolean(row));

  return dedupePreferredEpisodeVariants(rows).sort(
    (left, right) => dateMs(right.updatedAt) - dateMs(left.updatedAt)
  );
}

function dedupePreferredEpisodeVariants(rows: DashboardEpisodeRow[]) {
  const keyed = new Map<string, DashboardEpisodeRow>();
  const unkeyed: DashboardEpisodeRow[] = [];

  for (const row of rows) {
    const key = episodeVariantKey(row);
    if (!key) {
      unkeyed.push(row);
      continue;
    }

    const previous = keyed.get(key);
    if (!previous || comparePreferredEpisodeVariant(row, previous) > 0) {
      keyed.set(key, row);
    }
  }

  return [...unkeyed, ...keyed.values()];
}

function episodeVariantKey(row: DashboardEpisodeRow) {
  if (row.episodeNumber == null) return null;
  return [
    row.subscriptionId,
    row.seasonNumber ?? "",
    row.episodeNumber,
    normalizedVariantPart(row.metadata?.releaseGroup),
    normalizedVariantPart(row.metadata?.resolution),
    normalizedVariantPart(row.metadata?.subtitleLanguage)
  ].join("|");
}

function comparePreferredEpisodeVariant(
  left: DashboardEpisodeRow,
  right: DashboardEpisodeRow
) {
  const revisionDelta =
    (left.metadata?.releaseRevision ?? 1) - (right.metadata?.releaseRevision ?? 1);
  if (revisionDelta !== 0) return revisionDelta;
  const dateDelta = dateMs(left.updatedAt) - dateMs(right.updatedAt);
  if (dateDelta !== 0) return dateDelta;
  return feedId(left) - feedId(right);
}

function feedId(row: DashboardEpisodeRow) {
  return row.item?.id ?? 0;
}

function normalizedVariantPart(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function normalizeEpisodeQuery(input: DashboardQueryInput) {
  return {
    subscriptionId: positiveNumberOrNull(input.episodeSubscriptionId),
    season: positiveNumberOrNull(input.episodeSeason),
    status: normalizeEpisodeStatus(input.episodeStatus),
    page: Math.max(1, Number(input.episodePage) || 1),
    pageSize: normalizeEpisodePageSize(input.episodePageSize)
  };
}

function positiveNumberOrNull(value: string | undefined) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizeEpisodeStatus(value: string | undefined): EpisodeStatusFilter {
  return ["active", "completed", "failed", "waiting"].includes(value ?? "")
    ? (value as EpisodeStatusFilter)
    : "all";
}

function normalizeEpisodePageSize(value: string | undefined) {
  const number = Number(value);
  return [10, 20, 50].includes(number) ? number : 20;
}

function seasonOptionsForSubscriptions(
  subscriptions: Subscription[],
  subscriptionId: number | null
) {
  return Array.from(
    new Set(
      subscriptions
        .filter(
          (subscription) =>
            subscriptionId == null || subscription.id === subscriptionId
        )
        .map((subscription) => subscription.seasonNumber)
    )
  ).sort((left, right) => left - right);
}

function episodeStatusMatches(
  row: DashboardEpisodeRow,
  status: EpisodeStatusFilter
) {
  if (status === "all") return true;
  const failedFile = row.files.some((file) => file.status === "failed");
  const renamedFile = row.files.some((file) => file.status === "renamed");
  if (status === "completed") return renamedFile || row.job?.status === "completed";
  if (status === "failed") return failedFile || row.job?.status === "failed";
  if (status === "waiting") {
    return row.job?.status === "needs_review";
  }
  return (
    row.job?.status === "queued" ||
    row.job?.status === "downloading" ||
    row.job?.status === "ready_to_rename"
  );
}

function mapEpisodeFileFromEpisodeRow(record: Record<string, unknown>) {
  if (record.file_id == null) return null;
  return mapEpisodeFile({
    id: record.file_id,
    subscription_id: record.file_subscription_id,
    feed_item_id: record.file_feed_item_id,
    episode_number: record.file_episode_number,
    original_path: record.file_original_path,
    final_path: record.file_final_path,
    size_bytes: record.file_size_bytes,
    status: record.file_status,
    error_message: record.file_error_message,
    created_at: record.file_created_at,
    updated_at: record.file_updated_at
  });
}

function getDashboardStats(
  subscriptions: Subscription[],
  activeWorkerTaskCount: number
): DashboardData["stats"] {
  const db = getDb();
  const queuedJobs = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM download_jobs
       WHERE status IN ('queued', 'downloading', 'ready_to_rename')`
    )
    .get() as { count: number };
  const needsReviewJobs = db
    .prepare("SELECT COUNT(*) AS count FROM download_jobs WHERE status = 'needs_review'")
    .get() as { count: number };
  const completedJobs = db
    .prepare("SELECT COUNT(*) AS count FROM download_jobs WHERE status = 'completed'")
    .get() as { count: number };

  return {
    activeSubscriptions: subscriptions.filter((item) => item.enabled).length,
    queuedJobs: Number(queuedJobs.count),
    workerTasks: activeWorkerTaskCount,
    needsReview: Number(needsReviewJobs.count),
    completedJobs: Number(completedJobs.count)
  };
}

function latestDate(values: Array<string | null | undefined>) {
  return values
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => dateMs(right) - dateMs(left))[0] ?? null;
}

function dateMs(value?: string | null) {
  if (!value) return 0;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const time = new Date(normalized).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function ruleDecisionForSubscription(
  subscriptionId: number,
  title: string,
  metadata: ReleaseMetadata,
  rules: FilterRule[]
) {
  const subscriptionRules = rules.filter(
    (rule) => rule.subscriptionId === subscriptionId && rule.enabled
  );
  if (subscriptionRules.length === 0) return { allowed: true, reasons: [] };
  return evaluateRules(title, metadata, subscriptionRules);
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
  const incomingPath =
    input.openlistIncomingPath.trim() || defaultSystemSettings.openlistIncomingPath;
  return {
    openlistBaseUrl: trimTrailingSlash(input.openlistBaseUrl.trim()),
    openlistToken: input.openlistToken.trim(),
    openlist115Mode: normalize115Mode(input.openlist115Mode),
    openlistIncomingPath: incomingPath,
    mediaLibraryRoot:
      input.mediaLibraryRoot.trim() || defaultSystemSettings.mediaLibraryRoot,
    seasonPathTemplate:
      input.seasonPathTemplate.trim() || "{title}/Season {season_pad}",
    episodeFileTemplate:
      input.episodeFileTemplate.trim() ||
      "{title} - S{season_pad}E{episode_pad}.{ext}",
    replaceExistingOnRevision: Boolean(input.replaceExistingOnRevision),
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
