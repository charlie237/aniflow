"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader
} from "@/components/ui/card";
import { CountUp, StaggerChildren } from "@/components/motion";

/** Hero stats: one orchestrated entrance (stagger + count-up). */
export function DashboardMotion({
  stats
}: {
  stats: Array<{ label: string; value: number }>;
}) {
  return (
    <StaggerChildren
      className="grid gap-3 md:grid-cols-5"
      y={10}
      duration={0.34}
      stagger={0.05}
    >
      {stats.map((stat) => (
        <Card key={stat.label} className="overflow-hidden">
          <CardHeader className="pb-2">
            <CardDescription>{stat.label}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="scanline rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-2">
              <CountUp
                value={stat.value}
                className="data-digits text-3xl font-semibold"
              />
            </div>
          </CardContent>
        </Card>
      ))}
    </StaggerChildren>
  );
}
