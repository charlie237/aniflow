"use client";

import { useMemo, useState } from "react";
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
import { StatusBadge } from "@/components/status-badge";
import { TagRow } from "@/components/tag-row";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils";
import type { DashboardData } from "@/lib/db/types";

type RssFilter = "matched" | "tasked" | "all";

export function RssFeedTable({ items }: { items: DashboardData["rssItems"] }) {
  const [subscriptionId, setSubscriptionId] = useState("all");
  const [filter, setFilter] = useState<RssFilter>("all");
  const matchedItems = useMemo(
    () => items.filter((item) => item.ruleAllowed),
    [items]
  );
  const subscriptionOptions = useMemo(
    () =>
      Array.from(
        new Map(
          matchedItems.map((item) => [
            item.subscriptionId,
            {
              id: item.subscriptionId,
              name: item.subscriptionName
            }
          ])
        ).values()
      ),
    [matchedItems]
  );
  const subscriptionItems = useMemo(
    () =>
      matchedItems.filter(
        (item) => subscriptionId === "all" || item.subscriptionId === Number(subscriptionId)
      ),
    [matchedItems, subscriptionId]
  );
  const filteredItems = useMemo(
    () =>
      subscriptionItems.filter((item) => {
        if (filter === "tasked") return Boolean(item.job);
        if (filter === "matched") return !item.job;
        return true;
      }),
    [filter, subscriptionItems]
  );
  const counts = useMemo(
    () => ({
      matched: subscriptionItems.filter((item) => !item.job).length,
      tasked: subscriptionItems.filter((item) => item.job).length,
      all: subscriptionItems.length
    }),
    [subscriptionItems]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>RSS 记录</CardTitle>
        <CardDescription>
          本地缓存中命中规则的 RSS 条目；下载进度看任务。
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap gap-2">
          <select
            value={subscriptionId}
            onChange={(event) => setSubscriptionId(event.target.value)}
            className="h-8 min-w-[160px] rounded-[var(--radius)] border border-[var(--line)] bg-white px-2.5 text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--signal)]"
          >
            <option value="all">全部订阅</option>
            {subscriptionOptions.map((subscription) => (
              <option key={subscription.id} value={subscription.id}>
                {subscription.name}
              </option>
            ))}
          </select>
          {[
            ["all", "全部命中", counts.all],
            ["matched", "待建任务", counts.matched],
            ["tasked", "已入任务", counts.tasked],
          ].map(([value, label, count]) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={filter === value ? "signal" : "outline"}
              onClick={() => setFilter(value as RssFilter)}
            >
              {label}
              <span className="data-digits text-xs opacity-70">{count}</span>
            </Button>
          ))}
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>发布</TableHead>
              <TableHead>解析</TableHead>
              <TableHead>任务</TableHead>
              <TableHead className="w-28">发现</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredItems.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center text-[var(--muted)]">
                  当前筛选下没有命中 RSS。
                </TableCell>
              </TableRow>
            ) : (
              filteredItems.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="max-w-[420px]">
                    <div className="truncate font-medium">{item.title}</div>
                    <div className="mt-1 text-xs text-[var(--muted)]">
                      {item.subscriptionName}
                    </div>
                    <div className="mt-1 max-w-[420px] truncate data-digits text-xs text-[var(--muted)]">
                      {item.downloadUrl ?? item.link ?? "-"}
                    </div>
                  </TableCell>
                  <TableCell>
                    <TagRow metadata={item.metadata} />
                  </TableCell>
                  <TableCell>
                    {item.job ? (
                      <StatusBadge status={item.job.status} />
                    ) : item.ruleAllowed ? (
                      <Badge variant="amber">待建任务</Badge>
                    ) : (
                      <Badge variant="muted">无</Badge>
                    )}
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
