import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  or,
  sql
} from "drizzle-orm";
import { getDb, getSqlite } from "@/lib/db/client";
import { queryDashboardEpisodePage } from "@/lib/db/dashboard";
import {
  mapEpisodeFile,
  mapFeedItem,
  mapJob,
  mapMetadata,
  mapRule,
  mapSubscription,
  mapWorkerTask
} from "@/lib/db/mappers";
import {
  downloadJobs,
  episodeFiles,
  feedItems,
  filterRules,
  releaseMetadata,
  settings,
  subscriptions,
  workerTasks
} from "@/lib/db/schema";
import type {
  DashboardData,
  DashboardEpisodePage,
  DownloadJob,
  EpisodeFile,
  EpisodeStatusFilter,
  FeedItem,
  JobStatus,
  ReleaseMetadata,
  RuleType,
  Subscription,
  SubscriptionStateFilter,
  SystemSettings,
  WorkerHealth,
  WorkerTask,
  WorkerTaskStatus,
  WorkerTaskType
} from "@/lib/db/types";
import { parseToUtcDate } from "@/lib/time";
import { isRemotePathWithin, joinRemotePath } from "@/lib/utils/path";

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
  workerIntervalSeconds: 300,
  downloadTimeoutMinutes: 30,
  downloadAutoRetryEnabled: true,
  downloadAutoRetryMaxAttempts: 3,
  downloadAutoRetryCooldownMinutes: 10
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
    .select()
    .from(subscriptions)
    .orderBy(desc(subscriptions.enabled), asc(subscriptions.name))
    .all()
    .map((row) => mapSubscription(row as unknown as Record<string, unknown>));
}

export function listEnabledSubscriptions() {
  return getDb()
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.enabled, 1))
    .orderBy(asc(subscriptions.name))
    .all()
    .map((row) => mapSubscription(row as unknown as Record<string, unknown>));
}

export function getSubscription(id: number) {
  const row = getDb()
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, id))
    .get();
  return row ? mapSubscription(row as unknown as Record<string, unknown>) : null;
}

export function createSubscription(input: SubscriptionInput) {
  const values = normalizeSubscriptionInput(input);
  const result = getDb()
    .insert(subscriptions)
    .values({
      name: values.name,
      rssUrl: values.rssUrl,
      enabled: values.enabled,
      autoDownload: values.autoDownload,
      seasonNumber: values.seasonNumber,
      destinationRoot: values.destinationRoot,
      incomingPath: values.incomingPath,
      tmdbSeriesId: values.tmdbSeriesId
    })
    .run();
  return getSubscription(Number(result.lastInsertRowid));
}

export function updateSubscription(id: number, input: SubscriptionInput) {
  const values = normalizeSubscriptionInput(input);
  getDb()
    .update(subscriptions)
    .set({
      name: values.name,
      rssUrl: values.rssUrl,
      enabled: values.enabled,
      autoDownload: values.autoDownload,
      seasonNumber: values.seasonNumber,
      destinationRoot: values.destinationRoot,
      incomingPath: values.incomingPath,
      tmdbSeriesId: values.tmdbSeriesId,
      updatedAt: sql`CURRENT_TIMESTAMP`
    })
    .where(eq(subscriptions.id, id))
    .run();
  return getSubscription(id);
}

export function archiveSubscription(id: number) {
  const changes = getDb().transaction((tx) => {
    const subscriptionChanges = tx
      .update(subscriptions)
      .set({
        enabled: 0,
        updatedAt: sql`CURRENT_TIMESTAMP`
      })
      .where(eq(subscriptions.id, id))
      .run().changes;
    const pausedJobs = tx
      .update(downloadJobs)
      .set({
        status: "discovered",
        errorMessage: "Subscription is archived; download submission paused",
        updatedAt: sql`CURRENT_TIMESTAMP`
      })
      .where(
        and(
          eq(downloadJobs.subscriptionId, id),
          eq(downloadJobs.status, "queued")
        )
      )
      .run().changes;
    return { subscriptionChanges, pausedJobs };
  });
  return { subscription: getSubscription(id), ...changes };
}

export function restoreSubscription(id: number) {
  getDb()
    .update(subscriptions)
    .set({
      enabled: 1,
      updatedAt: sql`CURRENT_TIMESTAMP`
    })
    .where(eq(subscriptions.id, id))
    .run();
  return getSubscription(id);
}

export function touchSubscriptionPolled(id: number) {
  getDb()
    .update(subscriptions)
    .set({
      lastPolledAt: sql`CURRENT_TIMESTAMP`,
      updatedAt: sql`CURRENT_TIMESTAMP`
    })
    .where(eq(subscriptions.id, id))
    .run();
}

export function deleteSubscription(id: number) {
  const db = getDb();
  db.transaction((tx) => {
    tx.delete(episodeFiles).where(eq(episodeFiles.subscriptionId, id)).run();
    tx.delete(downloadJobs).where(eq(downloadJobs.subscriptionId, id)).run();
    tx.delete(releaseMetadata)
      .where(
        sql`${releaseMetadata.feedItemId} IN (
          SELECT ${feedItems.id} FROM ${feedItems}
          WHERE ${feedItems.subscriptionId} = ${id}
        )`
      )
      .run();
    tx.delete(feedItems).where(eq(feedItems.subscriptionId, id)).run();
    tx.delete(filterRules).where(eq(filterRules.subscriptionId, id)).run();
    tx.delete(workerTasks).where(eq(workerTasks.subscriptionId, id)).run();
    tx.delete(subscriptions).where(eq(subscriptions.id, id)).run();
  });
}

export function listRules(subscriptionId?: number) {
  const rows = subscriptionId
    ? getDb()
        .select()
        .from(filterRules)
        .where(eq(filterRules.subscriptionId, subscriptionId))
        .orderBy(asc(filterRules.type), asc(filterRules.value))
        .all()
    : getDb()
        .select()
        .from(filterRules)
        .orderBy(
          asc(filterRules.subscriptionId),
          asc(filterRules.type),
          asc(filterRules.value)
        )
        .all();
  return rows.map((row) => mapRule(row as unknown as Record<string, unknown>));
}

export function addRule(subscriptionId: number, type: RuleType, value: string) {
  getDb()
    .insert(filterRules)
    .values({
      subscriptionId,
      type,
      value: value.trim()
    })
    .run();
}

