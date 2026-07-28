import {
  Activity,
  RotateCw,
  ServerCrash
} from "lucide-react";
import { pollSelectedSubscriptionAction } from "@/app/actions";
import { AppShell } from "@/components/app-shell";
import { DashboardMotion } from "@/components/dashboard-motion";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EpisodeTable } from "@/components/episode-table";
import { WorkerTaskTable } from "@/components/worker-task-table";
import { getDashboardData } from "@/lib/db/repositories";
import { formatDateTime } from "@/lib/utils";
import type { DashboardQueryInput } from "@/lib/db/repositories";
import type { WorkerHealth } from "@/lib/db/types";
import type { TranslateFn } from "@/lib/i18n";
import { getDictionary } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

type HomePageSearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

export default async function HomePage({
  searchParams
}: {
  searchParams: HomePageSearchParams;
}) {
  const params = await searchParams;
  const data = getDashboardData(toDashboardQuery(params));
  const { locale, t } = await getDictionary();
  const enabledSubscriptions = data.subscriptions.filter(
    (subscription) => subscription.enabled
  );
  const defaultPollTarget = enabledSubscriptions[0]?.id.toString() ?? "all";
  const fmt = (value?: string | null) =>
    formatDateTime(value, { locale, never: t("common.never") });

  return (
    <AppShell>
      <section className="border-b border-[var(--line)] bg-[var(--hero)] backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-6 md:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0 flex-1">
              <div className="mb-2 inline-flex items-center gap-2 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel-strong)] px-2.5 py-1 text-xs font-medium text-[var(--muted)]">
                <Activity className="size-3.5 text-[var(--signal)]" />
                {t("overview.badge")}
              </div>
              <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
                {t("overview.title")}
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
                {t("overview.description")}
              </p>
            </div>
            <form
              action={pollSelectedSubscriptionAction}
              className="flex w-full min-w-0 items-center gap-2 sm:w-auto lg:max-w-md lg:shrink-0 lg:justify-end"
            >
              <select
                name="subscriptionId"
                defaultValue={defaultPollTarget}
                className="h-9 min-w-0 flex-1 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--input)] px-3 text-sm shadow-[var(--shadow)] focus:outline-none focus:ring-2 focus:ring-[var(--signal)] sm:w-48 sm:flex-none"
              >
                {enabledSubscriptions.map((subscription) => (
                  <option key={subscription.id} value={subscription.id}>
                    {subscription.name} / S
                    {String(subscription.seasonNumber).padStart(2, "0")}
                  </option>
                ))}
                <option value="all">{t("common.allSubscriptions")}</option>
              </select>
              <Button variant="signal" className="shrink-0 whitespace-nowrap">
                <RotateCw className="size-4" />
                {t("overview.poll")}
              </Button>
            </form>
          </div>

          <DashboardMotion
            stats={[
              {
                label: t("overview.statActive"),
                value: data.stats.activeSubscriptions
              },
              { label: t("overview.statQueued"), value: data.stats.queuedJobs },
              {
                label: t("overview.statWorker"),
                value: data.stats.workerTasks
              },
              {
                label: t("overview.statReview"),
                value: data.stats.needsReview
              },
              {
                label: t("overview.statCompleted"),
                value: data.stats.completedJobs
              }
            ]}
          />
        </div>
      </section>

      <div className="mx-auto grid w-full max-w-7xl gap-4 px-4 py-6 md:px-6">
        <div className="flex flex-col justify-between gap-2 text-xs text-[var(--muted)] md:flex-row md:items-center">
          <div>
            {t("overview.lastPoll")}
            <span className="data-digits ml-1">
              {fmt(
                data.subscriptions
                  .map((item) => item.lastPolledAt)
                  .filter(Boolean)
                  .sort()
                  .at(-1) ?? null
              )}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex size-1.5 rounded-full",
                data.workerHealth.ok
                  ? "worker-heartbeat bg-[var(--signal)]"
                  : "bg-[var(--accent)] shadow-[0_0_0_3px_var(--accent-soft)]"
              )}
              aria-hidden
            />
            {t("overview.workerHeartbeat")}
            <span className="data-digits ml-0.5">
              {fmt(data.workerHealth.lastSeenAt)}
            </span>
          </div>
        </div>
        <WorkerHealthNotice health={data.workerHealth} t={t} />
        <EpisodeTable pageData={data.episodePage} />
        <WorkerTaskTable
          tasks={data.workerTasks}
          subscriptions={data.subscriptions}
        />
      </div>
    </AppShell>
  );
}

function toDashboardQuery(
  params: Awaited<HomePageSearchParams>
): DashboardQueryInput {
  return {
    episodeSubscriptionId: firstParam(params.episodeSubscriptionId),
    episodeSubscriptionState: firstParam(params.episodeSubscriptionState),
    episodeSeason: firstParam(params.episodeSeason),
    episodeStatus: firstParam(params.episodeStatus),
    episodePage: firstParam(params.episodePage),
    episodePageSize: firstParam(params.episodePageSize)
  };
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function WorkerHealthNotice({
  health,
  t
}: {
  health: WorkerHealth;
  t: TranslateFn;
}) {
  if (health.ok) return null;

  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-[var(--accent-soft-border)] bg-[var(--accent-soft)] px-3 py-3 text-sm md:flex-row md:items-center md:justify-between">
      <div className="flex min-w-0 items-start gap-2">
        <ServerCrash className="mt-0.5 size-4 shrink-0 text-[var(--accent)]" />
        <div>
          <div className="font-medium text-[var(--foreground)]">
            {t("overview.workerOfflineTitle")}
          </div>
          <div className="mt-1 text-xs text-[var(--muted)]">
            {t("overview.workerOfflineBody")}
          </div>
        </div>
      </div>
      <div className="data-digits text-xs text-[var(--muted)]">
        {health.lastSeenAt
          ? t("overview.noHeartbeatSince", {
              age: formatAge(health.secondsSinceLastSeen, t)
            })
          : t("overview.neverHeartbeat")}
      </div>
    </div>
  );
}

function formatAge(seconds: number | null, t: TranslateFn) {
  if (seconds == null) return t("common.unknown");
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}
