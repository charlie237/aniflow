import { Save } from "lucide-react";
import type { InputHTMLAttributes } from "react";
import { check115ConnectivityAction, saveSettingsAction } from "@/app/actions";
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
  checkResult
}: {
  settings: SystemSettings;
  checkResult?: OpenList115CheckResult | null;
}) {
  return (
    <form action={saveSettingsAction} className="grid gap-5">
      <Card>
        <CardHeader>
          <CardTitle>OpenList 115</CardTitle>
          <CardDescription>
            115 离线先写入保存路径，完成后再移动到媒体库路径。
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
            label="OpenList 115 临时目录"
            name="openlist115TempDir"
            defaultValue={settings.openlist115TempDir}
            placeholder="/115/anime/_incoming"
            help="点击检测时会写入 OpenList 后台的 115 Open/115 Cloud 临时文件夹；用于让对应离线工具进入 ready 列表，必须在同类型 115 挂载下。"
          />
          <Field
            label="离线保存路径"
            name="openlistIncomingPath"
            defaultValue={settings.openlistIncomingPath}
            placeholder="/115/anime/_incoming"
            help="RSS 离线下载任务提交到这里，也是扫描入口；这是 OpenList 里的 115 挂载路径，不是本地路径。"
          />
          <div className="flex flex-wrap items-center gap-2 md:col-span-2">
            <Button type="submit" variant="outline" formAction={check115ConnectivityAction}>
              写入临时目录并检测 115
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
            placeholder="/115/anime"
            help="整理后的最终根路径，通常和离线保存路径在同一个 115 挂载下，但不要指向 _incoming。"
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
                  className="rounded-[6px] border border-[var(--line)] bg-white px-2 py-1"
                >
                  {token}
                </span>
              ))}
            </div>
            <div className="mt-3 text-xs text-[var(--muted)]">
              示例：/115/anime/Show/Season 01/Show - S01E01.mkv
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>杂项</CardTitle>
          <CardDescription>TMDB 只做展示增强；Worker 间隔影响 RSS 轮询频率。</CardDescription>
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
  );
}

function CheckResult({ result }: { result: OpenList115CheckResult }) {
  return (
    <div
      className={
        result.ok
          ? "rounded-[var(--radius)] border border-[#0f9f6e40] bg-[#0f9f6e12] p-3 text-sm text-[#067647]"
          : "rounded-[var(--radius)] border border-[#d92d2040] bg-[#d92d2012] p-3 text-sm text-[var(--danger)]"
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
        className="flex h-9 w-full rounded-[var(--radius)] border border-[var(--line)] bg-white px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--signal)]"
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
