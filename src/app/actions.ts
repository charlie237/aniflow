"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { redirect } from "next/navigation";
import {
  addRule,
  createOrUpdateJob,
  createSubscription,
  deleteRule,
  deleteSubscription,
  enqueueWorkerTask,
  getSystemSettings,
  getSubscription,
  listRules,
  replaceSubscriptionAllowRules,
  resetRuntimeData,
  saveSystemSettings,
  updateSubscription,
  upsertFeedItem
} from "@/lib/db/repositories";
import type { RuleType, SystemSettings, WorkerTaskType } from "@/lib/db/types";
import {
  confirmJob,
  reorganizeJob,
  retryJob
} from "@/lib/worker/pipeline";
import { kickWorkerTaskRunner } from "@/lib/worker/tasks";
import {
  check115Connectivity,
  configure115TempDir,
  ensureOpenListDirectory,
  type OpenList115CheckResult
} from "@/lib/openlist/client";
import { toBool } from "@/lib/utils";
import {
  buildSubscriptionIncomingPath,
  isRemotePathWithin,
  joinRemotePath,
  resolveSubscriptionIncomingPath
} from "@/lib/utils/path";

const subscriptionSchema = z.object({
  id: z.coerce.number().optional(),
  name: z.string().min(1),
  rssUrl: z.string().url(),
  enabled: z.boolean(),
  autoDownload: z.boolean(),
  seasonNumber: z.coerce.number().int().min(0).max(99),
  destinationRoot: z.string().min(1),
  incomingPath: z.string().optional(),
  tmdbSeriesId: z
    .union([z.literal(""), z.coerce.number().int().positive()])
    .optional()
    .transform((value) => (value === "" || value == null ? null : Number(value)))
});

const parsedSubscriptionSchema = z.object({
  name: z.string().min(1),
  rssUrl: z.string().url(),
  releaseGroup: z.string().min(1),
  resolution: z.string().min(1),
  subtitleLanguage: z.string().min(1),
  seasonNumber: z.coerce.number().int().min(0).max(99),
  incomingPath: z.string().optional(),
  autoDownload: z.boolean()
});

const editableSubscriptionSchema = parsedSubscriptionSchema.extend({
  id: z.coerce.number().int().positive(),
  enabled: z.boolean()
});

const ruleSchema = z.object({
  subscriptionId: z.coerce.number().int().positive(),
  type: z.enum([
    "group_allow",
    "group_block",
    "resolution_allow",
    "language_allow",
    "keyword_include",
    "keyword_exclude"
  ]),
  value: z.string().min(1)
});

const settingsSchema = z.object({
  openlistBaseUrl: z.string().optional().default(""),
  openlistToken: z.string().optional().default(""),
  openlist115Mode: z.enum(["115 Cloud", "115 Open"]).default("115 Cloud"),
  openlistIncomingPath: z.string().optional().default("/115/Anime/_incoming"),
  mediaLibraryRoot: z.string().optional().default("/115/Anime"),
  seasonPathTemplate: z.string().optional().default("{title}/Season {season_pad}"),
  episodeFileTemplate: z
    .string()
    .optional()
    .default("{title} - S{season_pad}E{episode_pad}.{ext}"),
  replaceExistingOnRevision: z.boolean().default(true),
  proxyEnabled: z.boolean().default(false),
  proxyUrl: z.string().optional().default("http://127.0.0.1:7890"),
  tmdbBearerToken: z.string().optional().default(""),
  workerIntervalSeconds: z.coerce.number().int().min(30).max(86400),
  downloadTimeoutMinutes: z.coerce.number().int().min(1).max(24 * 60),
  downloadAutoRetryEnabled: z.boolean().default(true),
  downloadAutoRetryMaxAttempts: z.coerce.number().int().min(1).max(20),
  downloadAutoRetryCooldownMinutes: z.coerce.number().int().min(1).max(24 * 60)
});

const manualEpisodeSchema = z.object({
  subscriptionId: z.coerce.number().int().positive(),
  episodeNumber: z.coerce.number().int().min(0).max(999),
  releaseRevision: z.coerce.number().int().min(1).max(99).default(1),
  sourceUrl: z.string().trim().min(1).refine(isDownloadUrl, {
    message: "请输入 magnet 或 http(s) 下载链接"
  }),
  title: z.string().trim().optional().default("")
});