export function replaceSubscriptionAllowRules(
  subscriptionId: number,
  rules: Array<{
    type: Extract<RuleType, "group_allow" | "resolution_allow" | "language_allow">;
    value: string;
  }>
) {
  getDb().transaction((tx) => {
    tx.delete(filterRules)
      .where(
        and(
          eq(filterRules.subscriptionId, subscriptionId),
          inArray(filterRules.type, [
            "group_allow",
            "resolution_allow",
            "language_allow"
          ])
        )
      )
      .run();
    for (const rule of rules) {
      tx.insert(filterRules)
        .values({
          subscriptionId,
          type: rule.type,
          value: rule.value.trim()
        })
        .run();
    }
  });
}

export function deleteRule(id: number) {
  getDb().delete(filterRules).where(eq(filterRules.id, id)).run();
}

export function getSystemSettings(): SystemSettings {
  const rows = getDb().select().from(settings).all();
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
      values.get("mediaLibraryRoot") ?? defaultSystemSettings.mediaLibraryRoot,
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
    proxyUrl: values.get("proxyUrl") ?? defaultSystemSettings.proxyUrl,
    tmdbBearerToken:
      values.get("tmdbBearerToken") ?? defaultSystemSettings.tmdbBearerToken,
    workerIntervalSeconds: Number(
      values.get("workerIntervalSeconds") ??
        defaultSystemSettings.workerIntervalSeconds
    ),
    downloadTimeoutMinutes: Math.min(
      24 * 60,
      Math.max(
        1,
        Number(
          values.get("downloadTimeoutMinutes") ??
            defaultSystemSettings.downloadTimeoutMinutes
        ) || defaultSystemSettings.downloadTimeoutMinutes
      )
    ),
    downloadAutoRetryEnabled: boolSetting(
      values.get("downloadAutoRetryEnabled"),
      defaultSystemSettings.downloadAutoRetryEnabled
    ),
    downloadAutoRetryMaxAttempts: Math.min(
      20,
      Math.max(
        1,
        Number(
          values.get("downloadAutoRetryMaxAttempts") ??
            defaultSystemSettings.downloadAutoRetryMaxAttempts
        ) || defaultSystemSettings.downloadAutoRetryMaxAttempts
      )
    ),
    downloadAutoRetryCooldownMinutes: Math.min(
      24 * 60,
      Math.max(
        1,
        Number(
          values.get("downloadAutoRetryCooldownMinutes") ??
            defaultSystemSettings.downloadAutoRetryCooldownMinutes
        ) || defaultSystemSettings.downloadAutoRetryCooldownMinutes
      )
    )
  };
}

export function saveSystemSettings(input: SystemSettings) {
  const normalized = normalizeSystemSettings(input);
  getDb().transaction((tx) => {
    for (const [key, value] of Object.entries(normalized)) {
      tx.insert(settings)
        .values({
          key,
          value: String(value),
          updatedAt: sql`CURRENT_TIMESTAMP`
        })
        .onConflictDoUpdate({
          target: settings.key,
          set: {
            value: String(value),
            updatedAt: sql`CURRENT_TIMESTAMP`
          }
        })
        .run();
    }
  });
  return normalized;
}

export function touchWorkerHeartbeat() {
  const value = new Date().toISOString();
  getDb()
    .insert(settings)
    .values({
      key: "workerLastSeenAt",
      value,
      updatedAt: sql`CURRENT_TIMESTAMP`
    })
    .onConflictDoUpdate({
      target: settings.key,
      set: {
        value,
        updatedAt: sql`CURRENT_TIMESTAMP`
      }
    })
    .run();
}

export function acquireWorkerLease(
  name: string,
  owner: string,
  staleAfterSeconds = 30 * 60
) {
  const key = `workerLease:${name}`;
  const result = getSqlite()
    .prepare(
      `INSERT INTO settings (key, value, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = CURRENT_TIMESTAMP
       WHERE datetime(settings.updated_at) <= datetime('now', ?)`
    )
    .run(key, owner, `-${Math.max(60, staleAfterSeconds)} seconds`);
  return result.changes > 0;
}

export function refreshWorkerLease(name: string, owner: string) {
  return (
    getSqlite()
      .prepare(
        `UPDATE settings SET updated_at = CURRENT_TIMESTAMP
         WHERE key = ? AND value = ?`
      )
      .run(`workerLease:${name}`, owner).changes > 0
  );
}

export function releaseWorkerLease(name: string, owner: string) {
  getSqlite()
    .prepare("DELETE FROM settings WHERE key = ? AND value = ?")
    .run(`workerLease:${name}`, owner);
}

export function getWorkerHealth(): WorkerHealth {
  const systemSettings = getSystemSettings();
  const row = getDb()
    .select()
    .from(settings)
    .where(eq(settings.key, "workerLastSeenAt"))
    .get();
  const lastSeenAt = row?.value ?? null;
  const staleAfterSeconds = Math.max(systemSettings.workerIntervalSeconds * 2 + 60, 180);
  const secondsSinceLastSeen = lastSeenAt
    ? Math.floor((Date.now() - parseToUtcDate(lastSeenAt).getTime()) / 1000)
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
  return getDb().transaction((tx) => {
    tx.insert(feedItems)
      .values({
        subscriptionId: subscription.id,
        guid: item.guid,
        rssGuid: item.rssGuid ?? null,
        title: item.title,
        link: item.link ?? null,
        downloadUrl: item.downloadUrl ?? null,
        publishedAt: item.publishedAt ?? null,
        rawXmlJson: item.rawXmlJson ?? null
      })
      .onConflictDoNothing()
      .run();

    const feedRow = tx
      .select()
      .from(feedItems)
      .where(
        and(
          eq(feedItems.subscriptionId, subscription.id),
          or(
            eq(feedItems.guid, item.guid),
            item.downloadUrl
              ? eq(feedItems.downloadUrl, item.downloadUrl)
              : sql`0`
          )
        )
      )
      .orderBy(desc(feedItems.id))
      .limit(1)
      .get();

    if (!feedRow) throw new Error("Failed to read feed item after insert");

    tx.update(feedItems)
      .set({
        rssGuid: item.rssGuid ?? null,
        title: item.title,
        link: item.link ?? null,
        downloadUrl: item.downloadUrl
          ? item.downloadUrl
          : sql`${feedItems.downloadUrl}`,
        publishedAt: item.publishedAt
          ? item.publishedAt
          : sql`${feedItems.publishedAt}`,
        rawXmlJson: item.rawXmlJson ?? null
      })
      .where(eq(feedItems.id, feedRow.id))
      .run();

    // Re-read for COALESCE-like semantics when downloadUrl/publishedAt omitted
    const updated = tx
      .select()
      .from(feedItems)
      .where(eq(feedItems.id, feedRow.id))
      .get();
    if (!updated) throw new Error("Failed to read feed item after update");
    const feedItem = mapFeedItem(updated as unknown as Record<string, unknown>);

    tx.insert(releaseMetadata)
      .values({
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
      })
      .onConflictDoUpdate({
        target: releaseMetadata.feedItemId,
        set: {
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
        }
      })
      .run();

    return feedItem;
  });
}

