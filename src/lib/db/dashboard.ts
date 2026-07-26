import { getSqlite } from "@/lib/db/client";
import {
  mapEpisodeFile,
  mapFeedItem,
  mapJob,
  mapMetadata
} from "@/lib/db/mappers";
import type {
  DashboardEpisodePage,
  DashboardEpisodeRow,
  EpisodeStatusFilter,
  SubscriptionStateFilter,
  Subscription
} from "@/lib/db/types";

export interface EpisodePageQuery {
  subscriptionId: number | null;
  season: number | null;
  status: EpisodeStatusFilter;
  subscriptionState: SubscriptionStateFilter;
  page: number;
  pageSize: number;
}

/**
 * Dashboard episode page via SQL: filter + preferred-variant dedupe + status + LIMIT/OFFSET.
 * Avoids loading the full feed history into Node for pagination.
 */
export function queryDashboardEpisodePage(
  query: EpisodePageQuery,
  subscriptions: Subscription[]
): DashboardEpisodePage {
  const scopedSubscriptions = subscriptions.filter(
    (subscription) =>
      subscription.enabled === (query.subscriptionState === "active")
  );
  const subscriptionOptions = scopedSubscriptions.map((subscription) => ({
    id: subscription.id,
    name: subscription.name,
    seasonNumber: subscription.seasonNumber
  }));
  const validSubscriptionId = subscriptionOptions.some(
    (option) => option.id === query.subscriptionId
  )
    ? query.subscriptionId
    : subscriptionOptions.length === 1
      ? subscriptionOptions[0].id
      : null;
  const seasonOptions = Array.from(
    new Set(
      scopedSubscriptions
        .filter(
          (subscription) =>
            validSubscriptionId == null || subscription.id === validSubscriptionId
        )
        .map((subscription) => subscription.seasonNumber)
    )
  ).sort((left, right) => left - right);
  const validSeason =
    query.season != null && seasonOptions.includes(query.season)
      ? query.season
      : seasonOptions.length === 1
        ? seasonOptions[0]
        : null;

  const bind = {
    subscriptionId: validSubscriptionId,
    season: validSeason,
    subscriptionEnabled: query.subscriptionState === "active" ? 1 : 0
  };

  const counts = {
    all: countEpisodes(bind, "all"),
    active: countEpisodes(bind, "active"),
    completed: countEpisodes(bind, "completed"),
    failed: countEpisodes(bind, "failed"),
    waiting: countEpisodes(bind, "waiting")
  };

  const total = counts[query.status === "all" ? "all" : query.status];
  const pageCount = Math.max(1, Math.ceil(total / query.pageSize));
  const page = Math.min(query.page, pageCount);
  const offset = (page - 1) * query.pageSize;

  const rows = listEpisodeRows(bind, query.status, query.pageSize, offset);

  return {
    rows,
    total,
    page,
    pageSize: query.pageSize,
    pageCount,
    filters: {
      subscriptionId: validSubscriptionId,
      season: validSeason,
      status: query.status,
      subscriptionState: query.subscriptionState
    },
    counts,
    subscriptionCounts: {
      active: subscriptions.filter((subscription) => subscription.enabled).length,
      archived: subscriptions.filter((subscription) => !subscription.enabled).length
    },
    subscriptionOptions,
    manualSubscriptionOptions: subscriptions
      .filter((subscription) => subscription.enabled)
      .map((subscription) => ({
        id: subscription.id,
        name: subscription.name,
        seasonNumber: subscription.seasonNumber
      })),
    seasonOptions
  };
}

function countEpisodes(
  bind: {
    subscriptionId: number | null;
    season: number | null;
    subscriptionEnabled: number;
  },
  status: EpisodeStatusFilter
) {
  const sql = `
    SELECT COUNT(*) AS count
    FROM (${preferredEpisodeSql()}) AS preferred
    WHERE ${statusSql(status)}
  `;
  const row = getSqlite().prepare(sql).get(bind) as { count: number };
  return Number(row.count);
}

function listEpisodeRows(
  bind: {
    subscriptionId: number | null;
    season: number | null;
    subscriptionEnabled: number;
  },
  status: EpisodeStatusFilter,
  limit: number,
  offset: number
): DashboardEpisodeRow[] {
  const sql = `
    SELECT *
    FROM (${preferredEpisodeSql()}) AS preferred
    WHERE ${statusSql(status)}
    ORDER BY datetime(row_updated_at) DESC, feed_id DESC
    LIMIT @limit OFFSET @offset
  `;
  const records = getSqlite()
    .prepare(sql)
    .all({ ...bind, limit, offset }) as Array<Record<string, unknown>>;

  return records.map(mapDashboardRow);
}

/**
 * Preferred release variants only (highest revision per group/resolution/language),
 * plus all items without a parsed episode number. Applies subscription rule filters in SQL.
 */