export async function saveSubscriptionAction(formData: FormData) {
  const settings = getSystemSettings();
  const parsed = subscriptionSchema.parse({
    id: formData.get("id") || undefined,
    name: formData.get("name"),
    rssUrl: formData.get("rssUrl"),
    enabled: toBool(formData.get("enabled")),
    autoDownload: toBool(formData.get("autoDownload")),
    seasonNumber: formData.get("seasonNumber"),
    destinationRoot: formData.get("destinationRoot"),
    incomingPath: formData.get("incomingPath")?.toString() || undefined,
    tmdbSeriesId: formData.get("tmdbSeriesId")?.toString() ?? ""
  });

  const existing = parsed.id ? getSubscription(parsed.id) : null;
  const incomingPath = resolveSubscriptionIncomingPathInput({
    name: parsed.name,
    incomingPath: parsed.incomingPath,
    incomingRoot: settings.openlistIncomingPath,
    previousName: existing?.name,
    previousIncomingPath: existing?.incomingPath
  });

  if (parsed.id) {
    updateSubscription(parsed.id, { ...parsed, incomingPath });
  } else {
    const subscription = createSubscription({ ...parsed, incomingPath });
    if (subscription) {
      enqueueAndKickWorkerTask("poll_subscription", subscription.id);
    }
  }

  revalidatePath("/");
  revalidatePath("/subscriptions");
}

export async function createParsedSubscriptionAction(formData: FormData) {
  const settings = getSystemSettings();
  const parsed = parsedSubscriptionSchema.parse({
    name: formData.get("name"),
    rssUrl: formData.get("rssUrl"),
    releaseGroup: optionalFormString(formData.get("releaseGroup")),
    resolution: optionalFormString(formData.get("resolution")),
    subtitleLanguage: optionalFormString(formData.get("subtitleLanguage")),
    seasonNumber: formData.get("seasonNumber") ?? 1,
    incomingPath: optionalFormString(formData.get("incomingPath")),
    autoDownload: toBool(formData.get("autoDownload"))
  });

  const subscription = createSubscription({
    name: parsed.name,
    rssUrl: parsed.rssUrl,
    enabled: true,
    autoDownload: parsed.autoDownload,
    seasonNumber: parsed.seasonNumber,
    destinationRoot: settings.mediaLibraryRoot,
    incomingPath: resolveSubscriptionIncomingPathInput({
      name: parsed.name,
      incomingPath: parsed.incomingPath,
      incomingRoot: settings.openlistIncomingPath
    })
  });

  if (subscription) {
    const rules: Array<[RuleType, string]> = [
      ["group_allow", parsed.releaseGroup],
      ["resolution_allow", parsed.resolution],
      ["language_allow", parsed.subtitleLanguage]
    ];
    for (const [type, value] of rules) {
      addRule(subscription.id, type, value);
    }
    enqueueAndKickWorkerTask("poll_subscription", subscription.id);
  }

  revalidatePath("/");
  revalidatePath("/subscriptions");
}

export async function updateParsedSubscriptionAction(formData: FormData) {
  const settings = getSystemSettings();
  const existing = getSubscription(Number(formData.get("id")));
  if (!existing) return;

  const parsed = editableSubscriptionSchema.parse({
    id: formData.get("id"),
    name: formData.get("name"),
    rssUrl: formData.get("rssUrl"),
    releaseGroup: optionalFormString(formData.get("releaseGroup")),
    resolution: optionalFormString(formData.get("resolution")),
    subtitleLanguage: optionalFormString(formData.get("subtitleLanguage")),
    seasonNumber: formData.get("seasonNumber") ?? 1,
    incomingPath: optionalFormString(formData.get("incomingPath")),
    enabled: toBool(formData.get("enabled")),
    autoDownload: toBool(formData.get("autoDownload"))
  });

  updateSubscription(parsed.id, {
    name: parsed.name,
    rssUrl: parsed.rssUrl,
    enabled: parsed.enabled,
    autoDownload: parsed.autoDownload,
    seasonNumber: parsed.seasonNumber,
    destinationRoot: existing.destinationRoot || settings.mediaLibraryRoot,
    incomingPath: resolveSubscriptionIncomingPathInput({
      name: parsed.name,
      incomingPath: parsed.incomingPath,
      incomingRoot: settings.openlistIncomingPath,
      previousName: existing.name,
      previousIncomingPath: existing.incomingPath
    }),
    tmdbSeriesId: existing.tmdbSeriesId
  });

  replaceSubscriptionAllowRules(parsed.id, [
    { type: "group_allow", value: parsed.releaseGroup },
    { type: "resolution_allow", value: parsed.resolution },
    { type: "language_allow", value: parsed.subtitleLanguage }
  ]);

  revalidatePath("/");
  revalidatePath("/subscriptions");
}

