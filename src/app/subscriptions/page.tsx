import { AppShell } from "@/components/app-shell";
import { RssPreviewPanel } from "@/components/rss-preview-panel";
import { SubscriptionForm } from "@/components/subscription-form";
import {
  getSystemSettings,
  listRules,
  listSubscriptions
} from "@/lib/db/repositories";
import { fetchRssPreview, type RssPreview } from "@/lib/rss/preview";

export const dynamic = "force-dynamic";

export default async function SubscriptionsPage({
  searchParams
}: {
  searchParams: Promise<{ rssUrl?: string }>;
}) {
  const { rssUrl } = await searchParams;
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
  const settings = getSystemSettings();

  return (
    <AppShell>
      <div className="mx-auto grid w-full max-w-7xl gap-5 px-4 py-6 md:px-6">
        <section>
          <h1 className="text-3xl font-semibold tracking-tight">订阅</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
            先解析 RSS，再从解析结果中选择订阅名称、字幕组、分辨率和字幕语言。
          </p>
        </section>

        <RssPreviewPanel preview={preview} error={error} initialUrl={rssUrl} />
        <SubscriptionForm
          subscriptions={subscriptions}
          rules={rules}
          preview={preview}
          defaultIncomingPath={settings.openlistIncomingPath}
        />
      </div>
    </AppShell>
  );
}
