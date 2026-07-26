"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useTheme,
  type ThemePreference
} from "@/components/theme-provider";
import { cn } from "@/lib/utils";

const LABELS: Record<ThemePreference, string> = {
  system: "跟随系统",
  light: "亮色",
  dark: "暗色"
};

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
  const Icon = ICONS[preference];
  const label = LABELS[preference];
  const nextLabel =
    LABELS[
      preference === "system"
        ? "light"
        : preference === "light"
          ? "dark"
          : "system"
    ];

  return (
    <Button
      type="button"
      variant={showLabel ? "outline" : "ghost"}
      size={showLabel ? "default" : "icon"}
      onClick={cyclePreference}
      aria-label={`主题：${label}，点击切换为${nextLabel}`}
      title={`主题：${label}（点击切换为${nextLabel}）`}
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
