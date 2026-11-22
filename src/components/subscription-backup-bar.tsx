"use client";

import { Download, Loader2, Upload } from "lucide-react";
import { useRef, useTransition, type ChangeEvent } from "react";
import { toast } from "sonner";
import { importSubscriptionsAction } from "@/app/actions";
import { useI18n } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";

export function SubscriptionBackupBar() {
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, startImport] = useTransition();

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    startImport(async () => {
      try {
        const text = await file.text();
        const formData = new FormData();
        formData.set("payload", text);
        const result = await importSubscriptionsAction(formData);
        if (result.ok) {
          toast.success(result.message ?? t("toast.importOk", { imported: 0, skipped: 0 }));
        } else {
          toast.error(
            t("toast.actionFailed", { error: result.error ?? t("common.unknown") })
          );
        }
      } catch (error) {
        toast.error(
          t("toast.actionFailed", {
            error: error instanceof Error ? error.message : String(error)
          })
        );
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button asChild variant="outline" size="sm">
        <a href="/api/subscriptions/export" download="aniflow-subscriptions.json">
          <Download className="size-3.5" />
          {t("subscription.exportJson")}
        </a>
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={handleFileChange}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={importing}
        onClick={() => fileInputRef.current?.click()}
      >
        {importing ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Upload className="size-3.5" />
        )}
        {t("subscription.importJson")}
      </Button>
    </div>
  );
}