export function getFeedItem(id: number) {
  const row = getDb().select().from(feedItems).where(eq(feedItems.id, id)).get();
  return row ? mapFeedItem(row as unknown as Record<string, unknown>) : null;
}

export function getMetadataForFeedItem(feedItemId: number) {
  const row = getDb()
    .select()
    .from(releaseMetadata)
    .where(eq(releaseMetadata.feedItemId, feedItemId))
    .get();
  return mapMetadata(row as unknown as Record<string, unknown> | undefined);
}

const VARIANT_MATCH_SQL = `
  f.subscription_id = @subscriptionId
  AND m.episode_number = @episodeNumber
  AND lower(trim(COALESCE(m.release_group, ''))) = lower(trim(COALESCE(@releaseGroup, '')))
  AND lower(trim(COALESCE(m.resolution, ''))) = lower(trim(COALESCE(@resolution, '')))
  AND lower(trim(COALESCE(m.subtitle_language, ''))) = lower(trim(COALESCE(@subtitleLanguage, '')))
`;

function variantMatchParams(
  subscriptionId: number,
  metadata: Pick<
    ReleaseMetadata,
    "episodeNumber" | "releaseGroup" | "resolution" | "subtitleLanguage"
  >
) {
  return {
    subscriptionId,
    episodeNumber: metadata.episodeNumber,
    releaseGroup: metadata.releaseGroup,
    resolution: metadata.resolution,
    subtitleLanguage: metadata.subtitleLanguage
  };
}

export function getPreferredFeedItemIdForRelease(
  subscriptionId: number,
  metadata: Pick<
    ReleaseMetadata,
    "episodeNumber" | "releaseGroup" | "resolution" | "subtitleLanguage"
  >
) {
  if (metadata.episodeNumber == null) return null;
  const row = getSqlite()
    .prepare(
      `SELECT f.id
       FROM feed_items f
       JOIN release_metadata m ON m.feed_item_id = f.id
       WHERE ${VARIANT_MATCH_SQL}
       ORDER BY m.release_revision DESC,
         datetime(COALESCE(f.published_at, f.first_seen_at)) DESC,
         f.id DESC
       LIMIT 1`
    )
    .get(variantMatchParams(subscriptionId, metadata)) as { id: number } | undefined;

  return row?.id ?? null;
}

/** All feed item ids that share the same release variant facets (any revision). */
export function listVariantFeedItemIds(
  subscriptionId: number,
  metadata: Pick<
    ReleaseMetadata,
    "episodeNumber" | "releaseGroup" | "resolution" | "subtitleLanguage"
  >
) {
  if (metadata.episodeNumber == null) return [] as number[];
  const rows = getSqlite()
    .prepare(
      `SELECT f.id
       FROM feed_items f
       JOIN release_metadata m ON m.feed_item_id = f.id
       WHERE ${VARIANT_MATCH_SQL}
       ORDER BY m.release_revision DESC,
         datetime(COALESCE(f.published_at, f.first_seen_at)) DESC,
         f.id DESC`
    )
    .all(variantMatchParams(subscriptionId, metadata)) as Array<{ id: number }>;
  return rows.map((row) => row.id);
}

/** Highest release_revision among feed items of the same variant facets. */
export function getHighestReleaseRevisionForVariant(
  subscriptionId: number,
  metadata: Pick<
    ReleaseMetadata,
    "episodeNumber" | "releaseGroup" | "resolution" | "subtitleLanguage"
  >
) {
  if (metadata.episodeNumber == null) return 1;
  const row = getSqlite()
    .prepare(
      `SELECT MAX(m.release_revision) AS highest
       FROM feed_items f
       JOIN release_metadata m ON m.feed_item_id = f.id
       WHERE ${VARIANT_MATCH_SQL}`
    )
    .get(variantMatchParams(subscriptionId, metadata)) as
    | { highest: number | null }
    | undefined;
  const highest = Number(row?.highest ?? 1);
  return Number.isFinite(highest) && highest > 1 ? highest : 1;
}

/**
 * Revision of the latest renamed library file at finalPath for this subscription,
 * via linked feed_item metadata when available.
 */
export function getLibraryFileRevisionAtPath(
  subscriptionId: number,
  finalPath: string
) {
  const row = getSqlite()
    .prepare(
      `SELECT m.release_revision AS release_revision
       FROM episode_files ef
       LEFT JOIN release_metadata m ON m.feed_item_id = ef.feed_item_id
       WHERE ef.subscription_id = @subscriptionId
         AND ef.final_path = @finalPath
         AND ef.status = 'renamed'
       ORDER BY datetime(ef.updated_at) DESC, ef.id DESC
       LIMIT 1`
    )
    .get({ subscriptionId, finalPath }) as
    | { release_revision: number | null }
    | undefined;
  if (!row) return null;
  if (row.release_revision == null) return null;
  const revision = Number(row.release_revision);
  return Number.isFinite(revision) && revision > 0 ? revision : null;
}

export function libraryFileExistsAtPath(subscriptionId: number, finalPath: string) {
  const row = getSqlite()
    .prepare(
      `SELECT 1 AS ok
       FROM episode_files
       WHERE subscription_id = @subscriptionId
         AND final_path = @finalPath
         AND status = 'renamed'
       LIMIT 1`
    )
    .get({ subscriptionId, finalPath }) as { ok: number } | undefined;
  return Boolean(row);
}

