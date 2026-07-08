import { CheckCircle2, RotateCcw } from "lucide-react";
import { confirmJobAction, retryJobAction } from "@/app/actions";
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
import { StatusBadge } from "@/components/status-badge";
import { TagRow } from "@/components/tag-row";
import { formatDateTime } from "@/lib/utils";
import type { DashboardData } from "@/lib/db/types";

export function JobTable({ jobs }: { jobs: DashboardData["jobs"] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>任务</CardTitle>
        <CardDescription>从 RSS 发现到 OpenList 下载、整理完成的流水。</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">状态</TableHead>
              <TableHead>发布</TableHead>
              <TableHead>标签</TableHead>
              <TableHead>目标</TableHead>
              <TableHead className="w-28">更新</TableHead>
              <TableHead className="w-24 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-[var(--muted)]">
                  暂无任务。添加订阅后手动轮询一次。
                </TableCell>
              </TableRow>
            ) : (
              jobs.map((job) => (
                <TableRow key={job.id}>
                  <TableCell>
                    <StatusBadge status={job.status} />
                  </TableCell>
                  <TableCell className="max-w-[360px]">
                    <div className="truncate font-medium">{job.feedTitle}</div>
                    <div className="mt-1 text-xs text-[var(--muted)]">
                      {job.subscriptionName}
                      {job.metadata?.episodeNumber != null
                        ? ` / EP ${String(job.metadata.episodeNumber).padStart(2, "0")}`
                        : ""}
                    </div>
                    {job.errorMessage ? (
                      <div className="mt-1 line-clamp-2 text-xs text-[var(--danger)]">
                        {job.errorMessage}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <TagRow metadata={job.metadata} />
                  </TableCell>
                  <TableCell className="max-w-[260px] truncate data-digits text-xs">
                    {job.targetPath ?? job.sourceUrl ?? "-"}
                  </TableCell>
                  <TableCell className="data-digits text-xs">
                    {formatDateTime(job.updatedAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {job.status === "failed" ? (
                        <form action={retryJobAction}>
                          <input type="hidden" name="id" value={job.id} />
                          <Button size="icon" variant="ghost" aria-label="重试">
                            <RotateCcw className="size-4" />
                          </Button>
                        </form>
                      ) : null}
                      {job.status === "needs_review" ? (
                        <form action={confirmJobAction}>
                          <input type="hidden" name="id" value={job.id} />
                          <Button size="icon" variant="ghost" aria-label="确认下载">
                            <CheckCircle2 className="size-4" />
                          </Button>
                        </form>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
