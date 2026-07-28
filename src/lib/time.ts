/**
 * Central time helpers.
 *
 * Storage convention:
 * - Application-written timestamps: UTC ISO-8601 with `Z` (e.g. 2026-07-09T04:13:59.000Z)
 * - SQLite CURRENT_TIMESTAMP: UTC `YYYY-MM-DD HH:MM:SS` (no zone) — treat as UTC
 *
 * Display convention:
 * - Always Asia/Shanghai for the UI
 *
 * RSS / Mikan:
 * - Naive datetimes without offset (e.g. 2026-07-09T10:01:02.806) are China local time
 */

export const DISPLAY_TIME_ZONE = "Asia/Shanghai";

/** Format any stored timestamp for UI (Asia/Shanghai). */
export function formatDateTime(
  value?: string | null,
  options?: { locale?: string; never?: string }
) {
  if (!value) return options?.never ?? "从未";
  const date = parseToUtcDate(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = new Intl.DateTimeFormat(options?.locale ?? "zh-CN", {
    timeZone: DISPLAY_TIME_ZONE,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("month")}/${part("day")} ${part("hour")}:${part("minute")}`;
}

/**
 * Parse a stored or external datetime into a JS Date (UTC instant).
 * Prefer this over bare `new Date(string)` so SQLite and naive ISO are consistent.
 */
export function parseToUtcDate(value: string): Date {
  const trimmed = value.trim();
  if (!trimmed) return new Date(Number.NaN);

  // SQLite CURRENT_TIMESTAMP / default columns: "YYYY-MM-DD HH:MM:SS" (UTC)
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)) {
    return new Date(`${trimmed.replace(" ", "T")}Z`);
  }

  // Already has explicit zone (Z or ±HH:MM)
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    return new Date(trimmed);
  }

  // RFC 2822 style often includes GMT/UT/offset as text
  if (/gmt|utc|\b[+-]\d{4}\b/i.test(trimmed)) {
    return new Date(trimmed);
  }

  // Naive ISO: "2026-07-09T10:01:02.806" or "2026-07-09T10:01:02"
  // Used by Mikan torrent.pubDate — China local (UTC+8, no DST).
  const naive = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(\.\d+)?$/
  );
  if (naive) {
    const frac = naive[7] ?? "";
    return new Date(
      `${naive[1]}-${naive[2]}-${naive[3]}T${naive[4]}:${naive[5]}:${naive[6]}${frac}+08:00`
    );
  }

  return new Date(trimmed);
}

/**
 * Normalize an external date string (RSS etc.) to UTC ISO for storage.
 * Naive ISO without offset → Asia/Shanghai wall time.
 */
export function toStoredUtcIso(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const date = parseToUtcDate(value.trim());
  if (Number.isNaN(date.getTime())) return value.trim();
  return date.toISOString();
}

/** Current UTC instant as ISO string for application writes. */
export function nowUtcIso() {
  return new Date().toISOString();
}

/** Milliseconds since epoch; 0 if unparseable. */
export function dateMs(value?: string | null) {
  if (!value) return 0;
  const time = parseToUtcDate(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}