export function getLibraryEpisodeState(
  subscriptionId: number,
  episodeNumber: number
) {
  const rows = getSqlite()
    .prepare(
      `SELECT ef.final_path, m.release_revision
       FROM episode_files ef
       LEFT JOIN release_metadata m ON m.feed_item_id = ef.feed_item_id
       WHERE ef.subscription_id = @subscriptionId
         AND ef.episode_number = @episodeNumber
         AND ef.status = 'renamed'
       ORDER BY datetime(ef.updated_at) DESC, ef.id DESC`
    )
    .all({ subscriptionId, episodeNumber }) as Array<{
      final_path: string | null;
      release_revision: number | null;
    }>;

  if (rows.length === 0) return null;
  const revisions = rows
    .map((row) => Number(row.release_revision))
    .filter((revision) => Number.isFinite(revision) && revision > 0);
  return {
    path: rows.find((row) => row.final_path)?.final_path ?? null,
    knownRevision: revisions.length > 0 ? Math.max(...revisions) : null,
    fileCount: rows.length
  };
}

export interface LibraryInventoryFile {
  path: string;
  episodeNumber: number | null;
  sizeBytes: number | null;
}

/** Replace the recorded state for one scanned season with OpenList's current view. */
export function syncLibraryEpisodeInventory(
  subscriptionId: number,
  seasonRoot: string,
  files: LibraryInventoryFile[]
) {
  const sqlite = getSqlite();
  const normalizedRoot = joinRemotePath(seasonRoot);
  const normalizedFiles = files.map((file) => ({
    ...file,
    path: joinRemotePath(file.path)
  }));
  const seenPaths = new Set(normalizedFiles.map((file) => file.path));

  const transaction = sqlite.transaction(() => {
    const existing = sqlite
      .prepare(
        `SELECT id, original_path, final_path, episode_number, size_bytes
         FROM episode_files
         WHERE subscription_id = ? AND status = 'renamed'
         ORDER BY id DESC`
      )
      .all(subscriptionId) as Array<{
        id: number;
        original_path: string;
        final_path: string | null;
        episode_number: number | null;
        size_bytes: number | null;
      }>;
    const existingByFinalPath = new Map(
      existing
        .filter((row) => row.final_path)
        .map((row) => [joinRemotePath(row.final_path), row])
    );
    let imported = 0;
    let updated = 0;

    for (const file of normalizedFiles) {
      if (file.episodeNumber == null) continue;
      const current = existingByFinalPath.get(file.path);
      if (current) {
        if (
          current.episode_number !== file.episodeNumber ||
          current.size_bytes !== file.sizeBytes
        ) {
          sqlite
            .prepare(
              `UPDATE episode_files
               SET episode_number = ?, size_bytes = ?, status = 'renamed',
                   error_message = NULL, updated_at = CURRENT_TIMESTAMP
               WHERE id = ?`
            )
            .run(file.episodeNumber, file.sizeBytes, current.id);
          updated += 1;
        }
        continue;
      }

      sqlite
        .prepare(
          `INSERT INTO episode_files (
             subscription_id, feed_item_id, episode_number, original_path,
             final_path, size_bytes, status, error_message
           ) VALUES (?, NULL, ?, ?, ?, ?, 'renamed', NULL)
           ON CONFLICT(subscription_id, original_path) DO UPDATE SET
             episode_number = excluded.episode_number,
             final_path = excluded.final_path,
             size_bytes = excluded.size_bytes,
             status = 'renamed',
             error_message = NULL,
             updated_at = CURRENT_TIMESTAMP`
        )
        .run(
          subscriptionId,
          file.episodeNumber,
          file.path,
          file.path,
          file.sizeBytes
        );
      imported += 1;
    }

    let removed = 0;
    for (const row of existing) {
      if (!row.final_path) continue;
      const finalPath = joinRemotePath(row.final_path);
      if (
        isRemotePathWithin(finalPath, normalizedRoot) &&
        !seenPaths.has(finalPath)
      ) {
        sqlite.prepare("DELETE FROM episode_files WHERE id = ?").run(row.id);
        removed += 1;
      }
    }

    return { imported, updated, removed };
  });

  return transaction();
}

export function getJobForFeedItem(feedItemId: number) {
  const row = getDb()
    .select()
    .from(downloadJobs)
    .where(eq(downloadJobs.feedItemId, feedItemId))
    .get();
  return row ? mapJob(row as unknown as Record<string, unknown>) : null;
}

export function getJob(id: number) {
  const row = getDb().select().from(downloadJobs).where(eq(downloadJobs.id, id)).get();
  return row ? mapJob(row as unknown as Record<string, unknown>) : null;
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
    .insert(downloadJobs)
    .values({
      subscriptionId: params.subscriptionId,
      feedItemId: params.feedItemId,
      status: params.status,
      sourceUrl: params.sourceUrl ?? null,
      targetPath: params.targetPath ?? null,
      openlistTaskId: params.openlistTaskId ?? null,
      errorMessage: params.errorMessage ?? null,
      attempts: 0
    })
    .onConflictDoUpdate({
      target: downloadJobs.feedItemId,
      set: {
        status: params.status,
        sourceUrl: params.sourceUrl
          ? params.sourceUrl
          : sql`${downloadJobs.sourceUrl}`,
        targetPath: params.targetPath
          ? params.targetPath
          : sql`${downloadJobs.targetPath}`,
        openlistTaskId: params.openlistTaskId
          ? params.openlistTaskId
          : sql`${downloadJobs.openlistTaskId}`,
        errorMessage: params.errorMessage ?? null,
        updatedAt: sql`CURRENT_TIMESTAMP`
      }
    })
    .run();
  return getJobForFeedItem(params.feedItemId);
}

