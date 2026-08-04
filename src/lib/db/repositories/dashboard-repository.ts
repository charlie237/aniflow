import { count, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { queryDashboardEpisodePage } from "@/lib/db/dashboard";
import { downloadJobs } from "@/lib/db/schema";
import type {
  DashboardData,
  DashboardEpisodePage,
  EpisodeStatusFilter,
  Subscription,
  SubscriptionStateFilter,
  WorkerTaskCategory
} from "@/lib/db/types";
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
    rssItems: [],
    feedItems: [],
    jobs: [],
    workerTaskPage: getDashboardWorkerTaskPage(input),
    episodeFiles: [],
    episodePage,
    workerHealth: getWorkerHealth(),
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
