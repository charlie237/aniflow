import Link from "next/link";
import { RadioTower } from "lucide-react";
import type { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen">
      <header className="border-b border-[var(--line)] bg-white/82 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between md:px-6">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="flex size-8 items-center justify-center rounded-[var(--radius)] bg-[var(--foreground)] text-white">
              <RadioTower className="size-4" />
            </span>
            Aniflow
          </Link>
          <nav className="flex flex-wrap gap-1 text-sm">
            <NavLink href="/">运行总览</NavLink>
            <NavLink href="/subscriptions">订阅</NavLink>
            <NavLink href="/settings">后台设置</NavLink>
          </nav>
        </div>
      </header>
      {children}
    </main>
  );
}

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-[var(--radius)] px-3 py-2 text-[var(--muted)] transition-colors hover:bg-[var(--panel-strong)] hover:text-[var(--foreground)]"
    >
      {children}
    </Link>
  );
}
