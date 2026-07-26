import {
  Activity,
  FolderSync,
  RotateCw,
  ServerCrash
} from "lucide-react";
import {
  pollSelectedSubscriptionAction,
  scanIncomingAction
} from "@/app/actions";
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
  const enabledSubscriptions = data.subscriptions.filter((subscription) => subscription.enabled);
  const defaultPollTarget = enabledSubscriptions[0]?.id.toString() ?? "all";

  return (
    <AppShell>
      <section className="border-b border-[var(--line)] bg-[var(--hero)] backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-6 md:px-6">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel-strong)] px-2.5 py-1 text-xs font-medium text-[var(--muted)]">
                <Activity className="size-3.5 text-[var(--signal)]" />
                RSS / OpenList / 115 media flow
              </div>
              <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
                运行总览
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
                这里看任务、发布和文件整理状态；订阅和连接参数分别在独立页面维护。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <form
                action={pollSelectedSubscriptionAction}
                className="flex flex-wrap gap-2"
              >
                <select
                  name="subscriptionId"
                  defaultValue={defaultPollTarget}
                  className="h-9 min-w-[180px] rounded-[var(--radius)] border border-[var(--line)] bg-[var(--input)] px-3 text-sm shadow-[var(--shadow)] focus:outline-none focus:ring-2 focus:ring-[var(--signal)]"
                >
                  {enabledSubscriptions.map((subscription) => (
                    <option key={subscription.id} value={subscription.id}>
                      {subscription.name} / S{String(subscription.seasonNumber).padStart(2, "0")}
                    </option>
                  ))}
                  <option value="all">全部订阅</option>
                </select>
                <Button variant="signal">
                  <RotateCw className="size-4" />
                  同步并轮询
                </Button>
              </form>
              <form action={scanIncomingAction}>
                <Button variant="outline">
                  <FolderSync className="size-4" />
                  扫描整理
                </Button>
              </form>
            </div>
          </div>

          <DashboardMotion
            stats={[
              { label: "启用订阅", value: data.stats.activeSubscriptions },
              { label: "进行中", value: data.stats.queuedJobs },
              { label: "后台任务", value: data.stats.workerTasks },
              { label: "待处理", value: data.stats.needsReview },
              { label: "已完成", value: data.stats.completedJobs }
            ]}
          />
        </div>
      </section>

      <div className="mx-auto grid w-full max-w-7xl gap-4 px-4 py-6 md:px-6">
        <div className="flex flex-col justify-between gap-2 text-xs text-[var(--muted)] md:flex-row md:items-center">
          <div>
            最新轮询：
            <span className="data-digits ml-1">
              {formatDateTime(
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
            Worker 心跳：
            <span className="data-digits ml-0.5">
              {formatDateTime(data.workerHealth.lastSeenAt)}
            </span>
          </div>
        </div>
        <WorkerHealthNotice health={data.workerHealth} />
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

function WorkerHealthNotice({ health }: { health: WorkerHealth }) {
  if (health.ok) return null;

  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-[var(--accent-soft-border)] bg-[var(--accent-soft)] px-3 py-3 text-sm md:flex-row md:items-center md:justify-between">
      <div className="flex min-w-0 items-start gap-2">
        <ServerCrash className="mt-0.5 size-4 shrink-0 text-[var(--accent)]" />
        <div>
          <div className="font-medium text-[var(--foreground)]">
            后台 worker 没有在线心跳
          </div>
          <div className="mt-1 text-xs text-[var(--muted)]">
            常驻轮询需要单独运行 <span className="data-digits">npm run worker</span>。
          </div>
        </div>
      </div>
      <div className="data-digits text-xs text-[var(--muted)]">
        {health.lastSeenAt
          ? `${formatAge(health.secondsSinceLastSeen)} 未心跳`
          : "从未心跳"}
      </div>
    </div>
  );
}

function formatAge(seconds: number | null) {
  if (seconds == null) return "未知";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}
