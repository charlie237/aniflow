import { Badge } from "@/components/ui/badge";
import type { JobStatus } from "@/lib/db/types";

const statusLabels: Record<JobStatus, string> = {
  discovered: "已发现",
  skipped: "已跳过",
  queued: "队列中",
  downloading: "下载中",
  needs_review: "待确认",
  ready_to_rename: "待整理",
  completed: "已完成",
  failed: "失败"
};

export function StatusBadge({ status }: { status: JobStatus }) {
  const variant =
    status === "completed"
      ? "signal"
      : status === "failed"
        ? "danger"
        : status === "needs_review"
          ? "amber"
          : status === "queued" || status === "downloading"
            ? "violet"
            : "muted";

  return <Badge variant={variant}>{statusLabels[status]}</Badge>;
}
