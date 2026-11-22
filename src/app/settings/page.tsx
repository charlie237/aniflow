import { AppShell } from "@/components/app-shell";
import { SettingsForm } from "@/components/settings-form";
import { getSystemSettings } from "@/lib/db/repositories";
import type { PublicSystemSettings } from "@/lib/db/types";
import { getDictionary } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams
}: {
  searchParams: Promise<{ reset?: string }>;
}) {
  const { reset } = await searchParams;
  const { t } = await getDictionary();
  const { openlistToken, tmdbBearerToken, ...rest } = getSystemSettings();
  const publicSettings: PublicSystemSettings = {
    ...rest,
    hasOpenlistToken: Boolean(openlistToken),
    hasTmdbBearerToken: Boolean(tmdbBearerToken)
  };
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
          settings={publicSettings}
          resetStatus={parseResetStatus(reset)}
        />
      </div>
    </AppShell>
  );
}

function parseResetStatus(value: string | undefined) {
  return value === "runtime" || value === "confirm" ? value : null;
}
