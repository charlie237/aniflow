import type { ReactNode } from "react";
import { AppShellClient } from "@/components/app-shell-client";
import { isAuthEnabled } from "@/lib/auth";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <AppShellClient authEnabled={isAuthEnabled()}>{children}</AppShellClient>
  );
}
