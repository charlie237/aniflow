import { Save } from "lucide-react";
import type { InputHTMLAttributes } from "react";
import {
  check115ConnectivityAction,
  saveSettingsAction
} from "@/app/actions";
import { ResetRuntimeDialog } from "@/components/reset-runtime-dialog";
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
import type { SystemSettings } from "@/lib/db/types";
import type { OpenList115CheckResult } from "@/lib/openlist/client";

export function SettingsForm({
  settings,
  checkResult,
  resetStatus
}: {
  settings: SystemSettings;
  checkResult?: OpenList115CheckResult | null;
  resetStatus?: "runtime" | "confirm" | null;
}) {
  return (
    <div className="grid gap-5">
      <form action={saveSettingsAction} className="grid gap-5">
        <Card>
          <CardHeader>
            <CardTitle>OpenList 115</CardTitle>
            <CardDescription>
              115 离线先进入下载目录，重命名后再移动到媒体库路径。
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <Field
              label="OpenList 地址"
              name="openlistBaseUrl"
              defaultValue={settings.openlistBaseUrl}
              placeholder="http://127.0.0.1:5244"
            />
            <Field
              label="OpenList Token"
              name="openlistToken"
              defaultValue={settings.openlistToken}
              placeholder="Authorization token"
              type="password"
            />
            <ModeSelect defaultValue={settings.openlist115Mode} />
            <Field
              label="下载目录（全局根）"
              name="openlistIncomingPath"
              defaultValue={settings.openlistIncomingPath}
              placeholder="/115/Anime/_incoming"
              help="全局下载根路径。新建订阅默认会再拆一层子目录：{根}/{订阅名}，避免多订阅共用同一目录时文件串台。Worker 仍会扫描根目录与各订阅子目录。检测时会把根路径同步到 OpenList 后台配置。"
            />
            <div className="flex flex-wrap items-center gap-2 md:col-span-2">
              <Button
                type="submit"
                variant="outline"
                formAction={check115ConnectivityAction}
              >
                同步 OpenList 并检测 115
              </Button>
              {checkResult ? <CheckResult result={checkResult} /> : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>代理</CardTitle>
            <CardDescription>
              只在启用后用于 RSS 预解析和 Worker 抓取 RSS。
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <label className="flex items-center gap-2 text-sm md:col-span-2">
              <input
                type="checkbox"
                name="proxyEnabled"
                value="1"
                defaultChecked={settings.proxyEnabled}
              />
              启用代理
            </label>
            <Field
              label="代理地址"
              name="proxyUrl"
              defaultValue={settings.proxyUrl}
              placeholder="http://127.0.0.1:7890"
              help="默认填本机代理地址；未勾选启用代理时不会使用。"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>命名规则</CardTitle>
            <CardDescription>
              生成整理后的最终路径；这里不是离线下载落点。
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <Field
              label="媒体库根路径"
              name="mediaLibraryRoot"
              defaultValue={settings.mediaLibraryRoot}
              placeholder="/115/Anime"
              help="整理后的最终根路径；Worker 会把下载目录里重命名后的文件 move 到这里。"
            />
            <Field
              label="季目录模板"
              name="seasonPathTemplate"
              defaultValue={settings.seasonPathTemplate}
              placeholder="{title}/Season {season_pad}"
              help="相对媒体库根路径，不需要再写 /115 前缀。"
            />
            <div className="md:col-span-2">
              <Field
                label="文件名模板"
                name="episodeFileTemplate"
                defaultValue={settings.episodeFileTemplate}
                placeholder="{title} - S{season_pad}E{episode_pad}.{ext}"
                help="只填文件名模板，完整目录由媒体库根路径和季目录模板组成。"
              />
            </div>
            <label className="flex items-start gap-2 text-sm md:col-span-2">
              <input
                className="mt-1"
                type="checkbox"
                name="replaceExistingOnRevision"
                value="1"
                defaultChecked={settings.replaceExistingOnRevision}
              />
              <span>
                <span className="block font-medium">修正版覆盖（默认开启）</span>
                <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">
                  同变体出现 v2/v3 时直接下最新版；入库时允许更高修正版覆盖库内旧文件，并阻止更低版本盖回。
                  同路径的重下/不同组互盖也受此开关控制。
                </span>
              </span>
            </label>
            <div className="md:col-span-2 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel-strong)] p-3 text-sm">
              <div className="text-xs font-medium text-[var(--muted)]">可用变量</div>
              <div className="mt-2 flex flex-wrap gap-1.5 data-digits text-xs">
                {[
                  "{title}",
                  "{season}",
                  "{season_pad}",
                  "{episode}",
                  "{episode_pad}",
                  "{ext}"
                ].map((token) => (
                  <span
                    key={token}
                    className="rounded-[6px] border border-[var(--line)] bg-[var(--input)] px-2 py-1"
                  >
                    {token}
                  </span>
                ))}
              </div>
              <div className="mt-3 text-xs text-[var(--muted)]">
                示例：/115/Anime/Show/Season 01/Show - S01E01.mkv
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>杂项</CardTitle>
            <CardDescription>
              TMDB 只做展示增强；Worker 间隔与下载超时影响后台任务节奏。
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <Field
              label="TMDB Bearer Token"
              name="tmdbBearerToken"
              defaultValue={settings.tmdbBearerToken}
              type="password"
            />
            <Field
              label="Worker 间隔秒数"
              name="workerIntervalSeconds"
              defaultValue={String(settings.workerIntervalSeconds)}
              type="number"
              min={30}
              help="RSS 轮询与任务调度间隔，最短 30 秒。修改后下一轮生效。"
            />
            <Field
              label="下载超时（分钟）"
              name="downloadTimeoutMinutes"
              defaultValue={String(settings.downloadTimeoutMinutes)}
              type="number"
              min={1}
              max={1440}
              help="任务处于「下载中」超过该时间且未整理完成时，标记为失败。默认 30 分钟。"
            />
            <label className="flex items-start gap-2 text-sm md:col-span-2">
              <input
                className="mt-1"
                type="checkbox"
                name="downloadAutoRetryEnabled"
                value="1"
                defaultChecked={settings.downloadAutoRetryEnabled}
              />
              <span>
                <span className="block font-medium">下载失败自动重试</span>
                <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">
                  提交失败、115/OpenList 任务失败或下载超时后，冷却一段时间自动重新入队并清理旧
                  task id。达到最大尝试次数后停止，仍可手动点重试。
                </span>
              </span>
            </label>
            <Field
              label="下载最大尝试次数"
              name="downloadAutoRetryMaxAttempts"
              defaultValue={String(settings.downloadAutoRetryMaxAttempts)}
              type="number"
              min={1}
              max={20}
              help="含首次提交。例如 3 表示最多提交 3 次离线下载。"
            />
            <Field
              label="下载重试冷却（分钟）"
              name="downloadAutoRetryCooldownMinutes"
              defaultValue={String(settings.downloadAutoRetryCooldownMinutes)}
              type="number"
              min={1}
              max={1440}
              help="失败后至少等待这么久才会自动重新入队。默认 10 分钟。"
            />
            <div className="md:col-span-2">
              <Button variant="signal" type="submit">
                <Save className="size-4" />
                保存设置
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>维护</CardTitle>
          <CardDescription>
            清空 RSS 抓取结果、解析元数据、下载队列和文件扫描记录；保留后台设置、订阅和筛选规则。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {resetStatus ? <ResetStatus status={resetStatus} /> : null}
          <div>
            <ResetRuntimeDialog />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ResetStatus({ status }: { status: "runtime" | "confirm" }) {
  if (status === "confirm") {
    return (
      <div className="rounded-[var(--radius)] border border-[var(--danger-soft-border)] bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger-text)]">
        确认文案不正确。请输入「清空运行数据」后再提交。
      </div>
    );
  }

  return (
    <div className="rounded-[var(--radius)] border border-[var(--signal-soft-border)] bg-[var(--signal-soft)] p-3 text-sm text-[var(--signal-text)]">
      已清空运行数据，后台设置、订阅和筛选规则已保留。
    </div>
  );
}

function CheckResult({ result }: { result: OpenList115CheckResult }) {
  return (
    <div
      className={
        result.ok
          ? "rounded-[var(--radius)] border border-[var(--signal-soft-border)] bg-[var(--signal-soft)] p-3 text-sm text-[var(--signal-text)]"
          : "rounded-[var(--radius)] border border-[var(--danger-soft-border)] bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger-text)]"
      }
    >
      <div className="font-medium">{result.ok ? "连接正常" : "检测未通过"}</div>
      <div className="mt-2 grid gap-1">
        {result.checks.map((check) => (
          <div key={check.label}>
            {check.ok ? "OK" : "FAIL"} / {check.label}: {check.message}
          </div>
        ))}
      </div>
    </div>
  );
}

function ModeSelect({
  defaultValue
}: {
  defaultValue: SystemSettings["openlist115Mode"];
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="openlist115Mode">115 接入方式</Label>
      <select
        id="openlist115Mode"
        name="openlist115Mode"
        defaultValue={defaultValue}
        className="flex h-9 w-full rounded-[var(--radius)] border border-[var(--line)] bg-[var(--input)] px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--signal)]"
      >
        <option value="115 Cloud">115 Cloud</option>
        <option value="115 Open">115 Open</option>
      </select>
      <p className="text-xs text-[var(--muted)]">
        必须和 OpenList 中 `/115` 挂载使用的 driver 一致；你用 115 Open 就选 115 Open。
      </p>
    </div>
  );
}

function Field({
  label,
  name,
  help,
  ...props
}: {
  label: string;
  name: string;
  help?: string;
} & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} {...props} />
      {help ? <p className="text-xs text-[var(--muted)]">{help}</p> : null}
    </div>
  );
}