export async function addRuleAction(formData: FormData) {
  const parsed = ruleSchema.parse({
    subscriptionId: formData.get("subscriptionId"),
    type: formData.get("type"),
    value: formData.get("value")
  });
  addRule(parsed.subscriptionId, parsed.type as RuleType, parsed.value);
  revalidatePath("/");
  revalidatePath("/subscriptions");
}

export async function deleteRuleAction(formData: FormData) {
  const id = Number(formData.get("id"));
  if (Number.isFinite(id)) deleteRule(id);
  revalidatePath("/");
  revalidatePath("/subscriptions");
}

export async function deleteSubscriptionAction(formData: FormData) {
  const id = Number(formData.get("id"));
  if (Number.isFinite(id)) {
    const subscription = getSubscription(id);
    if (subscription && toBool(formData.get("cleanupIncoming"))) {
      const settings = getSystemSettings();
      enqueueWorkerTask({
        type: "cleanup_subscription_incoming",
        payload: {
          dedupeKey: `cleanup-subscription-incoming:${subscription.id}`,
          subscriptionName: subscription.name,
          incomingPath: resolveSubscriptionIncomingPath({
            incomingRoot: settings.openlistIncomingPath,
            subscriptionName: subscription.name,
            incomingPath: subscription.incomingPath
          }),
          rules: listRules(subscription.id)
            .filter((rule) => rule.enabled)
            .map((rule) => ({
              type: rule.type,
              value: rule.value,
              enabled: rule.enabled
            }))
        }
      });
      kickWorkerTaskRunner();
    }
    deleteSubscription(id);
  }
  revalidatePath("/");
  revalidatePath("/subscriptions");
}

export async function pollSubscriptionAction(formData: FormData) {
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) return;
  const subscription = getSubscription(id);
  if (!subscription) return;
  enqueueAndKickWorkerTask("poll_subscription", subscription.id);
  revalidatePath("/");
  revalidatePath("/subscriptions");
}

export async function pollAllSubscriptionsAction() {
  enqueueAndKickWorkerTask("poll_all");
  revalidatePath("/");
  revalidatePath("/subscriptions");
}

export async function pollSelectedSubscriptionAction(formData: FormData) {
  const value = formData.get("subscriptionId")?.toString();
  if (value === "all") {
    enqueueAndKickWorkerTask("poll_all");
  } else {
    const id = Number(value);
    if (!Number.isFinite(id)) return;
    const subscription = getSubscription(id);
    if (!subscription) return;
    enqueueAndKickWorkerTask("poll_subscription", subscription.id);
  }
  revalidatePath("/");
  revalidatePath("/subscriptions");
}

export async function submitQueueAction() {
  enqueueAndKickWorkerTask("submit_queued");
  revalidatePath("/");
}

export async function scanIncomingAction() {
  enqueueAndKickWorkerTask("scan_incoming");
  revalidatePath("/");
}

export async function retryJobAction(formData: FormData) {
  const id = Number(formData.get("id"));
  if (Number.isFinite(id)) await retryJob(id);
  revalidatePath("/");
}

/** Only re-scan/re-organize; do not re-submit offline download. */
export async function reorganizeJobAction(formData: FormData) {
  const id = Number(formData.get("id"));
  if (Number.isFinite(id)) await reorganizeJob(id);
  revalidatePath("/");
}

export async function confirmJobAction(formData: FormData) {
  const id = Number(formData.get("id"));
  if (Number.isFinite(id)) await confirmJob(id);
  revalidatePath("/");
}