function preferredEpisodeSql() {
  return `
    WITH joined AS (
      SELECT
        f.id AS feed_id,
        f.subscription_id,
        f.guid,
        f.rss_guid,
        f.title,
        f.link,
        f.download_url,
        f.published_at,
        f.raw_xml_json,
        f.first_seen_at,
        s.name AS subscription_name,
        s.season_number,
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
        COALESCE(ef_feed.updated_at, ef_episode.updated_at) AS file_updated_at,
        COALESCE(
          NULLIF(j.updated_at, ''),
          NULLIF(ef_feed.updated_at, ''),
          NULLIF(ef_episode.updated_at, ''),
          NULLIF(f.published_at, ''),
          f.first_seen_at
        ) AS row_updated_at
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
        WHERE subscription_id = f.subscription_id
          AND episode_number = m.episode_number
          AND status = 'renamed'
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
      )
      WHERE (@subscriptionId IS NULL OR f.subscription_id = @subscriptionId)
        AND (@season IS NULL OR s.season_number = @season)
        AND s.enabled = @subscriptionEnabled
        AND ${ruleFilterSql("f", "m")}

      UNION ALL

      SELECT
        NULL AS feed_id,
        ef.subscription_id,
        NULL AS guid,
        NULL AS rss_guid,
        s.name || ' - EP' || printf('%02d', ef.episode_number) AS title,
        NULL AS link,
        NULL AS download_url,
        NULL AS published_at,
        NULL AS raw_xml_json,
        ef.created_at AS first_seen_at,
        s.name AS subscription_name,
        s.season_number,
        NULL AS metadata_id,
        NULL AS metadata_feed_item_id,
        NULL AS release_group,
        NULL AS parsed_title,
        ef.episode_number,
        printf('%02d', ef.episode_number) AS episode_text,
        NULL AS release_revision,
        NULL AS resolution,
        NULL AS subtitle_language,
        NULL AS container,
        NULL AS tags_json,
        NULL AS parse_confidence,
        NULL AS needs_review,
        NULL AS job_id,
        NULL AS job_status,
        NULL AS openlist_task_id,
        NULL AS source_url,
        NULL AS target_path,
        NULL AS error_message,
        NULL AS attempts,
        NULL AS job_created_at,
        NULL AS job_updated_at,
        ef.id AS file_id,
        ef.subscription_id AS file_subscription_id,
        ef.feed_item_id AS file_feed_item_id,
        ef.episode_number AS file_episode_number,
        ef.original_path AS file_original_path,
        ef.final_path AS file_final_path,
        ef.size_bytes AS file_size_bytes,
        ef.status AS file_status,
        ef.error_message AS file_error_message,
        ef.created_at AS file_created_at,
        ef.updated_at AS file_updated_at,
        ef.updated_at AS row_updated_at
      FROM episode_files ef
      JOIN subscriptions s ON s.id = ef.subscription_id
      WHERE ef.status = 'renamed'
        AND ef.episode_number IS NOT NULL
        AND (@subscriptionId IS NULL OR ef.subscription_id = @subscriptionId)
        AND (@season IS NULL OR s.season_number = @season)
        AND s.enabled = @subscriptionEnabled
        AND NOT EXISTS (
          SELECT 1
          FROM feed_items f2
          JOIN release_metadata m2 ON m2.feed_item_id = f2.id
          WHERE f2.subscription_id = ef.subscription_id
            AND m2.episode_number = ef.episode_number
            AND ${ruleFilterSql("f2", "m2")}
        )
    ),
    ranked AS (
      SELECT
        joined.*,
        CASE
          WHEN joined.episode_number IS NULL THEN 1
          ELSE ROW_NUMBER() OVER (
            PARTITION BY
              joined.subscription_id,
              joined.season_number,
              joined.episode_number,
              lower(trim(COALESCE(joined.release_group, ''))),
              lower(trim(COALESCE(joined.resolution, ''))),
              lower(trim(COALESCE(joined.subtitle_language, '')))
            ORDER BY
              COALESCE(joined.release_revision, 1) DESC,
              datetime(joined.row_updated_at) DESC,
              joined.feed_id DESC
          )
        END AS variant_rank
      FROM joined
    )
    SELECT *
    FROM ranked
    WHERE episode_number IS NULL OR variant_rank = 1
  `;
}

