import { count, eq, inArray } from "drizzle-orm";
import { getDb, getSqlite } from "@/lib/db/client";
import { queryDashboardEpisodePage } from "@/lib/db/dashboard";
import { downloadJobs } from "@/lib/db/schema";
import type {
  DashboardData,
  DashboardEpisodePage,
  EpisodeStatusFilter,
  Subscription,
  SubscriptionStateFilter,
  WeeklyScheduleEntry,
  WorkerTaskCategory
} from "@/lib/db/types";
import { parseToUtcDate } from "@/lib/time";
import {
  listRules,
  listSubscriptions
} from "@/lib/db/repositories/subscription-repository";
import { getWorkerHealth } from "@/lib/db/repositories/system-settings-repository";
import {
  getWorkerTaskPage,
  listWorkerTasksByStatus
} from "@/lib/db/repositories/worker-task-repository";

export interface DashboardQueryInput {
  episodeSubscriptionId?: string;
  episodeSubscriptionState?: string;
  episodeSeason?: string;
  episodeStatus?: string;
  episodePage?: string;
  episodePageSize?: string;
  workerTaskCategory?: string;
  workerTaskPage?: string;
  workerTaskPageSize?: string;
}

export function getDashboardData(input: DashboardQueryInput = {}): DashboardData {
  const allSubscriptions = listSubscriptions();
  const episodePage = getDashboardEpisodePage(input, allSubscriptions);
  const activeWorkerTasks = listWorkerTasksByStatus(["queued", "running"]);
  const stats = getDashboardStats(allSubscriptions, activeWorkerTasks.length);

  return {
    subscriptions: allSubscriptions,
    rules: listRules(),
    workerTaskPage: getDashboardWorkerTaskPage(input),
    episodePage,
    workerHealth: getWorkerHealth(),
    schedule: getWeeklySchedule(allSubscriptions),
    stats
  };
}

export function getDashboardWorkerTaskPage(input: DashboardQueryInput = {}) {
  return getWorkerTaskPage({
    category: normalizeWorkerTaskCategory(input.workerTaskCategory),
    page: Math.max(1, Number(input.workerTaskPage) || 1),
    pageSize: normalizeWorkerTaskPageSize(input.workerTaskPageSize)
  });
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

function normalizeWorkerTaskCategory(
  value: string | undefined
): "all" | WorkerTaskCategory {
  return ["active", "attention", "action", "routine", "other"].includes(
    value ?? ""
  )
    ? (value as WorkerTaskCategory)
    : "all";
}

function normalizeWorkerTaskPageSize(value: string | undefined) {
  const number = Number(value);
  return [10, 20, 50].includes(number) ? number : 10;
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

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

function getWeeklySchedule(
  allSubscriptions: Subscription[]
): WeeklyScheduleEntry[] {
  const activeSubs = allSubscriptions.filter((sub) => sub.enabled);
  if (activeSubs.length === 0) return [];

  const subById = new Map(activeSubs.map((sub) => [sub.id, sub]));
  const rows = getSqlite()
    .prepare(
      `SELECT
         f.subscription_id,
         COALESCE(NULLIF(f.published_at, ''), f.first_seen_at) AS release_at,
         m.episode_number
       FROM feed_items f
       JOIN subscriptions s ON s.id = f.subscription_id
       LEFT JOIN release_metadata m ON m.feed_item_id = f.id
       WHERE s.enabled = 1
       ORDER BY datetime(COALESCE(NULLIF(f.published_at, ''), f.first_seen_at)) DESC, f.id DESC`
    )
    .all() as Array<{
    subscription_id: number;
    release_at: string | null;
    episode_number: number | null;
  }>;

  const grouped = new Map<
    number,
    Array<{ releaseAt: string; episodeNumber: number | null }>
  >();
  for (const row of rows) {
    if (!row.release_at || !subById.has(row.subscription_id)) continue;
    const list = grouped.get(row.subscription_id) ?? [];
    if (list.length < 6) {
      list.push({
        releaseAt: row.release_at,
        episodeNumber: row.episode_number
      });
      grouped.set(row.subscription_id, list);
    }
  }

  const entries: WeeklyScheduleEntry[] = [];
  for (const [subId, samples] of grouped) {
    const sub = subById.get(subId);
    if (!sub || samples.length === 0) continue;

    const counts = new Map<number, number>();
    let bestDay: number | null = null;
    let bestCount = -1;
    let latestEpisode: number | null = null;

    for (const sample of samples) {
      const date = parseToUtcDate(sample.releaseAt);
      if (Number.isNaN(date.getTime())) continue;
      const shanghaiDay = new Date(date.getTime() + SHANGHAI_OFFSET_MS).getUTCDay();
      const nextCount = (counts.get(shanghaiDay) ?? 0) + 1;
      counts.set(shanghaiDay, nextCount);
      if (nextCount > bestCount) {
        bestCount = nextCount;
        bestDay = shanghaiDay;
      }
      if (sample.episodeNumber != null) {
        const effective = Math.max(0, sample.episodeNumber + sub.episodeOffset);
        if (latestEpisode == null || effective > latestEpisode) {
          latestEpisode = effective;
        }
      }
    }

    if (bestDay == null) continue;
    entries.push({
      subscriptionId: sub.id,
      name: sub.name,
      seasonNumber: sub.seasonNumber,
      weekday: bestDay,
      latestEpisode,
      lastPublishedAt: samples[0].releaseAt
    });
  }

  return entries.sort((a, b) => a.name.localeCompare(b.name));
}