export async function manualSupplementEpisodeAction(formData: FormData) {
  const parsed = manualEpisodeSchema.parse({
    subscriptionId: formData.get("subscriptionId"),
    episodeNumber: formData.get("episodeNumber"),
    releaseRevision: formData.get("releaseRevision") || 1,
    sourceUrl: formData.get("sourceUrl"),
    title: formData.get("title")?.toString() ?? ""
  });
  const subscription = getSubscription(parsed.subscriptionId);
  if (!subscription) return;

  const settings = getSystemSettings();
  const rules = listRules(subscription.id).filter((rule) => rule.enabled);
  const releaseGroup = coreRuleValue(rules, "group_allow");
  const resolution = coreRuleValue(rules, "resolution_allow");
  const subtitleLanguage = coreRuleValue(rules, "language_allow");
  const episodeText = String(parsed.episodeNumber).padStart(2, "0");
  const revisionSuffix =
    parsed.releaseRevision > 1 ? `v${parsed.releaseRevision}` : "";
  const title =
    parsed.title ||
    manualEpisodeTitle({
      subscriptionName: subscription.name,
      episodeText,
      revisionSuffix,
      releaseGroup,
      resolution,
      subtitleLanguage
    });
  const guid = [
    "manual",
    subscription.id,
    parsed.episodeNumber,
    parsed.releaseRevision,
    shortHash(parsed.sourceUrl)
  ].join(":");

  const feedItem = upsertFeedItem(subscription, {
    guid,
    rssGuid: guid,
    title,
    link: parsed.sourceUrl.startsWith("magnet:") ? null : parsed.sourceUrl,
    downloadUrl: parsed.sourceUrl,
    publishedAt: new Date().toISOString(),
    rawXmlJson: JSON.stringify({
      manual: true,
      sourceUrl: parsed.sourceUrl
    }),
    metadata: {
      releaseGroup,
      parsedTitle: subscription.name,
      episodeNumber: parsed.episodeNumber,
      episodeText,
      releaseRevision: parsed.releaseRevision,
      resolution,
      subtitleLanguage,
      container: null,
      tags: [releaseGroup, resolution, subtitleLanguage].filter(
        (value): value is string => Boolean(value)
      ),
      parseConfidence: 100,
      needsReview: false
    }
  });

  createOrUpdateJob({
    subscriptionId: subscription.id,
    feedItemId: feedItem.id,
    status: "queued",
    sourceUrl: parsed.sourceUrl,
    targetPath: resolveSubscriptionIncomingPath({
      incomingRoot: settings.openlistIncomingPath,
      subscriptionName: subscription.name,
      incomingPath: subscription.incomingPath
    }),
    errorMessage: null
  });
  enqueueAndKickWorkerTask("submit_queued");
  revalidatePath("/");
}

export async function saveSettingsAction(formData: FormData) {
  const parsed = parseSettingsForm(formData);
  const settings = saveSystemSettings(parsed);
  await ensureConfiguredOpenListDirectories(settings).catch(() => undefined);
  revalidatePath("/");
  revalidatePath("/settings");
}

export async function check115ConnectivityAction(formData: FormData) {
  const parsed = parseSettingsForm(formData);
  const settings = saveSystemSettings(parsed);
  const directoryCheck = await ensureConfiguredOpenListDirectoriesCheck(settings);
  const tempDirCheck = await configure115TempDirCheck(settings.openlistIncomingPath);
  const result = await check115Connectivity();
  const checks = [...result.checks];
  const apiCheckIndex = checks.findIndex((check) => check.label === "OpenList API");
  checks.splice(
    apiCheckIndex >= 0 ? apiCheckIndex + 1 : 0,
    0,
    directoryCheck,
    tempDirCheck
  );
  const mergedResult = {
    ok: checks.every((check) => check.ok),
    checks
  };
  const payload = Buffer.from(JSON.stringify(mergedResult)).toString("base64url");
  redirect(`/settings?check=${payload}`);
}

export async function resetRuntimeDataAction(formData: FormData) {
  if (!toBool(formData.get("confirmRuntimeReset"))) {
    redirect("/settings?reset=confirm");
  }

  resetRuntimeData();
  revalidatePath("/");
  revalidatePath("/settings");
  redirect("/settings?reset=runtime");
}

function enqueueAndKickWorkerTask(
  type: WorkerTaskType,
  subscriptionId?: number | null
) {
  enqueueWorkerTask({ type, subscriptionId });
  kickWorkerTaskRunner();
}

function parseSettingsForm(formData: FormData): SystemSettings {
  const incomingPath =
    formData.get("openlistIncomingPath")?.toString() ?? "/115/Anime/_incoming";
  const mediaLibraryRoot =
    formData.get("mediaLibraryRoot")?.toString() ?? "/115/Anime";
  const parsed = settingsSchema.parse({
    openlistBaseUrl: formData.get("openlistBaseUrl")?.toString() ?? "",
    openlistToken: formData.get("openlistToken")?.toString() ?? "",
    openlist115Mode: formData.get("openlist115Mode")?.toString() ?? "115 Cloud",
    openlistIncomingPath: incomingPath,
    mediaLibraryRoot: mediaLibraryRoot,
    seasonPathTemplate:
      formData.get("seasonPathTemplate")?.toString() ??
      "{title}/Season {season_pad}",
    episodeFileTemplate:
      formData.get("episodeFileTemplate")?.toString() ??
      "{title} - S{season_pad}E{episode_pad}.{ext}",
    replaceExistingOnRevision: toBool(formData.get("replaceExistingOnRevision")),
    proxyEnabled: toBool(formData.get("proxyEnabled")),
    proxyUrl: formData.get("proxyUrl")?.toString() ?? "http://127.0.0.1:7890",
    tmdbBearerToken: formData.get("tmdbBearerToken")?.toString() ?? "",
    workerIntervalSeconds: formData.get("workerIntervalSeconds") ?? 300,
    downloadTimeoutMinutes: formData.get("downloadTimeoutMinutes") ?? 30,
    downloadAutoRetryEnabled: toBool(formData.get("downloadAutoRetryEnabled")),
    downloadAutoRetryMaxAttempts:
      formData.get("downloadAutoRetryMaxAttempts") ?? 3,
    downloadAutoRetryCooldownMinutes:
      formData.get("downloadAutoRetryCooldownMinutes") ?? 10
  }) satisfies SystemSettings;
  return parsed;
}

