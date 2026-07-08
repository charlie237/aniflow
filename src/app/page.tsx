import { Activity, DownloadCloud, Play, RotateCw, Tags } from "lucide-react";
import { pollSubscriptionAction, submitQueueAction } from "@/app/actions";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader
} from "@/components/ui/card";
import { FileTable } from "@/components/file-table";
import { JobTable } from "@/components/job-table";
import { ReleaseTable } from "@/components/release-table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getDashboardData } from "@/lib/db/repositories";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const data = getDashboardData();

  return (
    <AppShell>
      <section className="border-b border-[var(--line)] bg-white/78 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-6 md:px-6">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel-strong)] px-2.5 py-1 text-xs font-medium text-[var(--muted)]">
                <Activity className="size-3.5 text-[var(--signal)]" />
                RSS / OpenList / 115 media flow
              </div>
              <h1 className="text-3xl font-semibold tracking-normal md:text-4xl">
                运行总览
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
                这里看任务、发布和文件整理状态；订阅和连接参数分别在独立页面维护。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <form action={submitQueueAction}>
                <Button variant="outline">
                  <DownloadCloud className="size-4" />
                  提交队列
                </Button>
              </form>
              {data.subscriptions.map((subscription) => (
                <form key={subscription.id} action={pollSubscriptionAction}>
                  <input type="hidden" name="id" value={subscription.id} />
                  <Button variant="signal">
                    <RotateCw className="size-4" />
                    轮询 {subscription.name}
                  </Button>
                </form>
              ))}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <Stat label="启用订阅" value={data.stats.activeSubscriptions} />
            <Stat label="队列任务" value={data.stats.queuedJobs} />
            <Stat label="待确认" value={data.stats.needsReview} />
            <Stat label="已完成" value={data.stats.completedJobs} />
          </div>
        </div>
      </section>

      <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6">
        <Tabs defaultValue="episodes">
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
            <TabsList>
              <TabsTrigger value="episodes">
                <Tags className="mr-2 size-4" />
                发布
              </TabsTrigger>
              <TabsTrigger value="jobs">
                <Play className="mr-2 size-4" />
                任务
              </TabsTrigger>
              <TabsTrigger value="files">文件</TabsTrigger>
            </TabsList>
            <div className="text-xs text-[var(--muted)]">
              最新轮询：
              <span className="data-digits ml-1">
                {formatDateTime(
                  data.subscriptions
                    .map((item) => item.lastPolledAt)
                    .filter(Boolean)
                    .sort()
                    .at(-1) ?? null
                )}
              </span>
            </div>
          </div>

          <TabsContent value="episodes">
            <ReleaseTable items={data.feedItems} />
          </TabsContent>
          <TabsContent value="jobs">
            <JobTable jobs={data.jobs} />
          </TabsContent>
          <TabsContent value="files">
            <FileTable files={data.episodeFiles} />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="scanline rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-2">
          <span className="data-digits text-3xl font-semibold">{value}</span>
          <Badge className="ml-2" variant={value > 0 ? "signal" : "muted"}>
            live
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}
