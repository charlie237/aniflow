import { FileVideo } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { formatDateTime, formatFileSize } from "@/lib/utils";
import type { EpisodeFile } from "@/lib/db/types";

export function FileTable({ files }: { files: EpisodeFile[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>文件整理</CardTitle>
        <CardDescription>Worker 从下载目录扫描媒体文件后移动到媒体库目录。</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>原路径</TableHead>
              <TableHead>最终路径</TableHead>
              <TableHead className="w-24">状态</TableHead>
              <TableHead className="w-24">大小</TableHead>
              <TableHead className="w-28">更新</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {files.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-[var(--muted)]">
                  还没有整理记录。
                </TableCell>
              </TableRow>
            ) : (
              files.map((file) => (
                <TableRow key={file.id}>
                  <TableCell className="max-w-[320px] text-xs">
                    <div className="flex min-w-0 items-start gap-2">
                      <FileVideo className="mt-0.5 size-4 shrink-0 text-[var(--signal)]" />
                      <div className="min-w-0">
                        <div className="truncate data-digits">{file.originalPath}</div>
                        {file.errorMessage ? (
                          <div className="mt-1 text-[var(--danger)]">
                            {file.errorMessage}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[360px] truncate data-digits text-xs">
                    {file.finalPath ?? "-"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        file.status === "renamed"
                          ? "signal"
                          : file.status === "failed"
                            ? "danger"
                            : "muted"
                      }
                    >
                      {file.status === "renamed"
                        ? "已整理"
                        : file.status === "failed"
                          ? "失败"
                          : "已发现"}
                    </Badge>
                  </TableCell>
                  <TableCell className="data-digits text-xs">
                    {formatFileSize(file.sizeBytes)}
                  </TableCell>
                  <TableCell className="data-digits text-xs">
                    {formatDateTime(file.updatedAt)}
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
