import type {
  DownloadJob,
  EpisodeFile,
  FeedItem,
  FilterRule,
  ReleaseMetadata,
  Subscription,
  WorkerTask
} from "@/lib/db/types";

/** Map Drizzle / row objects (camelCase or snake_case) into domain models. */

export function mapSubscription(row: Record<string, unknown>): Subscription {
  return {
    id: Number(pick(row, "id")),
    name: String(pick(row, "name")),
    rssUrl: String(pick(row, "rssUrl", "rss_url")),
    enabled: Boolean(pick(row, "enabled")),
    autoDownload: Boolean(pick(row, "autoDownload", "auto_download")),
    seasonNumber: Number(pick(row, "seasonNumber", "season_number")),
    destinationRoot: String(pick(row, "destinationRoot", "destination_root")),
    incomingPath: nullableString(pick(row, "incomingPath", "incoming_path")),
    tmdbSeriesId: nullableNumber(pick(row, "tmdbSeriesId", "tmdb_series_id")),
    lastPolledAt: nullableString(pick(row, "lastPolledAt", "last_polled_at")),
    createdAt: String(pick(row, "createdAt", "created_at")),
    updatedAt: String(pick(row, "updatedAt", "updated_at"))
  };
}

export function mapRule(row: Record<string, unknown>): FilterRule {
  return {
    id: Number(pick(row, "id")),
    subscriptionId: Number(pick(row, "subscriptionId", "subscription_id")),
    type: pick(row, "type") as FilterRule["type"],
    value: String(pick(row, "value")),
    enabled: Boolean(pick(row, "enabled")),
    createdAt: String(pick(row, "createdAt", "created_at"))
  };
}

export function mapFeedItem(row: Record<string, unknown>): FeedItem {
  return {
    id: Number(pick(row, "id")),
    subscriptionId: Number(pick(row, "subscriptionId", "subscription_id")),
    guid: String(pick(row, "guid")),
    rssGuid: nullableString(pick(row, "rssGuid", "rss_guid")),
    title: String(pick(row, "title")),
    link: nullableString(pick(row, "link")),
    downloadUrl: nullableString(pick(row, "downloadUrl", "download_url")),
    publishedAt: nullableString(pick(row, "publishedAt", "published_at")),
    rawXmlJson: nullableString(pick(row, "rawXmlJson", "raw_xml_json")),
    firstSeenAt: String(pick(row, "firstSeenAt", "first_seen_at"))
  };
}

export function mapMetadata(
  row: Record<string, unknown> | undefined | null
): ReleaseMetadata | null {
  if (!row || pick(row, "id") == null) return null;
  return {
    id: Number(pick(row, "id")),
    feedItemId: Number(pick(row, "feedItemId", "feed_item_id")),
    releaseGroup: nullableString(pick(row, "releaseGroup", "release_group")),
    parsedTitle: nullableString(pick(row, "parsedTitle", "parsed_title")),
    episodeNumber: nullableNumber(pick(row, "episodeNumber", "episode_number")),
    episodeText: nullableString(pick(row, "episodeText", "episode_text")),
    releaseRevision: nullableNumber(pick(row, "releaseRevision", "release_revision")) ?? 1,
    resolution: nullableString(pick(row, "resolution")),
    subtitleLanguage: nullableString(pick(row, "subtitleLanguage", "subtitle_language")),
    container: nullableString(pick(row, "container")),
    tags: parseJsonArray(pick(row, "tagsJson", "tags_json")),
    parseConfidence: Number(pick(row, "parseConfidence", "parse_confidence") ?? 0),
    needsReview: Boolean(pick(row, "needsReview", "needs_review"))
  };
}

export function mapJob(row: Record<string, unknown>): DownloadJob {
  return {
    id: Number(pick(row, "id")),
    subscriptionId: Number(pick(row, "subscriptionId", "subscription_id")),
    feedItemId: Number(pick(row, "feedItemId", "feed_item_id")),
    status: pick(row, "status") as DownloadJob["status"],
    openlistTaskId: nullableString(pick(row, "openlistTaskId", "openlist_task_id")),
    forceDownload: Boolean(pick(row, "forceDownload", "force_download")),
    infoHash: nullableString(pick(row, "infoHash", "info_hash")),
    offlineName: nullableString(pick(row, "offlineName", "offline_name")),
    sourceUrl: nullableString(pick(row, "sourceUrl", "source_url")),
    targetPath: nullableString(pick(row, "targetPath", "target_path")),
    errorMessage: nullableString(pick(row, "errorMessage", "error_message")),
    scanMissCount: Number(pick(row, "scanMissCount", "scan_miss_count") ?? 0),
    attempts: Number(pick(row, "attempts") ?? 0),
    createdAt: String(pick(row, "createdAt", "created_at")),
    updatedAt: String(pick(row, "updatedAt", "updated_at"))
  };
}

export function mapEpisodeFile(row: Record<string, unknown>): EpisodeFile {
  return {
    id: Number(pick(row, "id")),
    subscriptionId: Number(pick(row, "subscriptionId", "subscription_id")),
    feedItemId: nullableNumber(pick(row, "feedItemId", "feed_item_id")),
    episodeNumber: nullableNumber(pick(row, "episodeNumber", "episode_number")),
    originalPath: String(pick(row, "originalPath", "original_path")),
    finalPath: nullableString(pick(row, "finalPath", "final_path")),
    sizeBytes: nullableNumber(pick(row, "sizeBytes", "size_bytes")),
    status: pick(row, "status") as EpisodeFile["status"],
    errorMessage: nullableString(pick(row, "errorMessage", "error_message")),
    createdAt: String(pick(row, "createdAt", "created_at")),
    updatedAt: String(pick(row, "updatedAt", "updated_at"))
  };
}

export function mapWorkerTask(row: Record<string, unknown>): WorkerTask {
  return {
    id: Number(pick(row, "id")),
    type: pick(row, "type") as WorkerTask["type"],
    subscriptionId: nullableNumber(pick(row, "subscriptionId", "subscription_id")),
    status: pick(row, "status") as WorkerTask["status"],
    phase: nullableString(pick(row, "phase")) as WorkerTask["phase"],
    phaseDetail: nullableString(pick(row, "phaseDetail", "phase_detail")),
    progressCurrent: nullableNumber(
      pick(row, "progressCurrent", "progress_current")
    ),
    progressTotal: nullableNumber(pick(row, "progressTotal", "progress_total")),
    payloadJson: String(pick(row, "payloadJson", "payload_json") ?? "{}"),
    errorMessage: nullableString(pick(row, "errorMessage", "error_message")),
    attempts: Number(pick(row, "attempts") ?? 0),
    createdAt: String(pick(row, "createdAt", "created_at")),
    startedAt: nullableString(pick(row, "startedAt", "started_at")),
    finishedAt: nullableString(pick(row, "finishedAt", "finished_at")),
    updatedAt: String(pick(row, "updatedAt", "updated_at"))
  };
}

function pick(row: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    if (key in row && row[key] !== undefined) return row[key];
  }
  return undefined;
}

function nullableString(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseJsonArray(value: unknown) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