export function markJobAttempt(
  jobId: number,
  fields: Partial<DownloadJob>,
  options: { incrementAttempt?: boolean } = {}
) {
  getDb()
    .update(downloadJobs)
    .set({
      status: fields.status ? fields.status : sql`${downloadJobs.status}`,
      // Allow explicitly clearing openlistTaskId with null; only skip when undefined.
      openlistTaskId:
        fields.openlistTaskId !== undefined
          ? fields.openlistTaskId
          : sql`${downloadJobs.openlistTaskId}`,
      infoHash:
        fields.infoHash !== undefined
          ? fields.infoHash
          : sql`${downloadJobs.infoHash}`,
      offlineName:
        fields.offlineName !== undefined
          ? fields.offlineName
          : sql`${downloadJobs.offlineName}`,
      targetPath:
        fields.targetPath !== undefined && fields.targetPath !== null
          ? fields.targetPath
          : sql`${downloadJobs.targetPath}`,
      errorMessage:
        fields.errorMessage !== undefined
          ? fields.errorMessage
          : sql`${downloadJobs.errorMessage}`,
      scanMissCount:
        fields.scanMissCount !== undefined
          ? fields.scanMissCount
          : sql`${downloadJobs.scanMissCount}`,
      attempts:
        options.incrementAttempt === false
          ? sql`${downloadJobs.attempts}`
          : sql`${downloadJobs.attempts} + 1`,
      updatedAt: sql`CURRENT_TIMESTAMP`
    })
    .where(eq(downloadJobs.id, jobId))
    .run();
}

export function listJobs(limit = 200) {
  return getDb()
    .select()
    .from(downloadJobs)
    .orderBy(desc(downloadJobs.updatedAt))
    .limit(limit)
    .all()
    .map((row) => mapJob(row as unknown as Record<string, unknown>));
}

export function listJobsByStatus(statuses: JobStatus[]) {
  if (statuses.length === 0) return [];
  return getDb()
    .select()
    .from(downloadJobs)
    .where(inArray(downloadJobs.status, statuses))
    .orderBy(asc(downloadJobs.updatedAt))
    .all()
    .map((row) => mapJob(row as unknown as Record<string, unknown>));
}

export function updateJobStatus(
  jobId: number,
  status: JobStatus,
  fields?: {
    openlistTaskId?: string | null;
    clearOpenlistTaskId?: boolean;
    infoHash?: string | null;
    offlineName?: string | null;
    targetPath?: string | null;
    errorMessage?: string | null;
    scanMissCount?: number;
  }
) {
  getDb()
    .update(downloadJobs)
    .set({
      status,
      openlistTaskId: fields?.clearOpenlistTaskId
        ? null
        : fields?.openlistTaskId
          ? fields.openlistTaskId
          : sql`${downloadJobs.openlistTaskId}`,
      infoHash:
        fields?.infoHash !== undefined
          ? fields.infoHash
          : sql`${downloadJobs.infoHash}`,
      offlineName:
        fields?.offlineName !== undefined
          ? fields.offlineName
          : sql`${downloadJobs.offlineName}`,
      targetPath:
        fields?.targetPath !== undefined && fields?.targetPath !== null
          ? fields.targetPath
          : sql`${downloadJobs.targetPath}`,
      errorMessage: fields?.errorMessage ?? null,
      scanMissCount:
        fields?.scanMissCount !== undefined
          ? fields.scanMissCount
          : sql`${downloadJobs.scanMissCount}`,
      updatedAt: sql`CURRENT_TIMESTAMP`
    })
    .where(eq(downloadJobs.id, jobId))
    .run();
}

/** One-shot: old "Bound… waiting for file" rows stuck as downloading. */
export function migrateBoundDownloadingToWaitingFile() {
  return getSqlite()
    .prepare(
      `UPDATE download_jobs SET
        status = 'waiting_file',
        updated_at = CURRENT_TIMESTAMP
       WHERE status = 'downloading'
         AND error_message IS NOT NULL
         AND (
           error_message LIKE '%Bound existing OpenList offline task%'
           OR error_message LIKE '%already in OpenList offline list%'
           OR error_message LIKE '%OpenList offline task succeeded%'
           OR error_message LIKE '%left active queue; waiting for file%'
         )`
    )
    .run().changes;
}

/** Another in-flight job already bound to this OpenList offline task. */
export function findJobByOpenlistTaskId(
  openlistTaskId: string,
  excludeJobId?: number
) {
  const rows = getDb()
    .select()
    .from(downloadJobs)
    .where(eq(downloadJobs.openlistTaskId, openlistTaskId))
    .all()
    .map((row) => mapJob(row as unknown as Record<string, unknown>));
  return (
    rows.find(
      (job) =>
        job.id !== excludeJobId &&
        ["queued", "downloading", "waiting_file", "ready_to_rename"].includes(
          job.status
        )
    ) ?? null
  );
}

/**
 * Atomically bind openlist_task_id to a job if no other in-flight job holds it.
 * Uses a transaction + conditional update to close check-then-act races.
 */
export function tryClaimOpenlistTaskIdForJob(
  jobId: number,
  taskId: string,
  fields?: {
    status?: JobStatus;
    infoHash?: string | null;
    offlineName?: string | null;
    errorMessage?: string | null;
    scanMissCount?: number;
  }
): boolean {
  const sqlite = getSqlite();
  return sqlite.transaction(() => {
    // Any non-terminal job already holding this task blocks the claim.
    const owner = sqlite
      .prepare(
        `SELECT id FROM download_jobs
         WHERE openlist_task_id = ?
           AND id != ?
           AND status NOT IN ('completed', 'skipped')
         LIMIT 1`
      )
      .get(taskId, jobId) as { id: number } | undefined;
    if (owner) return false;

    const result = sqlite
      .prepare(
        `UPDATE download_jobs SET
          openlist_task_id = ?,
          status = COALESCE(?, status),
          info_hash = COALESCE(?, info_hash),
          offline_name = COALESCE(?, offline_name),
          error_message = COALESCE(?, error_message),
          scan_miss_count = COALESCE(?, scan_miss_count),
          updated_at = CURRENT_TIMESTAMP
         WHERE id = ?
           AND (openlist_task_id IS NULL OR openlist_task_id = ? OR openlist_task_id = '')`
      )
      .run(
        taskId,
        fields?.status ?? null,
        fields?.infoHash ?? null,
        fields?.offlineName ?? null,
        fields?.errorMessage ?? null,
        fields?.scanMissCount ?? null,
        jobId,
        taskId
      );
    return result.changes > 0;
  })();
}

/**
 * Atomically claim a queued job for offline submit.
 * Returns false if another worker already took it (or status changed).
 */
export function claimQueuedJob(jobId: number) {
  const result = getSqlite()
    .prepare(
      `UPDATE download_jobs SET
        status = 'downloading',
        attempts = attempts + 1,
        error_message = CASE
          WHEN error_message IS NULL OR error_message = '' THEN 'Submitting offline download'
          ELSE error_message
        END,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND status = 'queued'`
    )
    .run(jobId);
  return result.changes > 0;
}

