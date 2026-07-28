"use client";

import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/components/locale-provider";
import { cn } from "@/lib/utils";
import type { JobStatus } from "@/lib/db/types";

export function StatusBadge({ status }: { status: JobStatus }) {
  const { t } = useI18n();
  const variant =
    status === "completed"
      ? "signal"
      : status === "failed"
        ? "danger"
        : status === "needs_review" || status === "waiting_file"
          ? "amber"
          : status === "queued" || status === "downloading"
            ? "violet"
            : "muted";

  const pulse =
    status === "downloading" ||
    status === "queued" ||
    status === "waiting_file";

  return (
    <Badge
      variant={variant}
      className={cn(
        pulse && "status-live",
        status === "downloading" && "status-live-strong"
      )}
    >
      {pulse ? (
        <span className="status-live-dot" aria-hidden />
      ) : null}
      {t(`status.job.${status}`)}
    </Badge>
  );
}
