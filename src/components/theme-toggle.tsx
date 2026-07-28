"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/locale-provider";
import {
  useTheme,
  type ThemePreference
} from "@/components/theme-provider";
import { cn } from "@/lib/utils";

const ICONS: Record<ThemePreference, typeof Sun> = {
  system: Monitor,
  light: Sun,
  dark: Moon
};

/**
 * Single control cycling system → light → dark.
 * Preference is stored; resolved theme follows OS when set to system.
 */
export function ThemeToggle({
  className,
  showLabel = false
}: {
  className?: string;
  showLabel?: boolean;
}) {
  const { preference, cyclePreference, ready } = useTheme();
  const { t } = useI18n();
  const Icon = ICONS[preference];
  const labels: Record<ThemePreference, string> = {
    system: t("theme.system"),
    light: t("theme.light"),
    dark: t("theme.dark")
  };
  const label = labels[preference];
  const nextPreference: ThemePreference =
    preference === "system"
      ? "light"
      : preference === "light"
        ? "dark"
        : "system";
  const nextLabel = labels[nextPreference];

  return (
    <Button
      type="button"
      variant={showLabel ? "outline" : "ghost"}
      size={showLabel ? "default" : "icon"}
      onClick={cyclePreference}
      aria-label={t("theme.aria", { current: label, next: nextLabel })}
      title={t("theme.title", { current: label, next: nextLabel })}
      className={cn(
        showLabel
          ? "gap-2 text-[var(--foreground)]"
          : "text-[var(--muted)]",
        className
      )}
      disabled={!ready}
    >
      <Icon className="size-4" />
      {showLabel ? <span className="text-sm">{label}</span> : null}
    </Button>
  );
}
