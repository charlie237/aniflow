import type {
  DownloadJob,
  EpisodeFile,
  FeedItem,
  FilterRule,
  ReleaseMetadata,
  Subscription,
  WorkerTask
} from "@/lib/db/types";

export function mapSubscription(row: Record<string, unknown>): Subscription {
  return {
    id: Number(row.id),
    name: String(row.name),
    rssUrl: String(row.rss_url),
    enabled: Boolean(row.enabled),
    autoDownload: Boolean(row.auto_download),
    seasonNumber: Number(row.season_number),
    destinationRoot: String(row.destination_root),
    incomingPath: nullableString(row.incoming_path),
    tmdbSeriesId: nullableNumber(row.tmdb_series_id),
    lastPolledAt: nullableString(row.last_polled_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function mapRule(row: Record<string, unknown>): FilterRule {
  return {
    id: Number(row.id),
    subscriptionId: Number(row.subscription_id),
    type: row.type as FilterRule["type"],
    value: String(row.value),
    enabled: Boolean(row.enabled),
    createdAt: String(row.created_at)
  };
}

export function mapFeedItem(row: Record<string, unknown>): FeedItem {
  return {
    id: Number(row.id),
    subscriptionId: Number(row.subscription_id),
    guid: String(row.guid),
    rssGuid: nullableString(row.rss_guid),
    title: String(row.title),
    link: nullableString(row.link),
    downloadUrl: nullableString(row.download_url),
    publishedAt: nullableString(row.published_at),
    rawXmlJson: nullableString(row.raw_xml_json),
    firstSeenAt: String(row.first_seen_at)
  };
}

export function mapMetadata(row: Record<string, unknown> | undefined | null): ReleaseMetadata | null {
  if (!row || row.id == null) return null;
  return {
    id: Number(row.id),
    feedItemId: Number(row.feed_item_id),
    releaseGroup: nullableString(row.release_group),
    parsedTitle: nullableString(row.parsed_title),
    episodeNumber: nullableNumber(row.episode_number),
    episodeText: nullableString(row.episode_text),
    releaseRevision: nullableNumber(row.release_revision) ?? 1,
    resolution: nullableString(row.resolution),
    subtitleLanguage: nullableString(row.subtitle_language),
    container: nullableString(row.container),
    tags: parseJsonArray(row.tags_json),
    parseConfidence: Number(row.parse_confidence ?? 0),
    needsReview: Boolean(row.needs_review)
  };
}

export function mapJob(row: Record<string, unknown>): DownloadJob {
  return {
    id: Number(row.id),
    subscriptionId: Number(row.subscription_id),
    feedItemId: Number(row.feed_item_id),
    status: row.status as DownloadJob["status"],
    openlistTaskId: nullableString(row.openlist_task_id),
    sourceUrl: nullableString(row.source_url),
    targetPath: nullableString(row.target_path),
    errorMessage: nullableString(row.error_message),
    attempts: Number(row.attempts ?? 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function mapEpisodeFile(row: Record<string, unknown>): EpisodeFile {
  return {
    id: Number(row.id),
    subscriptionId: Number(row.subscription_id),
    feedItemId: nullableNumber(row.feed_item_id),
    episodeNumber: nullableNumber(row.episode_number),
    originalPath: String(row.original_path),
    finalPath: nullableString(row.final_path),
    sizeBytes: nullableNumber(row.size_bytes),
    status: row.status as EpisodeFile["status"],
    errorMessage: nullableString(row.error_message),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function mapWorkerTask(row: Record<string, unknown>): WorkerTask {
  return {
    id: Number(row.id),
    type: row.type as WorkerTask["type"],
    subscriptionId: nullableNumber(row.subscription_id),
    status: row.status as WorkerTask["status"],
    payloadJson: String(row.payload_json ?? "{}"),
    errorMessage: nullableString(row.error_message),
    attempts: Number(row.attempts ?? 0),
    createdAt: String(row.created_at),
    startedAt: nullableString(row.started_at),
    finishedAt: nullableString(row.finished_at),
    updatedAt: String(row.updated_at)
  };
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
