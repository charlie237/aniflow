"use client";

import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { useI18n } from "@/components/locale-provider";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import type { WeeklyScheduleEntry } from "@/lib/db/types";
import { cn } from "@/lib/utils";

// Display Monday -> Sunday (1, 2, 3, 4, 5, 6, 0).
const DISPLAY_DAYS = [1, 2, 3, 4, 5, 6, 0] as const;

export function ScheduleStrip({
  entries,
  todayWeekday
}: {
  entries: WeeklyScheduleEntry[];
  todayWeekday: number;
}) {
  const { t } = useI18n();
  if (entries.length === 0) return null;

  const byDay = new Map<number, WeeklyScheduleEntry[]>();
  for (const entry of entries) {
    const list = byDay.get(entry.weekday) ?? [];
    list.push(entry);
    byDay.set(entry.weekday, list);
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <CalendarDays className="size-4 text-[var(--signal)]" />
          {t("schedule.title")}
        </CardTitle>
        <CardDescription>{t("schedule.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-7">
          {DISPLAY_DAYS.map((day) => {
            const isToday = day === todayWeekday;
            const dayEntries = byDay.get(day) ?? [];
            return (
              <div
                key={day}
                className={cn(
                  "flex min-h-[86px] flex-col gap-1.5 rounded-[var(--radius)] border p-2.5",
                  isToday
                    ? "border-[var(--signal-soft-border)] bg-[var(--signal-soft)]/50"
                    : "border-[var(--line)] bg-[var(--panel-muted)]"
                )}
              >
                <div className="flex items-center justify-between gap-1 text-xs font-medium">
                  <span
                    className={
                      isToday ? "text-[var(--signal-text)]" : "text-[var(--muted)]"
                    }
                  >
                    {t(`schedule.days.${day}`)}
                  </span>
                  {isToday ? (
                    <Badge variant="signal" className="px-1.5 py-0 text-[10px]">
                      {t("schedule.today")}
                    </Badge>
                  ) : null}
                </div>
                {dayEntries.length === 0 ? (
                  <div className="mt-auto text-[11px] text-[var(--muted)] opacity-60">
                    -
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    {dayEntries.map((item) => (
                      <Link
                        key={item.subscriptionId}
                        href={`/?episodeSubscriptionId=${item.subscriptionId}`}
                        className="group rounded-[6px] border border-[var(--line)] bg-[var(--panel)] px-2 py-1 text-xs transition-colors hover:border-[var(--signal)]"
                      >
                        <div className="truncate font-medium group-hover:text-[var(--signal-text)]">
                          {item.name}
                        </div>
                        <div className="data-digits text-[10px] text-[var(--muted)]">
                          S{String(item.seasonNumber).padStart(2, "0")}
                          {item.latestEpisode != null
                            ? ` · EP${String(item.latestEpisode).padStart(2, "0")}`
                            : ""}
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
