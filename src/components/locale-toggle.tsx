"use client";

import { Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/locale-provider";
import { LOCALE_LABELS, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

function nextLocale(locale: Locale): Locale {
  return locale === "zh-CN" ? "en" : "zh-CN";
}

export function LocaleToggle({
  className,
  showLabel = false
}: {
  className?: string;
  showLabel?: boolean;
}) {
  const { locale, setLocale, t } = useI18n();
  const next = nextLocale(locale);

  return (
    <Button
      type="button"
      variant={showLabel ? "outline" : "ghost"}
      size={showLabel ? "default" : "icon"}
      onClick={() => void setLocale(next)}
      aria-label={t("locale.aria", {
        current: LOCALE_LABELS[locale],
        next: LOCALE_LABELS[next]
      })}
      title={t("locale.switchTo", { label: LOCALE_LABELS[next] })}
      className={cn(
        showLabel
          ? "gap-2 text-[var(--foreground)]"
          : "text-[var(--muted)]",
        className
      )}
    >
      <Languages className="size-4" />
      {showLabel ? (
        <span className="text-sm">{LOCALE_LABELS[locale]}</span>
      ) : null}
    </Button>
  );
}
