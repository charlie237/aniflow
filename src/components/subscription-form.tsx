import { Plus } from "lucide-react";
import { createParsedSubscriptionAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import type { Subscription } from "@/lib/db/types";
import type { RssPreview } from "@/lib/rss/preview";

const NONE = "__none__";

export function SubscriptionForm({
  subscriptions,
  preview,
  defaultIncomingPath
}: {
  subscriptions: Subscription[];
  preview?: RssPreview | null;
  defaultIncomingPath?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>订阅</CardTitle>
        <CardDescription>
          解析 RSS 后，从识别出的名称、字幕组、分辨率和字幕语言里选择。
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        {preview ? (
          <CreateFromPreview preview={preview} defaultIncomingPath={defaultIncomingPath} />
        ) : (
          <div className="rounded-[var(--radius)] border border-dashed border-[var(--line)] bg-[var(--panel-strong)] p-4 text-sm text-[var(--muted)]">
            先在上方解析 RSS，再创建订阅。
          </div>
        )}

        <ExistingSubscriptions subscriptions={subscriptions} />
      </CardContent>
    </Card>
  );
}

function CreateFromPreview({
  preview,
  defaultIncomingPath
}: {
  preview: RssPreview;
  defaultIncomingPath?: string;
}) {
  const names = unique([
    preview.title,
    ...preview.items.map((item) => item.metadata.parsedTitle)
  ]);
  const nameOptions = names.length > 0 ? names : ["未命名订阅"];
  const defaultName = nameOptions[0] ?? "未命名订阅";

  return (
    <form
      action={createParsedSubscriptionAction}
      className="grid gap-3 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel-strong)] p-3"
    >
      <input type="hidden" name="rssUrl" value={preview.url} />
      <input type="hidden" name="incomingPath" value={defaultIncomingPath ?? ""} />
      <div className="grid gap-2 md:grid-cols-2">
        <SelectField
          label="名称"
          name="name"
          values={nameOptions}
          defaultValue={defaultName}
        />
        <SelectField
          label="季号"
          name="seasonNumber"
          values={["0", "1", "2", "3", "4", "5"]}
          defaultValue="1"
        />
      </div>
      <div className="grid gap-2 md:grid-cols-3">
        <SelectField
          label="字幕组"
          name="releaseGroup"
          values={preview.groups}
          includeNone
        />
        <SelectField
          label="分辨率"
          name="resolution"
          values={preview.resolutions}
          includeNone
        />
        <SelectField
          label="字幕语言"
          name="subtitleLanguage"
          values={preview.languages}
          includeNone
        />
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="autoDownload" value="1" defaultChecked />
          自动离线
        </label>
        <Button type="submit" variant="signal">
          <Plus className="size-4" />
          创建订阅
        </Button>
      </div>
    </form>
  );
}

function ExistingSubscriptions({ subscriptions }: { subscriptions: Subscription[] }) {
  return (
    <div className="grid gap-3">
      <div className="text-sm font-medium">已有订阅</div>
      {subscriptions.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-dashed border-[var(--line)] p-4 text-sm text-[var(--muted)]">
          暂无订阅。
        </div>
      ) : (
        subscriptions.map((subscription) => (
          <div
            key={subscription.id}
            className="grid gap-2 rounded-[var(--radius)] border border-[var(--line)] bg-white p-3 text-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-medium">{subscription.name}</div>
              <div className="rounded-[6px] border border-[var(--line)] px-2 py-1 data-digits text-xs">
                Season {String(subscription.seasonNumber).padStart(2, "0")}
              </div>
            </div>
            <div className="truncate text-xs text-[var(--muted)]">{subscription.rssUrl}</div>
            <div className="flex flex-wrap gap-2 text-xs text-[var(--muted)]">
              <span>{subscription.enabled ? "启用" : "停用"}</span>
              <span>{subscription.autoDownload ? "自动离线" : "仅发现"}</span>
              <span>{subscription.incomingPath ?? "使用默认 115 保存路径"}</span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function SelectField({
  label,
  name,
  values,
  defaultValue,
  includeNone
}: {
  label: string;
  name: string;
  values: string[];
  defaultValue?: string;
  includeNone?: boolean;
}) {
  const fallback = includeNone ? NONE : values[0];
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <Select name={name} defaultValue={defaultValue ?? fallback}>
        <SelectTrigger>
          <SelectValue placeholder="选择" />
        </SelectTrigger>
        <SelectContent>
          {includeNone ? <SelectItem value={NONE}>不限</SelectItem> : null}
          {values.map((value) => (
            <SelectItem key={value} value={value}>
              {value}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function unique(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.filter((value): value is string => Boolean(value)))
  );
}
