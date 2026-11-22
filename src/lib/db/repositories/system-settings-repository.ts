import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { settings } from "@/lib/db/schema";
import type { MediaServerType, SystemSettings, WorkerHealth } from "@/lib/db/types";
import { parseToUtcDate } from "@/lib/time";

export const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  openlistBaseUrl: "",
  openlistToken: "",
  openlist115Mode: "115 Cloud",
  openlistIncomingPath: "/115/Anime/_incoming",
  mediaLibraryRoot: "/115/Anime",
  seasonPathTemplate: "{title}/Season {season_pad}",
  episodeFileTemplate: "{title} - S{season_pad}E{episode_pad}.{ext}",
  replaceExistingOnRevision: true,
  proxyEnabled: false,
  proxyUrl: "http://127.0.0.1:7890",
  tmdbBearerToken: "",
  workerIntervalSeconds: 300,
  downloadTimeoutMinutes: 30,
  mediaServerType: "none",
  mediaServerUrl: "",
  mediaServerToken: "",
  mediaServerLibraryId: "",
  webhookEnabled: false,
  webhookUrl: "",
  telegramEnabled: false,
  telegramBotToken: "",
  telegramChatId: "",
  barkEnabled: false,
  barkServerUrl: "https://api.day.app",
  barkDeviceKey: "",
  notifyOnCompleted: true,
  notifyOnFailed: true,
  notifyOnNeedsReview: true
};

export function getSystemSettings(): SystemSettings {
  const rows = getDb().select().from(settings).all();
  const values = new Map(rows.map((row) => [row.key, row.value]));

  return {
    openlistBaseUrl:
      values.get("openlistBaseUrl") ?? DEFAULT_SYSTEM_SETTINGS.openlistBaseUrl,
    openlistToken:
      values.get("openlistToken") ?? DEFAULT_SYSTEM_SETTINGS.openlistToken,
    openlist115Mode: normalize115Mode(values.get("openlist115Mode")),
    openlistIncomingPath:
      values.get("openlistIncomingPath") ??
      DEFAULT_SYSTEM_SETTINGS.openlistIncomingPath,
    mediaLibraryRoot:
      values.get("mediaLibraryRoot") ?? DEFAULT_SYSTEM_SETTINGS.mediaLibraryRoot,
    seasonPathTemplate:
      values.get("seasonPathTemplate") ??
      DEFAULT_SYSTEM_SETTINGS.seasonPathTemplate,
    episodeFileTemplate:
      values.get("episodeFileTemplate") ??
      DEFAULT_SYSTEM_SETTINGS.episodeFileTemplate,
    replaceExistingOnRevision: boolSetting(
      values.get("replaceExistingOnRevision"),
      DEFAULT_SYSTEM_SETTINGS.replaceExistingOnRevision
    ),
    proxyEnabled: boolSetting(values.get("proxyEnabled"), false),
    proxyUrl: values.get("proxyUrl") ?? DEFAULT_SYSTEM_SETTINGS.proxyUrl,
    tmdbBearerToken:
      values.get("tmdbBearerToken") ?? DEFAULT_SYSTEM_SETTINGS.tmdbBearerToken,
    workerIntervalSeconds: Number(
      values.get("workerIntervalSeconds") ??
        DEFAULT_SYSTEM_SETTINGS.workerIntervalSeconds
    ),
    downloadTimeoutMinutes: Math.min(
      24 * 60,
      Math.max(
        1,
        Number(
          values.get("downloadTimeoutMinutes") ??
            DEFAULT_SYSTEM_SETTINGS.downloadTimeoutMinutes
        ) || DEFAULT_SYSTEM_SETTINGS.downloadTimeoutMinutes
      )
    ),
    mediaServerType: normalizeMediaServerType(values.get("mediaServerType")),
    mediaServerUrl:
      values.get("mediaServerUrl") ?? DEFAULT_SYSTEM_SETTINGS.mediaServerUrl,
    mediaServerToken:
      values.get("mediaServerToken") ?? DEFAULT_SYSTEM_SETTINGS.mediaServerToken,
    mediaServerLibraryId:
      values.get("mediaServerLibraryId") ??
      DEFAULT_SYSTEM_SETTINGS.mediaServerLibraryId,
    webhookEnabled: boolSetting(values.get("webhookEnabled"), false),
    webhookUrl: values.get("webhookUrl") ?? DEFAULT_SYSTEM_SETTINGS.webhookUrl,
    telegramEnabled: boolSetting(values.get("telegramEnabled"), false),
    telegramBotToken:
      values.get("telegramBotToken") ?? DEFAULT_SYSTEM_SETTINGS.telegramBotToken,
    telegramChatId:
      values.get("telegramChatId") ?? DEFAULT_SYSTEM_SETTINGS.telegramChatId,
    barkEnabled: boolSetting(values.get("barkEnabled"), false),
    barkServerUrl:
      values.get("barkServerUrl") ?? DEFAULT_SYSTEM_SETTINGS.barkServerUrl,
    barkDeviceKey:
      values.get("barkDeviceKey") ?? DEFAULT_SYSTEM_SETTINGS.barkDeviceKey,
    notifyOnCompleted: boolSetting(values.get("notifyOnCompleted"), true),
    notifyOnFailed: boolSetting(values.get("notifyOnFailed"), true),
    notifyOnNeedsReview: boolSetting(values.get("notifyOnNeedsReview"), true)
  };
}

