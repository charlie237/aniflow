"use client";

import { Toaster as Sonner } from "sonner";
import { useTheme } from "@/components/theme-provider";

export function Toaster() {
  const { theme, ready } = useTheme();

  return (
    <Sonner
      theme={ready ? theme : "system"}
      position="top-right"
      toastOptions={{
        style: {
          borderRadius: "8px",
          borderColor: "var(--line)",
          background: "var(--panel)",
          color: "var(--foreground)"
        }
      }}
    />
  );
}
