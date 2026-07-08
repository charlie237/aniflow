import { Search } from "lucide-react";
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

export function RssPreviewPanel({
  preview,
  error,
  initialUrl
}: {
  preview: RssPreview | null;
  error?: string | null;
  initialUrl?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>RSS 预解析</CardTitle>
        <CardDescription>
          输入 RSS URL 后读取发布列表，下面的订阅控件只使用解析出来的候选值。
        </CardDescription>
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
            解析
          </Button>
        </form>

        {error ? (
          <div className="rounded-[var(--radius)] border border-[#d92d2040] bg-[#d92d2012] p-3 text-sm text-[var(--danger)]">
            {error}
          </div>
        ) : null}

        {preview ? (
          <div className="grid gap-4">
            <div className="grid gap-3 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel-strong)] p-3 md:grid-cols-5">
              <Facet label="推荐名称" values={preview.title ? [preview.title] : []} />
              <Facet label="字幕组" values={preview.groups} />
              <Facet label="分辨率" values={preview.resolutions} />
              <Facet label="字幕语言" values={preview.languages} />
              <Facet label="编码/来源" values={[...preview.codecs, ...preview.sources]} />
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>发布标题</TableHead>
                  <TableHead>解析结果</TableHead>
                  <TableHead className="w-24">集数</TableHead>
                  <TableHead className="w-28">置信度</TableHead>
                  <TableHead>下载链接</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.items.map((item) => (
                  <TableRow key={`${item.guid}-${item.title}`}>
                    <TableCell className="max-w-[360px]">
                      <div className="truncate font-medium">{item.title}</div>
                      <div className="mt-1 text-xs text-[var(--muted)]">
                        {item.metadata.parsedTitle ?? "未识别标题"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <TagRow metadata={{ ...item.metadata, id: 0, feedItemId: 0 }} />
                    </TableCell>
                    <TableCell className="data-digits">
                      {item.metadata.episodeNumber != null
                        ? String(item.metadata.episodeNumber).padStart(2, "0")
                        : "-"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          item.metadata.needsReview
                            ? "amber"
                            : item.metadata.parseConfidence >= 70
                              ? "signal"
                              : "muted"
                        }
                      >
                        {item.metadata.parseConfidence}%
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[260px] truncate data-digits text-xs">
                      {item.downloadUrl ?? item.link ?? "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Facet({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="min-w-0">
      <div className="mb-2 text-xs font-medium text-[var(--muted)]">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {values.length > 0 ? (
          values.slice(0, 8).map((value) => (
            <Badge key={value} variant="default">
              {value}
            </Badge>
          ))
        ) : (
          <Badge variant="muted">无</Badge>
        )}
      </div>
    </div>
  );
}
