import { AppShell } from "@/components/app-shell";
import { RssPreviewPanel } from "@/components/rss-preview-panel";
import { SubscriptionForm } from "@/components/subscription-form";
import {
  listRules,
  listSubscriptionIdsWithInFlightJobs,
  listSubscriptions
} from "@/lib/db/repositories";
import { getDictionary } from "@/lib/i18n/server";
import { fetchRssPreview, type RssPreview } from "@/lib/rss/preview";

export const dynamic = "force-dynamic";

export default async function SubscriptionsPage({
  searchParams
}: {
  searchParams: Promise<{ rssUrl?: string }>;
}) {
  const { rssUrl } = await searchParams;
  const { t } = await getDictionary();
  let preview: RssPreview | null = null;
  let error: string | null = null;

  if (rssUrl) {
    try {
      preview = await fetchRssPreview(rssUrl);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
  }

  const subscriptions = listSubscriptions();
  const rules = listRules();
  const deletionBlockedSubscriptionIds = listSubscriptionIdsWithInFlightJobs();

  return (
    <AppShell>
      <div className="mx-auto grid w-full max-w-7xl gap-5 px-4 py-6 md:px-6">
        <section>
          <h1 className="text-3xl font-semibold tracking-tight">
            {t("subscriptionsPage.title")}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
            {t("subscriptionsPage.description")}
          </p>
        </section>

        <RssPreviewPanel preview={preview} error={error} initialUrl={rssUrl} />
        <SubscriptionForm
          subscriptions={subscriptions}
          rules={rules}
          preview={preview}
          deletionBlockedSubscriptionIds={deletionBlockedSubscriptionIds}
        />
      </div>
    </AppShell>
  );
}
