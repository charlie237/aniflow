"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, RadioTower } from "lucide-react";
import type { ReactNode } from "react";
import { logoutAction } from "@/app/auth-actions";
import { LocaleToggle } from "@/components/locale-toggle";
import { useI18n } from "@/components/locale-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function AppShellClient({
  children,
  authEnabled
}: {
  children: ReactNode;
  authEnabled: boolean;
}) {
  const pathname = usePathname();
  const { t } = useI18n();

  const nav = [
    { href: "/", label: t("nav.overview") },
    { href: "/subscriptions", label: t("nav.subscriptions") },
    { href: "/settings", label: t("nav.settings") }
  ] as const;

  return (
    <main className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-[var(--line)] bg-[var(--header)] backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 py-3.5 md:flex-row md:items-center md:justify-between md:px-6">
          <Link href="/" className="group flex items-center gap-2.5 font-semibold">
            <span className="flex size-8 items-center justify-center rounded-[var(--radius)] bg-[var(--foreground)] text-[var(--background)] shadow-[var(--shadow)] transition-transform group-hover:scale-[1.03]">
              <RadioTower className="size-4" />
            </span>
            <span className="tracking-tight">Aniflow</span>
          </Link>
          <nav className="flex flex-wrap items-center gap-1 text-sm">
            {nav.map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "rounded-[var(--radius)] px-3 py-2 transition-colors",
                    active
                      ? "bg-[var(--nav-active)] font-medium text-[var(--signal-text)]"
                      : "text-[var(--muted)] hover:bg-[var(--panel-strong)] hover:text-[var(--foreground)]"
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
            <LocaleToggle />
            <ThemeToggle />
            {authEnabled ? (
              <form action={logoutAction}>
                <Button
                  type="submit"
                  variant="ghost"
                  className="h-9 gap-1.5 px-3 text-[var(--muted)]"
                >
                  <LogOut className="size-3.5" />
                  {t("nav.logout")}
                </Button>
              </form>
            ) : null}
          </nav>
        </div>
      </header>
      {children}
    </main>
  );
}