async function configure115TempDirCheck(
  tempDir: string
): Promise<OpenList115CheckResult["checks"][number]> {
  const settings = getSystemSettings();
  try {
    await configure115TempDir(tempDir);
    return {
      label: "OpenList 后台同步",
      ok: true,
      message: `已把下载目录 ${tempDir} 同步到 OpenList 的 ${settings.openlist115Mode} 后台配置`
    };
  } catch (error) {
    return {
      label: "OpenList 后台同步",
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

async function ensureConfiguredOpenListDirectories(settings: SystemSettings) {
  if (!settings.openlistBaseUrl || !settings.openlistToken) return;
  await ensureOpenListDirectory(settings.mediaLibraryRoot);
  await ensureOpenListDirectory(settings.openlistIncomingPath);
}

async function ensureConfiguredOpenListDirectoriesCheck(
  settings: SystemSettings
): Promise<OpenList115CheckResult["checks"][number]> {
  try {
    await ensureConfiguredOpenListDirectories(settings);
    return {
      label: "OpenList 目录创建",
      ok: true,
      message: `已确认 ${settings.mediaLibraryRoot} 和 ${settings.openlistIncomingPath}`
    };
  } catch (error) {
    return {
      label: "OpenList 目录创建",
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

function coreRuleValue(
  rules: Array<{ type: RuleType; value: string }>,
  type: RuleType
) {
  return rules.find((rule) => rule.type === type)?.value ?? null;
}

function isDownloadUrl(value: string) {
  return value.startsWith("magnet:?") || /^https?:\/\/\S+$/i.test(value);
}

function shortHash(value: string) {
  return createHash("sha1").update(value).digest("hex").slice(0, 12);
}

function manualEpisodeTitle({
  subscriptionName,
  episodeText,
  revisionSuffix,
  releaseGroup,
  resolution,
  subtitleLanguage
}: {
  subscriptionName: string;
  episodeText: string;
  revisionSuffix: string;
  releaseGroup: string | null;
  resolution: string | null;
  subtitleLanguage: string | null;
}) {
  const prefix = releaseGroup ? `[${releaseGroup}] ` : "";
  const tags = [resolution, subtitleLanguage]
    .filter((value): value is string => Boolean(value))
    .map((value) => `[${value}]`)
    .join("");
  return `${prefix}${subscriptionName} - ${episodeText}${revisionSuffix}${tags}`;
}

/**
 * Prefer an explicit path; otherwise isolate under the global incoming root
 * by subscription name. If the form still submits only the global root (legacy
 * create flow), also split by name. When renaming and the path was the old
 * auto path, follow the new name.
 */
function resolveSubscriptionIncomingPathInput(params: {
  name: string;
  incomingPath?: string | null;
  incomingRoot: string;
  previousName?: string;
  previousIncomingPath?: string | null;
}) {
  const root = joinRemotePath(params.incomingRoot);
  const explicit = params.incomingPath?.trim();
  const autoForName = buildSubscriptionIncomingPath(root, params.name);
  const previousAuto = params.previousName
    ? buildSubscriptionIncomingPath(root, params.previousName)
    : null;
  const previousStored = params.previousIncomingPath?.trim()
    ? joinRemotePath(params.previousIncomingPath)
    : null;

  if (!explicit) return autoForName;

  const explicitPath = joinRemotePath(explicit);

  if (!isRemotePathWithin(explicitPath, root)) {
    throw new Error(`订阅下载目录必须位于全局下载根目录 ${root} 内`);
  }

  // Legacy create sent the shared root as the default path.
  if (explicitPath === root) return autoForName;

  // Renamed subscription still pointing at the previous auto path → follow name.
  if (
    previousAuto &&
    previousStored &&
    explicitPath === previousAuto &&
    previousStored === previousAuto &&
    params.previousName &&
    params.previousName !== params.name
  ) {
    return autoForName;
  }

  return explicitPath;
}

function optionalFormString(value: FormDataEntryValue | null) {
  const text = value?.toString().trim();
  return text || undefined;
}