/** SQL equivalent of evaluateRules() for enabled subscription rules. */
function ruleFilterSql(feedAlias: string, metaAlias: string) {
  const haystack = `lower(
    COALESCE(${feedAlias}.title, '') || ' ' ||
    COALESCE(${metaAlias}.release_group, '') || ' ' ||
    COALESCE(${metaAlias}.parsed_title, '') || ' ' ||
    COALESCE(${metaAlias}.resolution, '') || ' ' ||
    COALESCE(${metaAlias}.subtitle_language, '') || ' ' ||
    COALESCE(${metaAlias}.tags_json, '')
  )`;

  return `
    (
      -- group_allow
      NOT EXISTS (
        SELECT 1 FROM filter_rules r
        WHERE r.subscription_id = ${feedAlias}.subscription_id
          AND r.enabled = 1 AND r.type = 'group_allow'
      )
      OR EXISTS (
        SELECT 1 FROM filter_rules r
        WHERE r.subscription_id = ${feedAlias}.subscription_id
          AND r.enabled = 1 AND r.type = 'group_allow'
          AND lower(trim(r.value)) = lower(trim(COALESCE(${metaAlias}.release_group, '')))
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM filter_rules r
      WHERE r.subscription_id = ${feedAlias}.subscription_id
        AND r.enabled = 1 AND r.type = 'group_block'
        AND lower(trim(r.value)) = lower(trim(COALESCE(${metaAlias}.release_group, '')))
    )
    AND (
      NOT EXISTS (
        SELECT 1 FROM filter_rules r
        WHERE r.subscription_id = ${feedAlias}.subscription_id
          AND r.enabled = 1 AND r.type = 'resolution_allow'
      )
      OR EXISTS (
        SELECT 1 FROM filter_rules r
        WHERE r.subscription_id = ${feedAlias}.subscription_id
          AND r.enabled = 1 AND r.type = 'resolution_allow'
          AND lower(trim(r.value)) = lower(trim(COALESCE(${metaAlias}.resolution, '')))
      )
    )
    AND (
      NOT EXISTS (
        SELECT 1 FROM filter_rules r
        WHERE r.subscription_id = ${feedAlias}.subscription_id
          AND r.enabled = 1 AND r.type = 'language_allow'
      )
      OR EXISTS (
        SELECT 1 FROM filter_rules r
        WHERE r.subscription_id = ${feedAlias}.subscription_id
          AND r.enabled = 1 AND r.type = 'language_allow'
          AND lower(trim(r.value)) = lower(trim(COALESCE(${metaAlias}.subtitle_language, '')))
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM filter_rules r
      WHERE r.subscription_id = ${feedAlias}.subscription_id
        AND r.enabled = 1 AND r.type = 'keyword_include'
        AND instr(${haystack}, lower(r.value)) = 0
    )
    AND NOT EXISTS (
      SELECT 1 FROM filter_rules r
      WHERE r.subscription_id = ${feedAlias}.subscription_id
        AND r.enabled = 1 AND r.type = 'keyword_exclude'
        AND instr(${haystack}, lower(r.value)) > 0
    )
  `;
}

function statusSql(status: EpisodeStatusFilter) {
  if (status === "all") return "1 = 1";
  if (status === "completed") {
    return `(file_status = 'renamed' OR job_status = 'completed')`;
  }
  if (status === "failed") {
    return `(file_status = 'failed' OR job_status = 'failed')`;
  }
  if (status === "waiting") {
    return `job_status = 'needs_review'`;
  }
  // active
  return `job_status IN ('queued', 'downloading', 'ready_to_rename')`;
}

function mapDashboardRow(record: Record<string, unknown>): DashboardEpisodeRow {
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

  const item =
    record.feed_id == null
      ? null
      : mapFeedItem({
          id: record.feed_id,
          subscription_id: record.subscription_id,
          guid: record.guid,
          rss_guid: record.rss_guid,
          title: record.title,
          link: record.link,
          download_url: record.download_url,
          published_at: record.published_at,
          raw_xml_json: record.raw_xml_json,
          first_seen_at: record.first_seen_at
        });

  const job =
    record.job_id == null
      ? null
      : mapJob({
          id: record.job_id,
          subscription_id: record.subscription_id,
          feed_item_id: record.feed_id,
          status: record.job_status,
          openlist_task_id: record.openlist_task_id,
          source_url: record.source_url,
          target_path: record.target_path,
          error_message: record.error_message,
          attempts: record.attempts,
          created_at: record.job_created_at,
          updated_at: record.job_updated_at
        });

  const file =
    record.file_id == null
      ? null
      : mapEpisodeFile({
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

  return {
    id: item ? `feed:${item.id}` : `file:${file?.id ?? record.file_id}`,
    subscriptionId: Number(record.subscription_id),
    subscriptionName: String(record.subscription_name),
    title: item?.title ?? String(record.title),
    item,
    job,
    metadata,
    files: file ? [file] : [],
    seasonNumber:
      record.season_number == null ? null : Number(record.season_number),
    episodeNumber:
      metadata?.episodeNumber ??
      (record.episode_number == null ? null : Number(record.episode_number)),
    episodeText:
      metadata?.episodeText ??
      (record.episode_text == null ? null : String(record.episode_text)),
    updatedAt:
      record.row_updated_at == null ? null : String(record.row_updated_at)
  };
}
