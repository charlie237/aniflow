"use client";

import { Loader2, RotateCw } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { pollSelectedSubscriptionAction } from "@/app/actions";
import { useI18n } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";

export function OverviewPollForm({
  subscriptions,
  defaultTarget
}: {
  subscriptions: Array<{ id: number; name: string; seasonNumber: number }>;
  defaultTarget: string;
}) {
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await pollSelectedSubscriptionAction(formData);
      if (result.ok) {
        toast.success(result.message ?? t("toast.pollQueued"));
      } else {
        toast.error(
          t("toast.actionFailed", { error: result.error ?? t("common.unknown") })
        );
      }
    });
  }

  return (
    <form
      action={handleSubmit}
      className="flex w-full min-w-0 items-center gap-2 sm:w-auto lg:max-w-md lg:shrink-0 lg:justify-end"
    >
      <select
        name="subscriptionId"
        defaultValue={defaultTarget}
        disabled={pending}
        className="h-9 min-w-0 flex-1 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--input)] px-3 text-sm shadow-[var(--shadow)] focus:outline-none focus:ring-2 focus:ring-[var(--signal)] sm:w-48 sm:flex-none"
      >
        {subscriptions.map((subscription) => (
          <option key={subscription.id} value={subscription.id}>
            {subscription.name} / S
            {String(subscription.seasonNumber).padStart(2, "0")}
          </option>
        ))}
        <option value="all">{t("common.allSubscriptions")}</option>
      </select>
      <Button
        type="submit"
        variant="signal"
        disabled={pending}
        className="shrink-0 whitespace-nowrap"
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <RotateCw className="size-4" />
        )}
        {t("overview.poll")}
      </Button>
    </form>
  );
}
