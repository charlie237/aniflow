"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, Eye, Layers3, ListChecks } from "lucide-react";
import { useI18n } from "@/components/locale-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { TablePagination } from "@/components/table-pagination";
import type {
  DashboardData,
  WorkerTask,
  WorkerTaskPhase,
  WorkerTaskStatus,
  WorkerTaskType
} from "@/lib/db/types";
import type { TranslateFn } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  classifyWorkerTask,
  groupWorkerTasks,
  parsePollResult,
  type WorkerTaskCategory
} from "@/lib/worker/task-presentation";

type WorkerTaskFilter = "all" | WorkerTaskCategory;

const WORKER_TASK_FILTERS: WorkerTaskFilter[] = [
  "all",
  "attention",
  "active",
  "action",
  "routine",
  "other"
];

export function WorkerTaskTable({
  pageData,
  subscriptions
}: {
  pageData: DashboardData["workerTaskPage"];
  subscriptions: DashboardData["subscriptions"];
}) {
  const { t, formatDateTime } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set()
  );
  const tasks = pageData.rows;
  const filter = pageData.filters.category;
  const subscriptionNames = useMemo(
    () =>
      new Map(
        subscriptions.map((subscription) => [subscription.id, subscription.name])
      ),
    [subscriptions]
  );
  const groupedTasks = useMemo(() => groupWorkerTasks(tasks), [tasks]);
  const hasActiveTasks = pageData.counts.active > 0;

  useEffect(() => {
    if (!hasActiveTasks) return;
    const timer = window.setInterval(() => router.refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [hasActiveTasks, router]);

  function updateWorkerTaskParams(
    updates: Partial<{
      category: WorkerTaskFilter;
      page: number;
      pageSize: number;
    }>
  ) {
    const params = new URLSearchParams(searchParams.toString());

    if (updates.category !== undefined) {
      if (updates.category === "all") params.delete("workerTaskCategory");
      else params.set("workerTaskCategory", updates.category);
      params.delete("workerTaskPage");
    }
    if (updates.page !== undefined) {
      if (updates.page <= 1) params.delete("workerTaskPage");
      else params.set("workerTaskPage", String(updates.page));
    }
    if (updates.pageSize !== undefined) {
      if (updates.pageSize === 10) params.delete("workerTaskPageSize");
      else params.set("workerTaskPageSize", String(updates.pageSize));
      params.delete("workerTaskPage");
    }

    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function subscriptionLabel(subscriptionId: number | null) {
    if (subscriptionId == null) return t("common.allSubscriptions");
    return (
      subscriptionNames.get(subscriptionId) ??
      t("common.subscriptionFallback", { id: subscriptionId })
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListChecks
            className="size-4 text-[var(--signal)]"
            aria-hidden="true"
          />
          {t("workerTask.title")}
        </CardTitle>
        <CardDescription>{t("workerTask.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div
          className="mb-3 flex flex-wrap gap-1.5 border-b border-[var(--line)] pb-3"
          role="group"
          aria-label={t("workerTask.title")}
        >
          {WORKER_TASK_FILTERS.map((value) => {
            const count = pageData.counts[value];
            return (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={filter === value ? "outline" : "ghost"}
                aria-pressed={filter === value}
                className={cn(
                  filter === value
                    ? "border-[var(--signal-soft-border)] bg-[var(--signal-soft)] text-[var(--signal-text)]"
                    : "text-[var(--muted)]"
                )}
                onClick={() => updateWorkerTaskParams({ category: value })}
              >
                {t(`workerTask.categories.${value}`)}
                <span className="data-digits opacity-70">{count}</span>
              </Button>
            );
          })}
        </div>
        <Table className="min-w-[760px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">{t("workerTask.colStatus")}</TableHead>
              <TableHead>{t("workerTask.colTask")}</TableHead>
              <TableHead className="w-24">{t("workerTask.colAttempts")}</TableHead>
              <TableHead className="w-28">{t("workerTask.colUpdated")}</TableHead>
              <TableHead className="w-16 text-right">
                {t("workerTask.colDetails")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="h-20 text-center text-[var(--muted)]"
                >
                  {pageData.counts.all === 0
                    ? t("workerTask.empty")
                    : t("workerTask.filteredEmpty")}
                </TableCell>
              </TableRow>
            ) : (
              groupedTasks.map((item) =>
                item.kind === "routine-group" ? (
                  <RoutineTaskGroup
                    key={item.id}
                    item={item}
                    expanded={expandedGroups.has(item.id)}
                    subscriptionName={subscriptionLabel(
                      item.tasks[0].subscriptionId
                    )}
                    onToggle={() => {
                      setExpandedGroups((current) => {
                        const next = new Set(current);
                        if (next.has(item.id)) next.delete(item.id);
                        else next.add(item.id);
                        return next;
                      });
                    }}
                  />
                ) : (
                  <WorkerTaskRow
                    key={item.id}
                    task={item.task}
                    category={item.category}
                    subscriptionName={subscriptionLabel(item.task.subscriptionId)}
                  />
                )
              )
            )}
          </TableBody>
        </Table>
        <div className="mt-3">
          <TablePagination
            page={pageData.page - 1}
            pageCount={pageData.pageCount}
            pageSize={pageData.pageSize}
            total={pageData.total}
            totalLabel={t("workerTask.paginationTotal", {
              rows: pageData.total,
              tasks: pageData.taskTotal
            })}
            summary={t("workerTask.pageSummary", {
              tasks: pageData.rows.length,
              rows: groupedTasks.length
            })}
            onPageChange={(nextPage) =>
              updateWorkerTaskParams({ page: nextPage + 1 })
            }
            onPageSizeChange={(nextPageSize) =>
              updateWorkerTaskParams({ pageSize: nextPageSize })
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}

function WorkerTaskRow({
  task,
  category,
  subscriptionName,
  nested = false
}: {
  task: WorkerTask;
  category: WorkerTaskCategory;
  subscriptionName: string;
  nested?: boolean;
}) {
  const { t, formatDateTime } = useI18n();
  const pollResult = parsePollResult(task);
  return (
    <TableRow className={cn(nested && "bg-[var(--panel-strong)]/50")}>
      <TableCell className="align-middle">
        <WorkerTaskExecution task={task} />
      </TableCell>
      <TableCell className="max-w-[420px]">
        <div
          className={cn(
            "flex flex-wrap items-center gap-2",
            nested && "border-l-2 border-[var(--line)] pl-3 text-sm"
          )}
        >
          <span className="font-medium">
            {nested
              ? t("workerTask.taskTitle", { id: task.id })
              : taskTypeLabel(t, task.type)}
          </span>
          <WorkerTaskOutcome task={task} category={category} />
        </div>
        <div
          className={cn(
            "mt-1 truncate text-xs text-[var(--muted)]",
            nested && "pl-[14px]"
          )}
        >
          {subscriptionName}
          {pollResult ? (
            <span className="data-digits">
              {" · "}
              {t("workerTask.taskSummary", {
                fetched: pollResult.fetched,
                discovered: pollResult.discovered
              })}
            </span>
          ) : null}
        </div>
        {task.errorMessage ? (
          <div className="mt-1 line-clamp-2 text-xs text-[var(--danger)]">
            {task.errorMessage}
          </div>
        ) : null}
      </TableCell>
      <TableCell className="data-digits text-xs">{task.attempts}</TableCell>
      <TableCell className="data-digits text-xs">
        {formatDateTime(task.updatedAt)}
      </TableCell>
      <TableCell className="text-right">
        <WorkerTaskDetails task={task} subscriptionName={subscriptionName} />
      </TableCell>
    </TableRow>
  );
}

function RoutineTaskGroup({
  item,
  expanded,
  subscriptionName,
  onToggle
}: {
  item: Extract<
    ReturnType<typeof groupWorkerTasks>[number],
    { kind: "routine-group" }
  >;
  expanded: boolean;
  subscriptionName: string;
  onToggle: () => void;
}) {
  const { t, formatDateTime } = useI18n();
  const newestTask = item.tasks[0];
  const oldestTask = item.tasks[item.tasks.length - 1];

  return (
    <>
      <TableRow className="bg-[var(--panel-strong)]/70">
        <TableCell className="align-middle">
          <WorkerTaskExecution task={newestTask} />
        </TableCell>
        <TableCell className="max-w-[420px]">
          <div className="flex items-center gap-2 font-medium">
            <Layers3 className="size-3.5 text-[var(--muted)]" aria-hidden="true" />
            {t("workerTask.routineRuns", { count: item.tasks.length })}
          </div>
          <div className="mt-1 truncate text-xs text-[var(--muted)]">
            {subscriptionName}
            <span className="data-digits">
              {" · "}
              {t("workerTask.taskSummary", {
                fetched: item.result.fetched,
                discovered: item.result.discovered
              })}
            </span>
          </div>
        </TableCell>
        <TableCell className="data-digits text-xs">{newestTask.attempts}</TableCell>
        <TableCell className="data-digits text-xs">
          <div>{formatDateTime(newestTask.updatedAt)}</div>
          <div className="mt-1 text-[10px] text-[var(--muted)]">
            {t("workerTask.routineRange", {
              start: formatDateTime(oldestTask.createdAt),
              end: formatDateTime(newestTask.updatedAt)
            })}
          </div>
        </TableCell>
        <TableCell className="text-right">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-expanded={expanded}
            aria-label={t(
              expanded ? "workerTask.collapseRoutine" : "workerTask.expandRoutine",
              { count: item.tasks.length }
            )}
            onClick={onToggle}
          >
            <ChevronDown
              className={cn("transition-transform", expanded && "rotate-180")}
              aria-hidden="true"
            />
          </Button>
        </TableCell>
      </TableRow>
      {expanded
        ? item.tasks.map((task) => (
            <WorkerTaskRow
              key={task.id}
              task={task}
              category="routine"
              subscriptionName={subscriptionName}
              nested
            />
          ))
        : null}
    </>
  );
}

function WorkerTaskExecution({ task }: { task: WorkerTask }) {
  const { t } = useI18n();
  const live = task.status === "running" || task.status === "queued";

  if (task.status === "completed") {
    return (
      <span className="whitespace-nowrap text-xs font-medium text-[var(--muted)]">
        {t("workerTask.completedShort")}
      </span>
    );
  }

  return (
    <div
      className="flex min-w-[6rem] flex-col items-start gap-1.5"
      aria-live={live ? "polite" : undefined}
    >
      <Badge
        variant={executionVariant(task.status)}
        className={cn("whitespace-nowrap", live && "status-live")}
      >
        {live ? <span className="status-live-dot" aria-hidden /> : null}
        {taskStatusLabel(t, task.status)}
      </Badge>
      <WorkerTaskPhaseSummary task={task} />
    </div>
  );
}

function WorkerTaskPhaseSummary({ task }: { task: WorkerTask }) {
  const { t } = useI18n();
  if (task.status === "queued") {
    return (
      <span className="text-xs text-[var(--muted)]">
        {t("workerTask.waitingForWorker")}
      </span>
    );
  }
  if (!task.phase || (task.status !== "running" && task.status !== "failed")) {
    return null;
  }

  const progress = taskProgressLabel(task);
  return (
    <div className="max-w-[11rem] text-xs leading-5">
      <div
        className={cn(
          "font-medium",
          task.status === "failed"
            ? "text-[var(--danger-text)]"
            : "text-[var(--violet-text)]"
        )}
      >
        {task.status === "failed"
          ? t("workerTask.failedAt", { phase: taskPhaseLabel(t, task.phase) })
          : taskPhaseLabel(t, task.phase)}
      </div>
      {task.phaseDetail || progress ? (
        <div className="truncate text-[var(--muted)]">
          {[task.phaseDetail, progress].filter(Boolean).join(" · ")}
        </div>
      ) : null}
    </div>
  );
}

function WorkerTaskOutcome({
  task,
  category
}: {
  task: WorkerTask;
  category: WorkerTaskCategory;
}) {
  const { t } = useI18n();
  const result = parsePollResult(task);
  if (category === "attention") {
    return <Badge variant="danger">{t("workerTask.outcomes.attention")}</Badge>;
  }
  if (category === "routine") {
    return <Badge variant="muted">{t("workerTask.outcomes.noChange")}</Badge>;
  }
  if (category === "action") {
    return (
      <Badge variant="signal">
        {result?.queued
          ? t("workerTask.outcomes.queued", { count: result.queued })
          : t("workerTask.outcomes.changed")}
      </Badge>
    );
  }
  return null;
}

function WorkerTaskDetails({
  task,
  subscriptionName
}: {
  task: WorkerTask;
  subscriptionName: string;
}) {
  const { t, formatDateTime } = useI18n();
  const pollResult = parsePollResult(task);
  const outcome = workerTaskOutcomeLabel(t, task);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={t("workerTask.viewDetails")}
        >
          <Eye aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[86vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {taskTypeLabel(t, task.type)} · {outcome}
          </DialogTitle>
          <DialogDescription>
            {t("workerTask.taskTitle", { id: task.id })} · {subscriptionName}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2 rounded-[var(--radius)] bg-[var(--panel-strong)] p-3 text-sm">
            <TaskDetail
              label={t("workerTask.labelStatus")}
              value={taskStatusLabel(t, task.status)}
            />
            <TaskDetail
              label={t("workerTask.labelOutcome")}
              value={outcome}
            />
            <TaskDetail
              label={t("workerTask.labelResult")}
              value={
                pollResult
                  ? t("workerTask.taskResult", {
                      fetched: pollResult.fetched,
                      discovered: pollResult.discovered,
                      queued: pollResult.queued,
                      failed: pollResult.failed
                    })
                  : null
              }
              mono={pollResult != null}
            />
            <TaskDetail
              label={t("workerTask.labelPhase")}
              value={task.phase ? taskPhaseLabel(t, task.phase) : null}
            />
            <TaskDetail
              label={t("workerTask.labelProgress")}
              value={[task.phaseDetail, taskProgressLabel(task)]
                .filter(Boolean)
                .join(" · ")}
            />
            <TaskDetail
              label={t("workerTask.labelAttempts")}
              value={task.attempts.toString()}
              mono
            />
            <TaskDetail
              label={t("workerTask.labelCreated")}
              value={formatDateTime(task.createdAt)}
              mono
            />
            <TaskDetail
              label={t("workerTask.labelStarted")}
              value={formatDateTime(task.startedAt)}
              mono
            />
            <TaskDetail
              label={t("workerTask.labelFinished")}
              value={formatDateTime(task.finishedAt)}
              mono
            />
            <TaskDetail
              label={t("workerTask.labelUpdated")}
              value={formatDateTime(task.updatedAt)}
              mono
            />
            <TaskDetail
              label={t("workerTask.labelError")}
              value={task.errorMessage}
            />
          </div>
          <div>
            <div className="mb-2 text-sm font-medium">
              {t("workerTask.labelPayload")}
            </div>
            <pre className="max-h-[320px] overflow-auto rounded-[var(--radius)] border border-[var(--line)] bg-[var(--code-bg)] p-3 text-xs text-[var(--code-fg)]">
              {prettyJson(task.payloadJson)}
            </pre>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TaskDetail({
  label,
  value,
  mono
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
}) {
  return (
    <div className="grid gap-1 sm:grid-cols-[90px_minmax(0,1fr)]">
      <div className="text-xs text-[var(--muted)]">{label}</div>
      <div
        className={
          mono
            ? "break-all data-digits text-xs text-[var(--foreground)]"
            : "break-words text-[var(--foreground)]"
        }
      >
        {value || "-"}
      </div>
    </div>
  );
}

function taskTypeLabel(t: TranslateFn, type: WorkerTaskType) {
  return t(`workerTask.types.${type}`);
}

function taskStatusLabel(t: TranslateFn, status: WorkerTaskStatus) {
  return t(`workerTask.statuses.${status}`);
}

function workerTaskOutcomeLabel(t: TranslateFn, task: WorkerTask) {
  const category = classifyWorkerTask(task);
  const result = parsePollResult(task);

  if (category === "attention") return t("workerTask.outcomes.attention");
  if (category === "routine") return t("workerTask.outcomes.noChange");
  if (category === "action") {
    return result?.queued
      ? t("workerTask.outcomes.queued", { count: result.queued })
      : t("workerTask.outcomes.changed");
  }
  return taskStatusLabel(t, task.status);
}

function taskPhaseLabel(t: TranslateFn, phase: WorkerTaskPhase) {
  return t(`workerTask.phases.${phase}`);
}

function taskProgressLabel(task: WorkerTask) {
  if (task.progressCurrent == null || task.progressTotal == null) return null;
  return `${task.progressCurrent}/${task.progressTotal}`;
}

function prettyJson(value: string) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value || "{}";
  }
}

function executionVariant(status: WorkerTaskStatus) {
  if (status === "failed") return "danger";
  if (status === "running") return "violet";
  if (status === "queued") return "amber";
  return "muted";
}
