import { AppShell } from "@/components/app-shell";
import { SettingsForm } from "@/components/settings-form";
import { getSystemSettings } from "@/lib/db/repositories";
import { getDictionary } from "@/lib/i18n/server";
import type { OpenList115CheckResult } from "@/lib/openlist/client";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams
}: {
  searchParams: Promise<{ check?: string; reset?: string }>;
}) {
  const { check, reset } = await searchParams;
  const { t } = await getDictionary();
  return (
    <AppShell>
      <div className="mx-auto grid w-full max-w-5xl gap-5 px-4 py-6 md:px-6">
        <section>
          <h1 className="text-3xl font-semibold tracking-tight">
            {t("settingsPage.title")}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
            {t("settingsPage.description")}
          </p>
        </section>
        <SettingsForm
          settings={getSystemSettings()}
          checkResult={parseCheckResult(check)}
          resetStatus={parseResetStatus(reset)}
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

function parseResetStatus(value: string | undefined) {
  return value === "runtime" || value === "confirm" ? value : null;
}
