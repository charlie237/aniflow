"use client";

import { Toaster as Sonner } from "sonner";

export function Toaster() {
  return (
    <Sonner
      position="top-right"
      toastOptions={{
        style: {
          borderRadius: "8px",
          borderColor: "var(--line)",
          background: "white",
          color: "var(--foreground)"
        }
      }}
    />
  );
}