export function touchDownloadingJobActivity(jobId: number) {
  return (
    getSqlite()
      .prepare(
        `UPDATE download_jobs SET updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status IN ('downloading', 'waiting_file')`
      )
      .run(jobId).changes > 0
  );
}

/**
 * Time out stuck download / file-wait / rename jobs.
 * - downloading: OpenList still pulling
 * - waiting_file: offline task bound/done, media not adopted yet (longer grace)
 * - ready_to_rename: mid-organize
 */
export function failStaleDownloadingJobs(
  maxAgeSeconds?: number,
  errorMessage = "Download timed out waiting for OpenList / 115 completion",
  excludedJobIds: number[] = []
) {
  const ageSeconds =
    maxAgeSeconds ??
    Math.max(1, getSystemSettings().downloadTimeoutMinutes) * 60;
  const waitFileSeconds = Math.max(ageSeconds, ageSeconds * 2);
  const excludedIds = [...new Set(excludedJobIds.filter(Number.isInteger))];
  const exclusionSql = excludedIds.length
    ? ` AND id NOT IN (${excludedIds.map(() => "?").join(", ")})`
    : "";

  const sqlite = getSqlite();
  let changes = 0;

  changes += sqlite
    .prepare(
      `UPDATE download_jobs SET
        status = 'failed',
        openlist_task_id = NULL,
        error_message = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE status = 'downloading'
         AND datetime(updated_at) < datetime('now', ?)
         ${exclusionSql}`
    )
    .run(errorMessage, `-${Math.max(60, ageSeconds)} seconds`, ...excludedIds)
    .changes;

  changes += sqlite
    .prepare(
      `UPDATE download_jobs SET
        status = 'failed',
        openlist_task_id = NULL,
        error_message = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE status = 'waiting_file'
         AND datetime(updated_at) < datetime('now', ?)
         ${exclusionSql}`
    )
    .run(
      "Timed out waiting for media file after offline task completed",
      `-${Math.max(60, waitFileSeconds)} seconds`,
      ...excludedIds
    ).changes;

  changes += sqlite
    .prepare(
      `UPDATE download_jobs SET
        status = 'failed',
        openlist_task_id = NULL,
        error_message = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE status = 'ready_to_rename'
         AND datetime(updated_at) < datetime('now', ?)
         ${exclusionSql}`
    )
    .run(
      "Rename timed out waiting for OpenList file organization",
      `-${Math.max(60, ageSeconds)} seconds`,
      ...excludedIds
    ).changes;

  return changes;
}

export function requeueFailedDownloadJobs() {
  const systemSettings = getSystemSettings();
  if (!systemSettings.downloadAutoRetryEnabled) return 0;

  const maxAttempts = Math.max(1, systemSettings.downloadAutoRetryMaxAttempts);
  const cooldownMinutes = Math.max(1, systemSettings.downloadAutoRetryCooldownMinutes);

  return getSqlite()
    .prepare(
      `UPDATE download_jobs SET
        status = 'queued',
        openlist_task_id = NULL,
        error_message = CASE
          WHEN error_message IS NULL OR error_message = '' THEN 'Auto-retry scheduled'
          WHEN error_message LIKE '%(auto-retry)%' THEN error_message
          ELSE error_message || ' (auto-retry)'
        END,
        updated_at = CURRENT_TIMESTAMP
       WHERE status = 'failed'
         AND source_url IS NOT NULL
         AND TRIM(source_url) != ''
         AND EXISTS (
           SELECT 1 FROM subscriptions subscription
           WHERE subscription.id = download_jobs.subscription_id
             AND subscription.enabled = 1
         )
         AND attempts < ?
         AND attempts > 0
         AND datetime(updated_at) <= datetime('now', ?)
         AND (
           error_message IS NULL
           OR (
             error_message NOT LIKE '%Job has no source URL%'
             AND error_message NOT LIKE '%Subscription no longer exists%'
             AND error_message NOT LIKE '%Superseded by a newer release%'
             -- OpenList already has this URL; re-submit only produces 10008.
             AND error_message NOT LIKE '%10008%'
             AND error_message NOT LIKE '%任务已存在%'
             AND error_message NOT LIKE '%重复的链接%'
             AND error_message NOT LIKE '%already in OpenList offline%'
             AND error_message NOT LIKE '%already in the offline list%'
           )
         )`
    )
    .run(maxAttempts, `-${cooldownMinutes} minutes`).changes;
}

export function findFeedItemsForSubscription(subscriptionId: number) {
  return getDb()
    .select()
    .from(feedItems)
    .where(eq(feedItems.subscriptionId, subscriptionId))
    .orderBy(desc(feedItems.firstSeenAt), desc(feedItems.id))
    .all()
    .map((row) => mapFeedItem(row as unknown as Record<string, unknown>));
}

export function findMetadataBySubscription(subscriptionId: number) {
  return getDb()
    .select({
      id: releaseMetadata.id,
      feedItemId: releaseMetadata.feedItemId,
      releaseGroup: releaseMetadata.releaseGroup,
      parsedTitle: releaseMetadata.parsedTitle,
      episodeNumber: releaseMetadata.episodeNumber,
      episodeText: releaseMetadata.episodeText,
      releaseRevision: releaseMetadata.releaseRevision,
      resolution: releaseMetadata.resolution,
      subtitleLanguage: releaseMetadata.subtitleLanguage,
      container: releaseMetadata.container,
      tagsJson: releaseMetadata.tagsJson,
      parseConfidence: releaseMetadata.parseConfidence,
      needsReview: releaseMetadata.needsReview
    })
    .from(releaseMetadata)
    .innerJoin(feedItems, eq(feedItems.id, releaseMetadata.feedItemId))
    .where(eq(feedItems.subscriptionId, subscriptionId))
    .orderBy(desc(feedItems.firstSeenAt), desc(feedItems.id))
    .all()
    .map((row) => mapMetadata(row as unknown as Record<string, unknown>))
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
    .insert(episodeFiles)
    .values({
      subscriptionId: input.subscriptionId,
      feedItemId: input.feedItemId ?? null,
      episodeNumber: input.episodeNumber ?? null,
      originalPath: input.originalPath,
      finalPath: input.finalPath ?? null,
      sizeBytes: input.sizeBytes ?? null,
      status: input.status ?? "detected",
      errorMessage: input.errorMessage ?? null
    })
    .onConflictDoUpdate({
      target: [episodeFiles.subscriptionId, episodeFiles.originalPath],
      set: {
        feedItemId: input.feedItemId
          ? input.feedItemId
          : sql`${episodeFiles.feedItemId}`,
        episodeNumber:
          input.episodeNumber != null
            ? input.episodeNumber
            : sql`${episodeFiles.episodeNumber}`,
        finalPath: input.finalPath
          ? input.finalPath
          : sql`${episodeFiles.finalPath}`,
        sizeBytes:
          input.sizeBytes != null
            ? input.sizeBytes
            : sql`${episodeFiles.sizeBytes}`,
        status: input.status ?? "detected",
        errorMessage: input.errorMessage ?? null,
        updatedAt: sql`CURRENT_TIMESTAMP`
      }
    })
    .run();
}

