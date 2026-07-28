"use client";

import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import { TagRow } from "@/components/tag-row";
import type { RssPreview } from "@/lib/rss/preview";

const PAGE_SIZE = 20;
const FACET_VISIBLE_LIMIT = 4;

export function RssPreviewPanel({
  preview,
  error,
  initialUrl
}: {
  preview: RssPreview | null;
  error?: string | null;
  initialUrl?: string;
}) {
  const { t } = useI18n();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("rssPreview.title")}</CardTitle>
        <CardDescription>{t("rssPreview.description")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <form className="grid gap-2 md:grid-cols-[1fr_auto]" action="/subscriptions">
          <div className="grid gap-1.5">
            <Label htmlFor="rssUrl">RSS URL</Label>
            <Input
              id="rssUrl"
              name="rssUrl"
              defaultValue={initialUrl}
              placeholder="https://mikanani.me/RSS/Bangumi?bangumiId=3980"
            />
          </div>
          <Button type="submit" variant="signal" className="mt-6">
            <Search className="size-4" />
            {t("rssPreview.parse")}
          </Button>
        </form>

        {error ? (
          <div className="rounded-[var(--radius)] border border-[var(--danger-soft-border)] bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger-text)]">
            {error}
          </div>
        ) : null}

        {preview ? <RssPreviewResults preview={preview} /> : null}
      </CardContent>
    </Card>
  );
}

function RssPreviewResults({ preview }: { preview: RssPreview }) {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(preview.items.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const visibleItems = useMemo(
    () => preview.items.slice(startIndex, startIndex + PAGE_SIZE),
    [preview.items, startIndex]
  );

  useEffect(() => {
    setPage(1);
  }, [preview.url, preview.items.length]);

  return (
    <div className="grid gap-4">
      <div className="grid gap-2 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel-strong)] p-2 md:grid-cols-3 xl:grid-cols-5">
        <Facet
          label={t("rssPreview.facetTitle")}
          values={preview.title ? [preview.title] : []}
        />
        {preview.seasons.length > 0 ? (
          <Facet
            label={t("rssPreview.facetSeason")}
            values={preview.seasons.map((season) => String(season))}
          />
        ) : null}
        <Facet label={t("rssPreview.facetGroup")} values={preview.groups} />
        <Facet
          label={t("rssPreview.facetResolution")}
          values={preview.resolutions}
        />
        <Facet
          label={t("rssPreview.facetLanguage")}
          values={preview.languages}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-[var(--muted)]">
        <span className="data-digits">
          {preview.items.length === 0
            ? t("rssPreview.zeroItems")
            : t("rssPreview.rangeItems", {
                from: startIndex + 1,
                to: Math.min(startIndex + PAGE_SIZE, preview.items.length),
                total: preview.items.length
              })}
        </span>
        {preview.items.length > PAGE_SIZE ? (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={currentPage <= 1}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
            >
              <ChevronLeft className="size-4" />
              {t("common.prevPage")}
            </Button>
            <span className="data-digits text-xs">
              {currentPage} / {pageCount}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={currentPage >= pageCount}
              onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
            >
              {t("common.nextPage")}
              <ChevronRight className="size-4" />
            </Button>
          </div>
        ) : null}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("rssPreview.colTitle")}</TableHead>
            <TableHead>{t("rssPreview.colParsed")}</TableHead>
            <TableHead className="w-24">{t("rssPreview.colEpisode")}</TableHead>
            <TableHead>{t("rssPreview.colDownload")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleItems.map((item, index) => (
            <TableRow
              key={`${index}:${item.guid}:${item.downloadUrl ?? item.link ?? item.title}`}
            >
              <TableCell className="max-w-[360px]">
                <div className="truncate font-medium">{item.title}</div>
                <div className="mt-1 text-xs text-[var(--muted)]">
                  {item.metadata.parsedTitle ?? t("rssPreview.unparsedTitle")}
                </div>
              </TableCell>
              <TableCell>
                <TagRow metadata={{ ...item.metadata, id: 0, feedItemId: 0 }} />
              </TableCell>
              <TableCell className="data-digits">
                <SeasonEpisode metadata={item.metadata} />
              </TableCell>
              <TableCell className="max-w-[260px] truncate data-digits text-xs">
                {item.downloadUrl ?? item.link ?? "-"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function Facet({ label, values }: { label: string; values: string[] }) {
  const { t } = useI18n();
  const visibleValues = values.slice(0, FACET_VISIBLE_LIMIT);
  const hiddenCount = Math.max(0, values.length - visibleValues.length);

  return (
    <div className="min-w-0 rounded-[6px] px-1 py-1">
      <div className="mb-1.5 flex items-center justify-between gap-2 text-xs font-medium text-[var(--muted)]">
        <span>{label}</span>
        {values.length > 0 ? (
          <span className="data-digits">{values.length}</span>
        ) : null}
      </div>
      <div className="flex min-h-7 flex-wrap gap-1">
        {values.length > 0 ? (
          <>
            {visibleValues.map((value) => (
              <Badge
                key={value}
                variant="default"
                className="max-w-full truncate px-1.5"
                title={value}
              >
                {value}
              </Badge>
            ))}
            {hiddenCount > 0 ? (
              <Badge variant="muted" className="px-1.5" title={values.join(" / ")}>
                +{hiddenCount}
              </Badge>
            ) : null}
          </>
        ) : (
          <Badge variant="muted" className="px-1.5">
            {t("common.none")}
          </Badge>
        )}
      </div>
    </div>
  );
}

function SeasonEpisode({
  metadata
}: {
  metadata: RssPreview["items"][number]["metadata"];
}) {
  const parts = [
    metadata.seasonNumber != null
      ? `S${String(metadata.seasonNumber).padStart(2, "0")}`
      : null,
    metadata.episodeNumber != null
      ? `E${String(metadata.episodeNumber).padStart(2, "0")}`
      : null
  ].filter(Boolean);
  const label = parts.length > 0 ? parts.join(" / ") : "-";
  return metadata.releaseRevision > 1
    ? `${label} v${metadata.releaseRevision}`
    : label;
}