export function saveSystemSettings(input: SystemSettings) {
  const normalized = normalizeSystemSettings(input);
  getDb().transaction((tx) => {
    for (const [key, value] of Object.entries(normalized)) {
      tx.insert(settings)
        .values({ key, value: String(value), updatedAt: sql`CURRENT_TIMESTAMP` })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value: String(value), updatedAt: sql`CURRENT_TIMESTAMP` }
        })
        .run();
    }
  });
  return normalized;
}

export function touchWorkerHeartbeat() {
  const value = new Date().toISOString();
  getDb()
    .insert(settings)
    .values({ key: "workerLastSeenAt", value, updatedAt: sql`CURRENT_TIMESTAMP` })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedAt: sql`CURRENT_TIMESTAMP` }
    })
    .run();
}

/** Atomic SQLite lease acquisition; the conflict predicate prevents double owners. */
export function acquireWorkerLease(
  name: string,
  owner: string,
  staleAfterSeconds = 30 * 60
) {
  const key = `workerLease:${name}`;
  const staleOffset = `-${Math.max(60, staleAfterSeconds)} seconds`;
  const result = getDb()
    .insert(settings)
    .values({ key, value: owner, updatedAt: sql`CURRENT_TIMESTAMP` })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: owner, updatedAt: sql`CURRENT_TIMESTAMP` },
      setWhere: sql`datetime(${settings.updatedAt}) <= datetime('now', ${staleOffset})`
    })
    .run();
  return result.changes > 0;
}