export function getEpisodeFileForFeedItem(feedItemId: number) {
  const row = getDb()
    .select()
    .from(episodeFiles)
    .where(eq(episodeFiles.feedItemId, feedItemId))
    .orderBy(desc(episodeFiles.updatedAt), desc(episodeFiles.id))
    .limit(1)
    .get();
  return row ? mapEpisodeFile(row as unknown as Record<string, unknown>) : null;
}

export function listEpisodeFiles(limit = 200) {
  return getDb()
    .select()
    .from(episodeFiles)
    .orderBy(desc(episodeFiles.updatedAt))
    .limit(limit)
    .all()
    .map((row) => mapEpisodeFile(row as unknown as Record<string, unknown>));
}

export function enqueueWorkerTask(input: {
  type: WorkerTaskType;
  subscriptionId?: number | null;
  payload?: Record<string, unknown>;
}) {
  const subscriptionId = input.subscriptionId ?? null;
  const payloadJson = JSON.stringify(input.payload ?? {});
  const dedupeKey =
    typeof input.payload?.dedupeKey === "string" ? input.payload.dedupeKey : null;

  const active = dedupeKey
    ? getDb()
        .select()
        .from(workerTasks)
        .where(
          and(
            eq(workerTasks.type, input.type),
            eq(workerTasks.payloadJson, payloadJson),
            inArray(workerTasks.status, ["queued", "running"])
          )
        )
        .orderBy(desc(workerTasks.id))
        .limit(1)
        .get()
    : getSqlite()
        .prepare(
          `SELECT * FROM worker_tasks
           WHERE type = ?
             AND COALESCE(subscription_id, 0) = COALESCE(?, 0)
             AND status IN ('queued', 'running')
           ORDER BY id DESC
           LIMIT 1`
        )
        .get(input.type, subscriptionId);

  if (active) {
    return mapWorkerTask(active as unknown as Record<string, unknown>);
  }

  const result = getDb()
    .insert(workerTasks)
    .values({
      type: input.type,
      subscriptionId,
      payloadJson
    })
    .run();

  return getWorkerTask(Number(result.lastInsertRowid));
}

export function getWorkerTask(id: number) {
  const row = getDb().select().from(workerTasks).where(eq(workerTasks.id, id)).get();
  return row ? mapWorkerTask(row as unknown as Record<string, unknown>) : null;
}

export function listWorkerTasksByStatus(statuses: WorkerTaskStatus[]) {
  if (statuses.length === 0) return [];
  return getDb()
    .select()
    .from(workerTasks)
    .where(inArray(workerTasks.status, statuses))
    .orderBy(asc(workerTasks.createdAt), asc(workerTasks.id))
    .all()
    .map((row) => mapWorkerTask(row as unknown as Record<string, unknown>));
}

export function listWorkerTasks(limit = 200) {
  return getDb()
    .select()
    .from(workerTasks)
    .orderBy(desc(workerTasks.updatedAt), desc(workerTasks.id))
    .limit(limit)
    .all()
    .map((row) => mapWorkerTask(row as unknown as Record<string, unknown>));
}

export function claimNextWorkerTask() {
  return getDb().transaction((tx) => {
    const row = tx
      .select()
      .from(workerTasks)
      .where(eq(workerTasks.status, "queued"))
      .orderBy(asc(workerTasks.createdAt), asc(workerTasks.id))
      .limit(1)
      .get();
    if (!row) return null;

    const result = tx
      .update(workerTasks)
      .set({
        status: "running",
        attempts: sql`${workerTasks.attempts} + 1`,
        startedAt: sql`CURRENT_TIMESTAMP`,
        updatedAt: sql`CURRENT_TIMESTAMP`
      })
      .where(and(eq(workerTasks.id, row.id), eq(workerTasks.status, "queued")))
      .run();
    if (result.changes === 0) return null;

    const claimed = tx
      .select()
      .from(workerTasks)
      .where(eq(workerTasks.id, row.id))
      .get();
    return claimed
      ? mapWorkerTask(claimed as unknown as Record<string, unknown>)
      : null;
  });
}

export function completeWorkerTask(
  id: number,
  result?: Record<string, unknown>
) {
  const existing = getWorkerTask(id);
  const payload = mergeTaskPayload(existing?.payloadJson, {
    result: result ?? { ok: true },
    finishedAt: new Date().toISOString()
  });

  getDb()
    .update(workerTasks)
    .set({
      status: "completed",
      errorMessage: null,
      payloadJson: payload,
      finishedAt: sql`CURRENT_TIMESTAMP`,
      updatedAt: sql`CURRENT_TIMESTAMP`
    })
    .where(eq(workerTasks.id, id))
    .run();
}

export function failWorkerTask(
  id: number,
  errorMessage: string,
  result?: Record<string, unknown>
) {
  const existing = getWorkerTask(id);
  const payload = mergeTaskPayload(existing?.payloadJson, {
    result: result ?? { ok: false },
    error: errorMessage,
    finishedAt: new Date().toISOString()
  });

  getDb()
    .update(workerTasks)
    .set({
      status: "failed",
      errorMessage,
      payloadJson: payload,
      finishedAt: sql`CURRENT_TIMESTAMP`,
      updatedAt: sql`CURRENT_TIMESTAMP`
    })
    .where(eq(workerTasks.id, id))
    .run();
}

