"use client";

import { useMemo, useState } from "react";
import { Eye, ListChecks } from "lucide-react";
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
import { formatDateTime } from "@/lib/utils";
import type {
  DashboardData,
  WorkerTask,
  WorkerTaskStatus,
  WorkerTaskType
} from "@/lib/db/types";

const taskTypeLabels: Record<WorkerTaskType, string> = {
  poll_all: "全部同步并轮询",
  poll_subscription: "订阅同步并轮询",
  cleanup_subscription_incoming: "清下载残留",
  scan_incoming: "扫描整理",
  submit_queued: "提交下载"
};

const taskStatusLabels: Record<WorkerTaskStatus, string> = {
  queued: "排队中",
  running: "运行中",
  completed: "已完成",
  failed: "失败"
};

export function WorkerTaskTable({
  tasks,
  subscriptions
}: {
  tasks: DashboardData["workerTasks"];
  subscriptions: DashboardData["subscriptions"];
}) {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const subscriptionNames = new Map(
    subscriptions.map((subscription) => [subscription.id, subscription.name])
  );
  const pageCount = Math.ceil(tasks.length / pageSize);
  const safePage = Math.min(page, Math.max(pageCount - 1, 0));
  const pageTasks = useMemo(
    () => tasks.slice(safePage * pageSize, (safePage + 1) * pageSize),
    [pageSize, safePage, tasks]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListChecks className="size-4 text-[var(--signal)]" />
          后台队列
        </CardTitle>
        <CardDescription>媒体库同步、RSS 轮询和文件整理会先进入队列。</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">状态</TableHead>
              <TableHead>任务</TableHead>
              <TableHead className="w-24">次数</TableHead>
              <TableHead className="w-28">更新</TableHead>
              <TableHead className="w-16 text-right">详情</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-20 text-center text-[var(--muted)]">
                  暂无后台任务。
                </TableCell>
              </TableRow>
            ) : (
              pageTasks.map((task) => (
                <TableRow key={task.id}>
                  <TableCell>
                    <Badge
                      variant={statusVariant(task.status)}
                      className={
                        task.status === "running" || task.status === "queued"
                          ? "status-live"
                          : undefined
                      }
                    >
                      {task.status === "running" || task.status === "queued" ? (
                        <span className="status-live-dot" aria-hidden />
                      ) : null}
                      {taskStatusLabels[task.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[420px]">
                    <div className="font-medium">{taskTypeLabels[task.type]}</div>
                    <div className="mt-1 truncate text-xs text-[var(--muted)]">
                      {task.subscriptionId
                        ? subscriptionNames.get(task.subscriptionId) ??
                          `订阅 ${task.subscriptionId}`
                        : "全部订阅"}
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
                    <WorkerTaskDetails
                      task={task}
                      subscriptionName={
                        task.subscriptionId
                          ? subscriptionNames.get(task.subscriptionId) ??
                            `订阅 ${task.subscriptionId}`
                          : "全部订阅"
                      }
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <div className="mt-3">
          <TablePagination
            page={safePage}
            pageCount={pageCount}
            pageSize={pageSize}
            total={tasks.length}
            onPageChange={setPage}
            onPageSizeChange={(nextPageSize) => {
              setPageSize(nextPageSize);
              setPage(0);
            }}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function WorkerTaskDetails({
  task,
  subscriptionName
}: {
  task: WorkerTask;
  subscriptionName: string;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" size="icon" variant="ghost" aria-label="查看后台任务详情">
          <Eye className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[86vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>后台任务 #{task.id}</DialogTitle>
          <DialogDescription>
            {taskTypeLabels[task.type]} / {subscriptionName}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2 rounded-[var(--radius)] bg-[var(--panel-strong)] p-3 text-sm">
            <TaskDetail label="状态" value={taskStatusLabels[task.status]} />
            <TaskDetail label="尝试次数" value={task.attempts.toString()} mono />
            <TaskDetail label="创建" value={formatDateTime(task.createdAt)} mono />
            <TaskDetail label="开始" value={formatDateTime(task.startedAt)} mono />
            <TaskDetail label="结束" value={formatDateTime(task.finishedAt)} mono />
            <TaskDetail label="更新" value={formatDateTime(task.updatedAt)} mono />
            <TaskDetail label="错误" value={task.errorMessage} />
          </div>
          <div>
            <div className="mb-2 text-sm font-medium">Payload</div>
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

function prettyJson(value: string) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value || "{}";
  }
}

function statusVariant(status: WorkerTaskStatus) {
  if (status === "completed") return "signal";
  if (status === "failed") return "danger";
  if (status === "running") return "violet";
  return "muted";
}