export function refreshWorkerLease(name: string, owner: string) {
  return getDb()
    .update(settings)
    .set({ updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(
      and(eq(settings.key, `workerLease:${name}`), eq(settings.value, owner))
    )
    .run().changes > 0;
}

export function releaseWorkerLease(name: string, owner: string) {
  getDb()
    .delete(settings)
    .where(
      and(eq(settings.key, `workerLease:${name}`), eq(settings.value, owner))
    )
    .run();
}

export function getWorkerHealth(): WorkerHealth {
  const systemSettings = getSystemSettings();
  const row = getDb()
    .select()
    .from(settings)
    .where(eq(settings.key, "workerLastSeenAt"))
    .get();
  const lastSeenAt = row?.value ?? null;
  const staleAfterSeconds = Math.max(systemSettings.workerIntervalSeconds * 2 + 60, 180);
  const secondsSinceLastSeen = lastSeenAt
    ? Math.floor((Date.now() - parseToUtcDate(lastSeenAt).getTime()) / 1000)
    : null;

  return {
    lastSeenAt,
    secondsSinceLastSeen:
      secondsSinceLastSeen == null || Number.isNaN(secondsSinceLastSeen)
        ? null
        : secondsSinceLastSeen,
    staleAfterSeconds,
    ok:
      secondsSinceLastSeen != null &&
      Number.isFinite(secondsSinceLastSeen) &&
      secondsSinceLastSeen <= staleAfterSeconds
  };
}

function normalizeSystemSettings(input: SystemSettings): SystemSettings {
  const incomingPath =
    input.openlistIncomingPath.trim() || DEFAULT_SYSTEM_SETTINGS.openlistIncomingPath;
  return {
    openlistBaseUrl: trimTrailingSlash(input.openlistBaseUrl.trim()),
    openlistToken: input.openlistToken.trim(),
    openlist115Mode: normalize115Mode(input.openlist115Mode),
    openlistIncomingPath: incomingPath,
    mediaLibraryRoot:
      input.mediaLibraryRoot.trim() || DEFAULT_SYSTEM_SETTINGS.mediaLibraryRoot,
    seasonPathTemplate:
      input.seasonPathTemplate.trim() || "{title}/Season {season_pad}",
    episodeFileTemplate:
      input.episodeFileTemplate.trim() ||
      "{title} - S{season_pad}E{episode_pad}.{ext}",
    replaceExistingOnRevision: Boolean(input.replaceExistingOnRevision),
    proxyEnabled: Boolean(input.proxyEnabled),
    proxyUrl: normalizeProxyUrl(input.proxyUrl),
    tmdbBearerToken: input.tmdbBearerToken.trim(),
    workerIntervalSeconds: Math.max(30, Number(input.workerIntervalSeconds || 300)),
    downloadTimeoutMinutes: Math.min(
      24 * 60,
      Math.max(1, Number(input.downloadTimeoutMinutes || 30))
    ),
    mediaServerType: normalizeMediaServerType(input.mediaServerType),
    mediaServerUrl: trimTrailingSlash((input.mediaServerUrl ?? "").trim()),
    mediaServerToken: (input.mediaServerToken ?? "").trim(),
    mediaServerLibraryId: (input.mediaServerLibraryId ?? "").trim(),
    webhookEnabled: Boolean(input.webhookEnabled),
    webhookUrl: (input.webhookUrl ?? "").trim(),
    telegramEnabled: Boolean(input.telegramEnabled),
    telegramBotToken: (input.telegramBotToken ?? "").trim(),
    telegramChatId: (input.telegramChatId ?? "").trim(),
    barkEnabled: Boolean(input.barkEnabled),
    barkServerUrl: trimTrailingSlash(
      (input.barkServerUrl ?? "").trim() || DEFAULT_SYSTEM_SETTINGS.barkServerUrl
    ),
    barkDeviceKey: (input.barkDeviceKey ?? "").trim(),
    notifyOnCompleted: input.notifyOnCompleted !== false,
    notifyOnFailed: input.notifyOnFailed !== false,
    notifyOnNeedsReview: input.notifyOnNeedsReview !== false
  };
}

function normalize115Mode(value: unknown): SystemSettings["openlist115Mode"] {
  return value === "115 Open" ? "115 Open" : "115 Cloud";
}

function normalizeMediaServerType(value: unknown): MediaServerType {
  if (value === "jellyfin" || value === "emby" || value === "plex") {
    return value;
  }
  return "none";
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function normalizeProxyUrl(value: string) {
  const trimmed = value.trim() || DEFAULT_SYSTEM_SETTINGS.proxyUrl;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
  return trimTrailingSlash(withScheme);
}

function boolSetting(value: string | undefined, fallback: boolean) {
  if (value == null) return fallback;
  return value === "true" || value === "1";
}
