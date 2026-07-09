import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatDateTime as formatDateTimeImpl } from "@/lib/time";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** @see {@link formatDateTimeImpl} — Asia/Shanghai display of UTC-stored timestamps. */
export function formatDateTime(value?: string | null) {
  return formatDateTimeImpl(value);
}

export function compactNumber(value: number) {
  return new Intl.NumberFormat("en", { notation: "compact" }).format(value);
}

export function formatFileSize(bytes: number | null | undefined) {
  if (bytes == null || !Number.isFinite(bytes)) return "-";
  if (bytes <= 0) return "0 B";

  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const maximumFractionDigits = unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${new Intl.NumberFormat("en", {
    maximumFractionDigits
  }).format(value)} ${units[unitIndex]}`;
}

export function toBool(value: unknown) {
  return value === true || value === "true" || value === "1" || value === 1;
}
