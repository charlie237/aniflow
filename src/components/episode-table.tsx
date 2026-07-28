"use client";

import type { ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Eye,
  FileVideo,
  FolderSync,
  PlayCircle,
  Plus,
  RotateCcw,
  Rss,
  RadioTower,
  X
} from "lucide-react";
import {
  confirmJobAction,
  manualSupplementEpisodeAction,
  reorganizeJobAction,
  retryJobAction
} from "@/app/actions";
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
  cn,
  formatFileSize
} from "@/lib/utils";
import type { TranslateFn } from "@/lib/i18n";
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
  const { t, formatDateTime } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const scopeValue =
    pageData.filters.subscriptionId == null
      ? "all"
      : `${pageData.filters.subscriptionId}:${pageData.filters.season ?? ""}`;
  const statusValue = pageData.filters.status;
  const subscriptionState = pageData.filters.subscriptionState;
  const hasExplicitFilters = [
    "episodeSubscriptionId",
    "episodeSubscriptionState",
    "episodeSeason",
    "episodeStatus",
    "episodePage"
  ].some((key) => searchParams.has(key));
  const statusTabs: Array<{
    value: EpisodeStatusFilter;
    label: string;
    count: number;
  }> = [
    { value: "all", label: t("status.filter.all"), count: pageData.counts.all },
    { value: "active", label: t("status.filter.active"), count: pageData.counts.active },
    { value: "waiting", label: t("status.filter.waiting"), count: pageData.counts.waiting },
    { value: "failed", label: t("status.filter.failed"), count: pageData.counts.failed },
    { value: "completed", label: t("status.filter.completed"), count: pageData.counts.completed }
  ];

  function updateEpisodeParams(
    updates: Partial<{
      subscriptionId: string;
      subscriptionState: "active" | "archived";
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
    if (updates.subscriptionState !== undefined) {
      setOrDelete(
        params,
        "episodeSubscriptionState",
        updates.subscriptionState,
        "active"
      );
      params.delete("episodeSubscriptionId");
      params.delete("episodeSeason");
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
      "episodeSubscriptionState",
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
          {t("episode.title")}
        </CardTitle>
        <CardDescription>
          {t("episode.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel-muted)]">
          <div className="flex flex-col gap-2 border-b border-[var(--line)] px-2.5 py-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <div
                className="inline-flex h-8 items-center rounded-[var(--radius-sm)] bg-[var(--panel-strong)] p-0.5"
                role="group"
                aria-label={t("episode.tracking")}
              >
                <button
                  type="button"
                  onClick={() =>
                    updateEpisodeParams({ subscriptionState: "active" })
                  }
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-xs font-medium transition-colors",
                    subscriptionState === "active"
                      ? "bg-[var(--panel)] text-[var(--foreground)] shadow-[var(--shadow)]"
                      : "text-[var(--muted)] hover:text-[var(--foreground)]"
                  )}
                >
                  <RadioTower className="size-3.5" />
                  {t("episode.tracking")}
                  <span className="data-digits opacity-60">
                    {pageData.subscriptionCounts.active}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    updateEpisodeParams({ subscriptionState: "archived" })
                  }
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-xs font-medium transition-colors",
                    subscriptionState === "archived"
                      ? "bg-[var(--panel)] text-[var(--foreground)] shadow-[var(--shadow)]"
                      : "text-[var(--muted)] hover:text-[var(--foreground)]"
                  )}
                >
                  <Archive className="size-3.5" />
                  {t("episode.archived")}
                  <span className="data-digits opacity-60">
                    {pageData.subscriptionCounts.archived}
                  </span>
                </button>
              </div>
              <select
                value={scopeValue}
                onChange={(event) => updateEpisodeScope(event.target.value)}
                className="h-8 min-w-0 max-w-full flex-1 basis-[11rem] rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--input)] px-2.5 text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--signal)] sm:max-w-[16rem] sm:flex-none sm:basis-auto sm:min-w-[11rem]"
              >
                <option value="all">
                  {subscriptionState === "active"
                    ? t("episode.allTracking")
                    : t("episode.allArchived")}
                </option>
                {pageData.subscriptionOptions.map((subscription) => (
                  <option
                    key={`${subscription.id}:${subscription.seasonNumber}`}
                    value={`${subscription.id}:${subscription.seasonNumber}`}
                  >
                    {subscription.name} / {seasonLabel(subscription.seasonNumber)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={!hasExplicitFilters}
                onClick={clearEpisodeFilters}
                className="h-8 text-xs text-[var(--muted)]"
              >
                <X className="size-3.5" />
                {t("episode.clearFilters")}
              </Button>
              <ManualSupplementDialog pageData={pageData} />
            </div>
          </div>
          <div
            className="flex gap-0.5 overflow-x-auto px-1.5 py-1.5"
            role="tablist"
            aria-label={t("episode.colStatus")}
          >
            {statusTabs.map(({ value, label, count }) => {
              const active = statusValue === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => updateEpisodeParams({ status: value })}
                  className={cn(
                    "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] px-2.5 text-xs font-medium transition-colors",
                    active
                      ? "bg-[var(--signal-soft)] text-[var(--signal-text)]"
                      : "text-[var(--muted)] hover:bg-[var(--panel-strong)] hover:text-[var(--foreground)]"
                  )}
                >
                  {label}
                  <span
                    className={cn(
                      "data-digits rounded-full px-1.5 py-px text-[10px] leading-4",
                      active
                        ? "bg-[var(--signal)] text-[var(--signal-foreground)]"
                        : "bg-[var(--panel-strong)] text-[var(--muted)]"
                    )}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">{t("episode.colStatus")}</TableHead>
              <TableHead>{t("episode.colRelease")}</TableHead>
              <TableHead>{t("episode.colFile")}</TableHead>
              <TableHead className="w-28">{t("episode.colPublished")}</TableHead>
              <TableHead className="w-24 text-right">{t("episode.colActions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageData.rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-[var(--muted)]">
                  {t("episode.empty")}
                </TableCell>
              </TableRow>
            ) : (
              pageData.rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <EpisodeStatus row={row} />
                  </TableCell>
                  <TableCell className="max-w-[460px]">
                    <div className="truncate font-medium">{displayTitle(row, t)}</div>
                    <div className="mt-1 truncate text-xs text-[var(--muted)]">
                      {filterSummary(row.metadata, t)}
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
                    {formatDateTime(
                      row.item?.publishedAt ?? row.item?.firstSeenAt ?? row.updatedAt
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {row.job?.status === "failed" ? (
                        <>
                          <form action={retryJobAction}>
                            <input type="hidden" name="id" value={row.job.id} />
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={t("episode.retryDownload")}
                              title={t("episode.retryDownloadTitle")}
                            >
                              <RotateCcw className="size-4" />
                            </Button>
                          </form>
                          <form action={reorganizeJobAction}>
                            <input type="hidden" name="id" value={row.job.id} />
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={t("episode.reorganize")}
                              title={t("episode.reorganizeTitle")}
                            >
                              <FolderSync className="size-4" />
                            </Button>
                          </form>
                        </>
                      ) : null}
                      {row.job?.status === "needs_review" ||
                      row.job?.status === "discovered" ? (
                        <form action={confirmJobAction}>
                          <input type="hidden" name="id" value={row.job.id} />
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={t("episode.confirmDownload")}
                            title={t("episode.confirmDownloadTitle")}
                          >
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
  const { t } = useI18n();
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
          className="h-8 text-xs"
        >
          <Plus className="size-3.5" />
          {t("episode.manual")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("episode.manualTitle")}</DialogTitle>
          <DialogDescription>
            {t("episode.manualDescription")}
          </DialogDescription>
        </DialogHeader>
        <form action={manualSupplementEpisodeAction} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="manual-subscription">{t("episode.subscription")}</Label>
            <select
              id="manual-subscription"
              name="subscriptionId"
              defaultValue={defaultSubscriptionId}
              required
              className="flex h-9 w-full rounded-[var(--radius)] border border-[var(--line)] bg-[var(--input)] px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--signal)]"
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
              <Label htmlFor="manual-episode">{t("episode.episodeNumber")}</Label>
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
              <Label htmlFor="manual-revision">{t("episode.revision")}</Label>
              <Input
                id="manual-revision"
                name="releaseRevision"
                type="number"
                min={2}
                max={99}
                placeholder={t("episode.revisionPlaceholder")}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="manual-source">{t("episode.sourceUrl")}</Label>
            <Input
              id="manual-source"
              name="sourceUrl"
              required
              placeholder={t("episode.sourcePlaceholder")}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="manual-title">{t("episode.releaseTitle")}</Label>
            <Input
              id="manual-title"
              name="title"
              placeholder={t("episode.titlePlaceholder")}
            />
          </div>
          <div className="flex justify-end">
            <Button type="submit" variant="signal">
              <Plus className="size-4" />
              {t("episode.enqueue")}
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
  const { t } = useI18n();
  if (failedFile) return <Badge variant="danger">{t("status.episode.organizeFailed")}</Badge>;
  if (renamedFile) return <Badge variant="signal">{t("status.episode.organized")}</Badge>;
  if (row.job) return <StatusBadge status={row.job.status} />;
  if (row.files.length > 0) return <Badge variant="muted">{t("status.episode.fileRecord")}</Badge>;
  return <Badge variant="amber">{t("status.episode.pendingQueue")}</Badge>;
}

function FileSummary({ files }: { files: DashboardEpisodeRow["files"] }) {
  const { t } = useI18n();
  if (files.length === 0) {
    return <span className="text-xs text-[var(--muted)]">{t("episode.noFile")}</span>;
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
          {files.length > 1 ? t("episode.multiFiles", { count: files.length }) : ""}
        </div>
      </div>
    </div>
  );
}

function EpisodeDetails({ row }: { row: DashboardEpisodeRow }) {
  const { t, formatDateTime } = useI18n();
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" size="icon" variant="ghost" aria-label={t("common.viewDetails")}>
          <Eye className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[86vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-8">{displayTitle(row, t)}</DialogTitle>
          <DialogDescription>{filterSummary(row.metadata, t)}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <DetailSection icon={<Rss className="size-4" />} title={t("episode.detailRss")}>
            <DetailItem label={t("episode.detailTitle")} value={row.item?.title} />
            <DetailItem label={t("episode.detailGuid")} value={row.item?.rssGuid} mono />
            <DetailItem label={t("episode.detailLink")} value={row.item?.link} mono />
            <DetailItem label={t("episode.detailDownload")} value={row.item?.downloadUrl} mono />
            <DetailItem
              label={t("episode.detailPublished")}
              value={formatOptionalDateTime(row.item?.publishedAt, formatDateTime)}
            />
            <DetailItem label={t("episode.detailFirstSeen")} value={formatDateTime(row.item?.firstSeenAt)} />
          </DetailSection>

          <DetailSection icon={<AlertTriangle className="size-4" />} title={t("episode.detailParsed")}>
            <DetailItem label={t("episode.detailEpisode")} value={episodeLabel(row, row.metadata, t)} mono />
            <DetailItem label={t("episode.detailGroup")} value={row.metadata?.releaseGroup} />
            <DetailItem label={t("episode.detailResolution")} value={row.metadata?.resolution} />
            <DetailItem label={t("episode.detailSubtitle")} value={row.metadata?.subtitleLanguage} />
          </DetailSection>

          <DetailSection icon={<PlayCircle className="size-4" />} title={t("episode.detailJob")}>
            <DetailItem label={t("episode.detailJobId")} value={row.job?.id.toString()} mono />
            <DetailItem
              label={t("episode.colStatus")}
              value={row.job?.status ? t(`status.job.${row.job.status}`) : null}
            />
            <DetailItem label={t("episode.detailOpenlist")} value={row.job?.openlistTaskId} mono />
            <DetailItem label={t("episode.detailInfoHash")} value={row.job?.infoHash} mono />
            <DetailItem label={t("episode.detailOfflineName")} value={row.job?.offlineName} mono />
            <DetailItem label={t("episode.detailDownload")} value={row.job?.sourceUrl} mono />
            <DetailItem label={t("episode.detailTarget")} value={row.job?.targetPath} mono />
            <DetailItem label={t("episode.detailAttempts")} value={row.job?.attempts.toString()} mono />
            <DetailItem
              label={t("episode.detailScanMisses")}
              value={
                row.job?.status === "waiting_file" || (row.job?.scanMissCount ?? 0) > 0
                  ? String(row.job?.scanMissCount ?? 0)
                  : null
              }
              mono
            />
            <DetailItem label={t("episode.detailError")} value={row.job?.errorMessage} />
          </DetailSection>

          <DetailSection icon={<FileVideo className="size-4" />} title={t("episode.detailFiles")}>
            {row.files.length === 0 ? (
              <div className="text-sm text-[var(--muted)]">{t("episode.detailNoFiles")}</div>
            ) : (
              row.files.map((file) => (
                <div
                  key={file.id}
                  className="rounded-[var(--radius)] border border-[var(--line)] p-3"
                >
                  <DetailItem label={t("episode.detailOriginalPath")} value={file.originalPath} mono />
                  <DetailItem label={t("episode.detailFinalPath")} value={file.finalPath} mono />
                  <DetailItem label={t("episode.detailSize")} value={formatFileSize(file.sizeBytes)} mono />
                  <DetailItem label={t("episode.detailFileStatus")} value={file.status} mono />
                  <DetailItem label={t("episode.detailError")} value={file.errorMessage} />
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
  metadata: ReleaseMetadata | null | undefined,
  t: TranslateFn
) {
  const revision =
    metadata?.releaseRevision && metadata.releaseRevision > 1
      ? ` v${metadata.releaseRevision}`
      : "";
  return `${episodeNumberLabel(row, t)}${revision}`;
}

function episodeNumberLabel(
  row: Pick<DashboardEpisodeRow, "episodeNumber" | "episodeText">,
  t: TranslateFn
) {
  if (row.episodeNumber != null) {
    return `EP${String(row.episodeNumber).padStart(2, "0")}`;
  }
  return row.episodeText || t("episode.unparsed");
}

function displayTitle(row: DashboardEpisodeRow, t: TranslateFn) {
  return `${row.subscriptionName} / ${seasonLabel(row.seasonNumber)} / ${episodeLabel(row, row.metadata, t)}`;
}

function seasonLabel(seasonNumber: number | null) {
  if (seasonNumber == null) return "S--";
  return `S${String(seasonNumber).padStart(2, "0")}`;
}

function formatOptionalDateTime(
  value: string | null | undefined,
  formatDateTime: (value?: string | null) => string
) {
  return value ? formatDateTime(value) : null;
}

function filterSummary(metadata: ReleaseMetadata | null, t: TranslateFn) {
  const values = [
    metadata?.releaseGroup,
    metadata?.resolution,
    metadata?.subtitleLanguage
  ].filter((value): value is string => Boolean(value));
  return values.length > 0 ? values.join(" / ") : t("episode.noFilterTags");
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
