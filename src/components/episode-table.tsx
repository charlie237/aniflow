"use client";

import type { ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  FileVideo,
  PlayCircle,
  Plus,
  RotateCcw,
  Rss,
  X
} from "lucide-react";
import {
  confirmJobAction,
  manualSupplementEpisodeAction,
  retryJobAction
} from "@/app/actions";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { TablePagination } from "@/components/table-pagination";
import {
  formatDateTime,
  formatFileSize
} from "@/lib/utils";
import type {
  DashboardData,
  DashboardEpisodeRow,
  EpisodeStatusFilter,
  ReleaseMetadata
} from "@/lib/db/types";

export function EpisodeTable({
  pageData
}: {
  pageData: DashboardData["episodePage"];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const scopeValue =
    pageData.filters.subscriptionId == null
      ? "all"
      : `${pageData.filters.subscriptionId}:${pageData.filters.season ?? ""}`;
  const statusValue = pageData.filters.status;
  const hasExplicitFilters = [
    "episodeSubscriptionId",
    "episodeSeason",
    "episodeStatus",
    "episodePage"
  ].some((key) => searchParams.has(key));
  const statusTabs: Array<{
    value: EpisodeStatusFilter;
    label: string;
    count: number;
  }> = [
    { value: "all", label: "全部", count: pageData.counts.all },
    { value: "active", label: "进行中", count: pageData.counts.active },
    { value: "waiting", label: "待处理", count: pageData.counts.waiting },
    { value: "failed", label: "失败", count: pageData.counts.failed },
    { value: "completed", label: "已完成", count: pageData.counts.completed }
  ];

  function updateEpisodeParams(
    updates: Partial<{
      subscriptionId: string;
      season: string;
      status: EpisodeStatusFilter;
      page: number;
      pageSize: number;
    }>
  ) {
    const params = new URLSearchParams(searchParams.toString());

    if (updates.subscriptionId !== undefined) {
      setOrDelete(params, "episodeSubscriptionId", updates.subscriptionId, "all");
      params.delete("episodePage");
    }
    if (updates.season !== undefined) {
      setOrDelete(params, "episodeSeason", updates.season, "all");
      params.delete("episodePage");
    }
    if (updates.status !== undefined) {
      setOrDelete(params, "episodeStatus", updates.status, "all");
      params.delete("episodePage");
    }
    if (updates.page !== undefined) {
      setOrDelete(params, "episodePage", String(updates.page), "1");
    }
    if (updates.pageSize !== undefined) {
      setOrDelete(params, "episodePageSize", String(updates.pageSize), "20");
      params.delete("episodePage");
    }

    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  function updateEpisodeScope(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") {
      params.delete("episodeSubscriptionId");
      params.delete("episodeSeason");
    } else {
      const [subscriptionId, season] = value.split(":");
      setOrDelete(params, "episodeSubscriptionId", subscriptionId ?? "", "all");
      setOrDelete(params, "episodeSeason", season ?? "", "all");
    }
    params.delete("episodePage");
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  function clearEpisodeFilters() {
    const params = new URLSearchParams(searchParams.toString());
    for (const key of [
      "episodeSubscriptionId",
      "episodeSeason",
      "episodeStatus",
      "episodePage"
    ]) {
      params.delete(key);
    }
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PlayCircle className="size-4 text-[var(--signal)]" />
          Episode
        </CardTitle>
        <CardDescription>
          只展示命中规则的 RSS 发布，并合并下载任务与文件整理结果。
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap gap-2">
          <select
            value={scopeValue}
            onChange={(event) => updateEpisodeScope(event.target.value)}
            className="h-9 min-w-[220px] rounded-[var(--radius)] border border-[var(--line)] bg-white px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--signal)]"
          >
            <option value="all">全部 Episode</option>
            {pageData.subscriptionOptions.map((subscription) => (
              <option
                key={`${subscription.id}:${subscription.seasonNumber}`}
                value={`${subscription.id}:${subscription.seasonNumber}`}
              >
                {subscription.name} / {seasonLabel(subscription.seasonNumber)}
              </option>
            ))}
          </select>
          {statusTabs.map(({ value, label, count }) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={statusValue === value ? "signal" : "outline"}
              onClick={() => updateEpisodeParams({ status: value })}
            >
              {label}
              <span className="data-digits text-xs opacity-70">{count}</span>
            </Button>
          ))}
          </div>
          <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!hasExplicitFilters}
            onClick={clearEpisodeFilters}
          >
            <X className="size-4" />
            清除筛选
          </Button>
          <ManualSupplementDialog pageData={pageData} />
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">状态</TableHead>
              <TableHead>发布</TableHead>
              <TableHead>文件</TableHead>
              <TableHead className="w-28">更新</TableHead>
              <TableHead className="w-24 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageData.rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-[var(--muted)]">
                  当前没有命中规则的 Episode。
                </TableCell>
              </TableRow>
            ) : (
              pageData.rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <EpisodeStatus row={row} />
                  </TableCell>
                  <TableCell className="max-w-[460px]">
                    <div className="truncate font-medium">{displayTitle(row)}</div>
                    <div className="mt-1 truncate text-xs text-[var(--muted)]">
                      {filterSummary(row.metadata)}
                    </div>
                    {row.job?.errorMessage ? (
                      <div className="mt-1 line-clamp-2 text-xs text-[var(--danger)]">
                        {row.job.errorMessage}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="max-w-[260px]">
                    <FileSummary files={row.files} />
                  </TableCell>
                  <TableCell className="data-digits text-xs">
                    {formatDateTime(row.updatedAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {row.job?.status === "failed" ? (
                        <form action={retryJobAction}>
                          <input type="hidden" name="id" value={row.job.id} />
                          <Button size="icon" variant="ghost" aria-label="重试">
                            <RotateCcw className="size-4" />
                          </Button>
                        </form>
                      ) : null}
                      {row.job?.status === "needs_review" ? (
                        <form action={confirmJobAction}>
                          <input type="hidden" name="id" value={row.job.id} />
                          <Button size="icon" variant="ghost" aria-label="确认下载">
                            <CheckCircle2 className="size-4" />
                          </Button>
                        </form>
                      ) : null}
                      <EpisodeDetails row={row} />
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        <TablePagination
          page={pageData.page - 1}
          pageCount={pageData.pageCount}
          pageSize={pageData.pageSize}
          total={pageData.total}
          onPageChange={(nextPage) =>
            updateEpisodeParams({ page: nextPage + 1 })
          }
          onPageSizeChange={(nextPageSize) => {
            updateEpisodeParams({ pageSize: nextPageSize });
          }}
        />
      </CardContent>
    </Card>
  );
}

function ManualSupplementDialog({
  pageData
}: {
  pageData: DashboardData["episodePage"];
}) {
  const defaultSubscriptionId =
    pageData.filters.subscriptionId ??
    pageData.manualSubscriptionOptions[0]?.id ??
    "";

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="signal"
          disabled={pageData.manualSubscriptionOptions.length === 0}
        >
          <Plus className="size-4" />
          手动增补
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>手动增补 Episode</DialogTitle>
          <DialogDescription>
            用外部 magnet 或 torrent 链接补一集，提交后直接进入 OpenList 离线队列。
          </DialogDescription>
        </DialogHeader>
        <form action={manualSupplementEpisodeAction} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="manual-subscription">订阅</Label>
            <select
              id="manual-subscription"
              name="subscriptionId"
              defaultValue={defaultSubscriptionId}
              required
              className="flex h-9 w-full rounded-[var(--radius)] border border-[var(--line)] bg-white px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--signal)]"
            >
              {pageData.manualSubscriptionOptions.map((subscription) => (
                <option key={subscription.id} value={subscription.id}>
                  {subscription.name} / {seasonLabel(subscription.seasonNumber)}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="manual-episode">集数</Label>
              <Input
                id="manual-episode"
                name="episodeNumber"
                type="number"
                min={0}
                max={999}
                required
                placeholder="2"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="manual-revision">修正版</Label>
              <Input
                id="manual-revision"
                name="releaseRevision"
                type="number"
                min={2}
                max={99}
                placeholder="v2 填 2"
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="manual-source">下载链接</Label>
            <Input
              id="manual-source"
              name="sourceUrl"
              required
              placeholder="magnet:?xt=urn:btih:... 或 https://...torrent"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="manual-title">发布标题</Label>
            <Input
              id="manual-title"
              name="title"
              placeholder="留空则按订阅名、集数和筛选规则生成"
            />
          </div>
          <div className="flex justify-end">
            <Button type="submit" variant="signal">
              <Plus className="size-4" />
              加入队列
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EpisodeStatus({ row }: { row: DashboardEpisodeRow }) {
  const failedFile = row.files.find((file) => file.status === "failed");
  const renamedFile = row.files.find((file) => file.status === "renamed");
  if (failedFile) return <Badge variant="danger">整理失败</Badge>;
  if (renamedFile) return <Badge variant="signal">已整理</Badge>;
  if (row.job) return <StatusBadge status={row.job.status} />;
  if (row.files.length > 0) return <Badge variant="muted">文件记录</Badge>;
  return <Badge variant="amber">待入队</Badge>;
}

function FileSummary({ files }: { files: DashboardEpisodeRow["files"] }) {
  if (files.length === 0) {
    return <span className="text-xs text-[var(--muted)]">未发现文件</span>;
  }
  const first = files[0];
  return (
    <div className="flex min-w-0 items-start gap-2 text-xs">
      <FileVideo className="mt-0.5 size-4 shrink-0 text-[var(--signal)]" />
      <div className="min-w-0">
        <div className="truncate data-digits">
          {first.finalPath ?? first.originalPath}
        </div>
        <div className="mt-1 text-[var(--muted)]">
          {formatFileSize(first.sizeBytes)}
          {files.length > 1 ? ` / ${files.length} 个文件` : ""}
        </div>
      </div>
    </div>
  );
}

function EpisodeDetails({ row }: { row: DashboardEpisodeRow }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" size="icon" variant="ghost" aria-label="查看详情">
          <Eye className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[86vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-8">{displayTitle(row)}</DialogTitle>
          <DialogDescription>{filterSummary(row.metadata)}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <DetailSection icon={<Rss className="size-4" />} title="RSS">
            <DetailItem label="标题" value={row.item?.title} />
            <DetailItem label="GUID" value={row.item?.rssGuid} mono />
            <DetailItem label="发布页" value={row.item?.link} mono />
            <DetailItem label="下载链接" value={row.item?.downloadUrl} mono />
            <DetailItem
              label="发布日期"
              value={formatOptionalDateTime(row.item?.publishedAt)}
            />
            <DetailItem label="首次发现" value={formatDateTime(row.item?.firstSeenAt)} />
          </DetailSection>

          <DetailSection icon={<AlertTriangle className="size-4" />} title="识别结果">
            <DetailItem label="集数" value={episodeLabel(row, row.metadata)} mono />
            <DetailItem label="字幕组" value={row.metadata?.releaseGroup} />
            <DetailItem label="分辨率" value={row.metadata?.resolution} />
            <DetailItem label="字幕" value={row.metadata?.subtitleLanguage} />
          </DetailSection>

          <DetailSection icon={<PlayCircle className="size-4" />} title="下载任务">
            <DetailItem label="任务" value={row.job?.id.toString()} mono />
            <DetailItem label="OpenList" value={row.job?.openlistTaskId} mono />
            <DetailItem label="下载链接" value={row.job?.sourceUrl} mono />
            <DetailItem label="目标路径" value={row.job?.targetPath} mono />
            <DetailItem label="尝试次数" value={row.job?.attempts.toString()} mono />
            <DetailItem label="错误" value={row.job?.errorMessage} />
          </DetailSection>

          <DetailSection icon={<FileVideo className="size-4" />} title="文件">
            {row.files.length === 0 ? (
              <div className="text-sm text-[var(--muted)]">还没有文件记录。</div>
            ) : (
              row.files.map((file) => (
                <div
                  key={file.id}
                  className="rounded-[var(--radius)] border border-[var(--line)] p-3"
                >
                  <DetailItem label="原路径" value={file.originalPath} mono />
                  <DetailItem label="最终路径" value={file.finalPath} mono />
                  <DetailItem label="大小" value={formatFileSize(file.sizeBytes)} mono />
                  <DetailItem label="状态" value={file.status} mono />
                  <DetailItem label="错误" value={file.errorMessage} />
                </div>
              ))
            )}
          </DetailSection>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DetailSection({
  icon,
  title,
  children
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <span className="text-[var(--signal)]">{icon}</span>
        {title}
      </div>
      <div className="grid gap-2 rounded-[var(--radius)] bg-[var(--panel-strong)] p-3">
        {children}
      </div>
    </section>
  );
}

function DetailItem({
  label,
  value,
  mono
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
}) {
  return (
    <div className="grid gap-1 text-sm sm:grid-cols-[90px_minmax(0,1fr)]">
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

function episodeLabel(
  row: Pick<DashboardEpisodeRow, "episodeNumber" | "episodeText">,
  metadata?: ReleaseMetadata | null
) {
  const revision =
    metadata?.releaseRevision && metadata.releaseRevision > 1
      ? ` v${metadata.releaseRevision}`
      : "";
  return `${episodeNumberLabel(row)}${revision}`;
}

function episodeNumberLabel(
  row: Pick<DashboardEpisodeRow, "episodeNumber" | "episodeText">
) {
  if (row.episodeNumber != null) {
    return `EP${String(row.episodeNumber).padStart(2, "0")}`;
  }
  return row.episodeText || "未解析";
}

function displayTitle(row: DashboardEpisodeRow) {
  return `${row.subscriptionName} / ${seasonLabel(row.seasonNumber)} / ${episodeLabel(row, row.metadata)}`;
}

function seasonLabel(seasonNumber: number | null) {
  if (seasonNumber == null) return "S--";
  return `S${String(seasonNumber).padStart(2, "0")}`;
}

function formatOptionalDateTime(value?: string | null) {
  return value ? formatDateTime(value) : null;
}

function filterSummary(metadata: ReleaseMetadata | null) {
  const values = [
    metadata?.releaseGroup,
    metadata?.resolution,
    metadata?.subtitleLanguage
  ].filter((value): value is string => Boolean(value));
  return values.length > 0 ? values.join(" / ") : "无筛选标签";
}

function setOrDelete(
  params: URLSearchParams,
  key: string,
  value: string,
  emptyValue: string
) {
  if (!value || value === emptyValue) {
    params.delete(key);
    return;
  }
  params.set(key, value);
}
