import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { FilterRule, Subscription } from "@/lib/db/types";

const ruleLabels: Record<FilterRule["type"], string> = {
  group_allow: "字幕组",
  group_block: "字幕组屏蔽",
  resolution_allow: "分辨率",
  language_allow: "字幕语言",
  keyword_include: "必须包含",
  keyword_exclude: "排除关键词"
};

export function RuleForm({
  subscriptions,
  rules
}: {
  subscriptions: Subscription[];
  rules: FilterRule[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>筛选</CardTitle>
        <CardDescription>创建订阅时选择的候选值会自动成为筛选规则。</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {rules.length === 0 ? (
          <p className="rounded-[var(--radius)] border border-dashed border-[var(--line)] p-4 text-sm text-[var(--muted)]">
            暂无筛选规则。
          </p>
        ) : (
          rules.map((rule) => {
            const subscription = subscriptions.find(
              (item) => item.id === rule.subscriptionId
            );
            return (
              <div
                key={rule.id}
                className="flex items-center justify-between gap-3 rounded-[var(--radius)] border border-[var(--line)] bg-white px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <span className="font-medium">{subscription?.name ?? "未知订阅"}</span>
                  <span className="mx-2 text-[var(--muted)]">/</span>
                  <span>{ruleLabels[rule.type]}</span>
                </div>
                <span className="rounded-[6px] border border-[var(--line)] px-2 py-1 data-digits text-xs">
                  {rule.value}
                </span>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
