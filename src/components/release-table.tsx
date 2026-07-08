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
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";
import type { DashboardData } from "@/lib/db/types";

export function ReleaseTable({ items }: { items: DashboardData["feedItems"] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>候选发布</CardTitle>
        <CardDescription>只显示命中订阅规则但尚未进入任务流水的 RSS 条目。</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>剧集</TableHead>
              <TableHead>TAG</TableHead>
              <TableHead>下载源</TableHead>
              <TableHead className="w-28">状态</TableHead>
              <TableHead className="w-28">发现</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-[var(--muted)]">
                  当前没有待入队的候选发布。
                </TableCell>
              </TableRow>
            ) : (
              items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="max-w-[420px]">
                    <div className="truncate font-medium">{item.title}</div>
                    <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-[var(--muted)]">
                      <span>{item.subscriptionName}</span>
                      {item.metadata?.episodeNumber != null ? (
                        <Badge variant="violet">
                          EP {String(item.metadata.episodeNumber).padStart(2, "0")}
                        </Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <TagRow metadata={item.metadata} />
                  </TableCell>
                  <TableCell className="max-w-[260px] truncate data-digits text-xs">
                    {item.downloadUrl ?? item.link ?? "-"}
                  </TableCell>
                  <TableCell>
                    {item.job ? <StatusBadge status={item.job.status} /> : <Badge variant="muted">未入队</Badge>}
                  </TableCell>
                  <TableCell className="data-digits text-xs">
                    {formatDateTime(item.firstSeenAt)}
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