export function requeueStaleWorkerTasks(maxRunningSeconds = 1800) {
  return getSqlite()
    .prepare(
      `UPDATE worker_tasks SET
        status = 'queued',
        error_message = 'Previous run timed out',
        finished_at = NULL,
        updated_at = CURRENT_TIMESTAMP
       WHERE status = 'running'
         AND datetime(updated_at) < datetime('now', ?)`
    )
    .run(`-${maxRunningSeconds} seconds`).changes;
}

export function requeueFailedWorkerTasks(
  maxAttempts = 3,
  minAgeSeconds = 60
) {
  return getSqlite()
    .prepare(
      `UPDATE worker_tasks SET
        status = 'queued',
        error_message = CASE
          WHEN error_message IS NULL OR error_message = '' THEN 'Auto-retry scheduled'
          WHEN error_message LIKE '%(auto-retry)%' THEN error_message
          ELSE error_message || ' (auto-retry)'
        END,
        finished_at = NULL,
        updated_at = CURRENT_TIMESTAMP
       WHERE status = 'failed'
         AND attempts < ?
         AND datetime(COALESCE(finished_at, updated_at)) <= datetime('now', ?)
         AND NOT EXISTS (
           SELECT 1 FROM worker_tasks active
           WHERE active.type = worker_tasks.type
             AND COALESCE(active.subscription_id, 0) = COALESCE(worker_tasks.subscription_id, 0)
             AND active.status IN ('queued', 'running')
             AND active.id != worker_tasks.id
         )`
    )
    .run(maxAttempts, `-${Math.max(5, minAgeSeconds)} seconds`).changes;
}

export function resetRuntimeData() {
  return getDb().transaction((tx) => {
    const workerTasksCount = tx.delete(workerTasks).run().changes;
    const downloadJobsCount = tx.delete(downloadJobs).run().changes;
    const episodeFilesCount = tx.delete(episodeFiles).run().changes;
    const releaseMetadataCount = tx.delete(releaseMetadata).run().changes;
    const feedItemsCount = tx.delete(feedItems).run().changes;
    const subscriptionsTouched = tx
      .update(subscriptions)
      .set({ lastPolledAt: null })
      .run().changes;

    return {
      downloadJobs: downloadJobsCount,
      episodeFiles: episodeFilesCount,
      releaseMetadata: releaseMetadataCount,
      feedItems: feedItemsCount,
      workerTasks: workerTasksCount,
      subscriptionsTouched
    };
  });
}

export interface DashboardQueryInput {
  episodeSubscriptionId?: string;
  episodeSubscriptionState?: string;
  episodeSeason?: string;
  episodeStatus?: string;
  episodePage?: string;
  episodePageSize?: string;
}

export function getDashboardData(input: DashboardQueryInput = {}): DashboardData {
  const allSubscriptions = listSubscriptions();
  const episodePage = getDashboardEpisodePage(input, allSubscriptions);
  const activeWorkerTasks = listWorkerTasksByStatus(["queued", "running"]);
  const stats = getDashboardStats(allSubscriptions, activeWorkerTasks.length);

  return {
    subscriptions: allSubscriptions,
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
  allSubscriptions = listSubscriptions()
): DashboardEpisodePage {
  return queryDashboardEpisodePage(normalizeEpisodeQuery(input), allSubscriptions);
}

function normalizeEpisodeQuery(input: DashboardQueryInput) {
  return {
    subscriptionId: positiveNumberOrNull(input.episodeSubscriptionId),
    subscriptionState: normalizeSubscriptionState(input.episodeSubscriptionState),
    season: positiveNumberOrNull(input.episodeSeason),
    status: normalizeEpisodeStatus(input.episodeStatus),
    page: Math.max(1, Number(input.episodePage) || 1),
    pageSize: normalizeEpisodePageSize(input.episodePageSize)
  };
}

function normalizeSubscriptionState(
  value: string | undefined
): SubscriptionStateFilter {
  return value === "archived" ? "archived" : "active";
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

function getDashboardStats(
  allSubscriptions: Subscription[],
  activeWorkerTaskCount: number
): DashboardData["stats"] {
  const queuedJobs = getDb()
    .select({ count: count() })
    .from(downloadJobs)
    .where(
      inArray(downloadJobs.status, [
        "queued",
        "downloading",
        "waiting_file",
        "ready_to_rename"
      ])
    )
    .get();
  const needsReviewJobs = getDb()
    .select({ count: count() })
    .from(downloadJobs)
    .where(eq(downloadJobs.status, "needs_review"))
    .get();
  const completedJobs = getDb()
    .select({ count: count() })
    .from(downloadJobs)
    .where(eq(downloadJobs.status, "completed"))
    .get();

  return {
    activeSubscriptions: allSubscriptions.filter((item) => item.enabled).length,
    queuedJobs: Number(queuedJobs?.count ?? 0),
    workerTasks: activeWorkerTaskCount,
    needsReview: Number(needsReviewJobs?.count ?? 0),
    completedJobs: Number(completedJobs?.count ?? 0)
  };
}

function mergeTaskPayload(
  existingJson: string | undefined,
  patch: Record<string, unknown>
) {
  let base: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(existingJson || "{}") as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      base = parsed as Record<string, unknown>;
    }
  } catch {
    base = {};
  }
  return JSON.stringify({ ...base, ...patch });
}

function normalizeSubscriptionInput(input: SubscriptionInput) {
  return {
    name: input.name.trim(),
    rssUrl: input.rssUrl.trim(),
    enabled: input.enabled === false ? 0 : 1,
    autoDownload: input.autoDownload === false ? 0 : 1,
    seasonNumber: input.seasonNumber ?? 1,
    destinationRoot:
      input.destinationRoot?.trim() || defaultSystemSettings.mediaLibraryRoot,
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
    workerIntervalSeconds: Math.max(30, Number(input.workerIntervalSeconds || 300)),
    downloadTimeoutMinutes: Math.min(
      24 * 60,
      Math.max(1, Number(input.downloadTimeoutMinutes || 30))
    ),
    downloadAutoRetryEnabled: Boolean(input.downloadAutoRetryEnabled),
    downloadAutoRetryMaxAttempts: Math.min(
      20,
      Math.max(1, Number(input.downloadAutoRetryMaxAttempts || 3))
    ),
    downloadAutoRetryCooldownMinutes: Math.min(
      24 * 60,
      Math.max(1, Number(input.downloadAutoRetryCooldownMinutes || 10))
    )
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
