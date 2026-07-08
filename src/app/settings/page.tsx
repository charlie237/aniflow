import { AppShell } from "@/components/app-shell";
import { SettingsForm } from "@/components/settings-form";
import { getSystemSettings } from "@/lib/db/repositories";
import type { OpenList115CheckResult } from "@/lib/openlist/client";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams
}: {
  searchParams: Promise<{ check?: string }>;
}) {
  const { check } = await searchParams;
  return (
    <AppShell>
      <div className="mx-auto grid w-full max-w-5xl gap-5 px-4 py-6 md:px-6">
        <section>
          <h1 className="text-3xl font-semibold tracking-normal">后台设置</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
            配置 OpenList 115 离线、TMDB 展示令牌和 Worker 轮询间隔。
          </p>
        </section>
        <SettingsForm
          settings={getSystemSettings()}
          checkResult={parseCheckResult(check)}
        />
      </div>
    </AppShell>
  );
}

function parseCheckResult(value: string | undefined): OpenList115CheckResult | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.checks)) {
      return null;
    }
    return parsed as OpenList115CheckResult;
  } catch {
    return null;
  }
}
