"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { redirect } from "next/navigation";
import {
  addRule,
  archiveSubscription,
  createOrUpdateJob,
  createSubscription,
  deleteRule,
  deleteSubscription,
  enqueueWorkerTask,
  getJob,
  getSystemSettings,
  getSubscription,
  listRules,
  replaceSubscriptionAllowRules,
  restoreSubscription,
  resetRuntimeData,
  saveSystemSettings,
  updateFeedItemEpisodeNumber,
  updateSubscription,
  upsertFeedItem
} from "@/lib/db/repositories";
import type { RuleType, SystemSettings, WorkerTaskType } from "@/lib/db/types";
import { cleanAndRetryJob, confirmJob, retryJob } from "@/lib/worker/pipeline";
import { kickWorkerTaskRunner } from "@/lib/worker/tasks";
import {
  check115Connectivity,
  configure115TempDir,
  ensureOpenListDirectory,
  type OpenList115CheckResult
} from "@/lib/openlist/client";
import { triggerMediaServerRefresh } from "@/lib/media-server/refresh";
import { sendNotification } from "@/lib/notifications/notifier";
import { getDictionary } from "@/lib/i18n/server";
import { RUNTIME_RESET_CONFIRM_PHRASE } from "@/lib/runtime-reset";
import { toBool } from "@/lib/utils";
import { isMikanDownloadUrl, isMikanRssUrl } from "@/lib/net/url-policy";

export interface ActionResult<T = undefined> {
  ok: boolean;
  message?: string;
  error?: string;
  data?: T;
}

const mikanRssUrlSchema = z.string().url().refine(isMikanRssUrl, {
  message: "Only mikanani.me/RSS/ or allowed Mikan mirror URLs are supported"
});

const parsedSubscriptionSchema = z.object({
  name: z.string().trim().min(1),
  rssUrl: mikanRssUrlSchema,
  releaseGroup: z.string().min(1),
  resolution: z.string().min(1),
  subtitleLanguage: z.string().min(1),
  seasonNumber: z.coerce.number().int().min(0).max(99),
  episodeOffset: z.coerce.number().int().min(-999).max(999).default(0),
  startEpisode: z.preprocess(
    (value) => (value === "" || value == null ? null : value),
    z.coerce.number().int().min(0).max(999).nullable()
  ),
  destinationRoot: z.string().trim().optional().default(""),
  autoDownload: z.boolean()
});

const editableSubscriptionSchema = parsedSubscriptionSchema.extend({
  id: z.coerce.number().int().positive()
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

const optionalHttpUrlSchema = z
  .string()
  .trim()
  .optional()
  .default("")
  .refine(isEmptyOrHttpUrl, {
    message: "Must be a valid http:// or https:// URL"
  });

const optionalProxyUrlSchema = z
  .string()
  .trim()
  .optional()
  .default("http://127.0.0.1:7890")
  .refine(isEmptyOrValidProxyUrl, {
    message: "Proxy URL must be a valid http:// or https:// URL"
  });

const settingsSchema = z.object({
  openlistBaseUrl: optionalHttpUrlSchema,
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
  proxyUrl: optionalProxyUrlSchema,
  tmdbBearerToken: z.string().optional().default(""),
  workerIntervalSeconds: z.coerce.number().int().min(30).max(86400),
  downloadTimeoutMinutes: z.coerce.number().int().min(1).max(24 * 60),
  mediaServerType: z.enum(["none", "jellyfin", "emby", "plex"]).default("none"),
  mediaServerUrl: optionalHttpUrlSchema,
  mediaServerToken: z.string().optional().default(""),
  mediaServerLibraryId: z.string().trim().optional().default(""),
  webhookEnabled: z.boolean().default(false),
  webhookUrl: optionalHttpUrlSchema,
  telegramEnabled: z.boolean().default(false),
  telegramBotToken: z.string().optional().default(""),
  telegramChatId: z.string().trim().optional().default(""),
  barkEnabled: z.boolean().default(false),
  barkServerUrl: optionalHttpUrlSchema,
  barkDeviceKey: z.string().optional().default(""),
  notifyOnCompleted: z.boolean().default(true),
  notifyOnFailed: z.boolean().default(true),
  notifyOnNeedsReview: z.boolean().default(true)
});

const manualEpisodeSchema = z.object({
  subscriptionId: z.coerce.number().int().positive(),
  episodeNumber: z.coerce.number().int().min(0).max(999),
  releaseRevision: z.coerce.number().int().min(1).max(99).default(1),
  sourceUrl: z.string().trim().min(1).refine(isDownloadUrl, {
    message: "Enter a magnet or Mikan torrent download URL"
  }),
  title: z.string().trim().optional().default("")
});

export async function createParsedSubscriptionAction(
  formData: FormData
): Promise<ActionResult> {
  const { t } = await getDictionary();
  try {
    const settings = getSystemSettings();
    const parsed = parsedSubscriptionSchema.parse({
      name: formData.get("name"),
      rssUrl: formData.get("rssUrl"),
      releaseGroup: optionalFormString(formData.get("releaseGroup")),
      resolution: optionalFormString(formData.get("resolution")),
      subtitleLanguage: optionalFormString(formData.get("subtitleLanguage")),
      seasonNumber: formData.get("seasonNumber") ?? 1,
      episodeOffset: formData.get("episodeOffset") || 0,
      startEpisode: formData.get("startEpisode"),
      destinationRoot: formData.get("destinationRoot")?.toString() ?? "",
      autoDownload: toBool(formData.get("autoDownload"))
    });

    const subscription = createSubscription({
      name: parsed.name,
      rssUrl: parsed.rssUrl,
      enabled: true,
      autoDownload: parsed.autoDownload,
      seasonNumber: parsed.seasonNumber,
      episodeOffset: parsed.episodeOffset,
      startEpisode: parsed.startEpisode,
      destinationRoot: parsed.destinationRoot || settings.mediaLibraryRoot,
      incomingPath: null
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
    return { ok: true, message: t("toast.subscriptionCreated") };
  } catch (error) {
    return { ok: false, error: formatActionError(error, t) };
  }
}

export async function updateParsedSubscriptionAction(
  formData: FormData
): Promise<ActionResult> {
  const { t } = await getDictionary();
  try {
    const settings = getSystemSettings();
    const existing = getSubscription(Number(formData.get("id")));
    if (!existing) {
      return { ok: false, error: "Subscription not found" };
    }

    const parsed = editableSubscriptionSchema.parse({
      id: formData.get("id"),
      name: formData.get("name"),
      rssUrl: formData.get("rssUrl"),
      releaseGroup: optionalFormString(formData.get("releaseGroup")),
      resolution: optionalFormString(formData.get("resolution")),
      subtitleLanguage: optionalFormString(formData.get("subtitleLanguage")),
      seasonNumber: formData.get("seasonNumber") ?? 1,
      episodeOffset: formData.get("episodeOffset") || 0,
      startEpisode: formData.get("startEpisode"),
      destinationRoot: formData.get("destinationRoot")?.toString() ?? "",
      autoDownload: toBool(formData.get("autoDownload"))
    });

    updateSubscription(parsed.id, {
      name: parsed.name,
      rssUrl: parsed.rssUrl,
      enabled: existing.enabled,
      autoDownload: parsed.autoDownload,
      seasonNumber: parsed.seasonNumber,
      episodeOffset: parsed.episodeOffset,
      startEpisode: parsed.startEpisode,
      destinationRoot:
        parsed.destinationRoot || existing.destinationRoot || settings.mediaLibraryRoot,
      // Legacy value is retained for database compatibility but no longer used.
      incomingPath: existing.incomingPath,
      tmdbSeriesId: existing.tmdbSeriesId
    });

    replaceSubscriptionAllowRules(parsed.id, [
      { type: "group_allow", value: parsed.releaseGroup },
      { type: "resolution_allow", value: parsed.resolution },
      { type: "language_allow", value: parsed.subtitleLanguage }
    ]);

    revalidatePath("/");
    revalidatePath("/subscriptions");
    return { ok: true, message: t("toast.subscriptionUpdated") };
  } catch (error) {
    return { ok: false, error: formatActionError(error, t) };
  }
}

export async function archiveSubscriptionAction(
  formData: FormData
): Promise<ActionResult> {
  const { t } = await getDictionary();
  try {
    const id = Number(formData.get("id"));
    if (!Number.isInteger(id) || id <= 0) {
      return { ok: false, error: "Invalid subscription id" };
    }
    archiveSubscription(id);
    revalidatePath("/");
    revalidatePath("/subscriptions");
    return { ok: true, message: t("toast.subscriptionArchived") };
  } catch (error) {
    return { ok: false, error: formatActionError(error, t) };
  }
}

export async function restoreSubscriptionAction(
  formData: FormData
): Promise<ActionResult> {
  const { t } = await getDictionary();
  try {
    const id = Number(formData.get("id"));
    if (!Number.isInteger(id) || id <= 0) {
      return { ok: false, error: "Invalid subscription id" };
    }
    const subscription = restoreSubscription(id);
    if (subscription) {
      enqueueAndKickWorkerTask("poll_subscription", subscription.id);
    }
    revalidatePath("/");
    revalidatePath("/subscriptions");
    return { ok: true, message: t("toast.subscriptionRestored") };
  } catch (error) {
    return { ok: false, error: formatActionError(error, t) };
  }
}

export async function addRuleAction(formData: FormData): Promise<ActionResult> {
  const { t } = await getDictionary();
  try {
    const parsed = ruleSchema.parse({
      subscriptionId: formData.get("subscriptionId"),
      type: formData.get("type"),
      value: formData.get("value")
    });
    addRule(parsed.subscriptionId, parsed.type as RuleType, parsed.value);
    revalidatePath("/");
    revalidatePath("/subscriptions");
    return { ok: true, message: t("toast.ruleAdded") };
  } catch (error) {
    return { ok: false, error: formatActionError(error, t) };
  }
}

export async function deleteRuleAction(formData: FormData): Promise<ActionResult> {
  const { t } = await getDictionary();
  try {
    const id = Number(formData.get("id"));
    if (Number.isFinite(id)) deleteRule(id);
    revalidatePath("/");
    revalidatePath("/subscriptions");
    return { ok: true, message: t("toast.ruleDeleted") };
  } catch (error) {
    return { ok: false, error: formatActionError(error, t) };
  }
}

export async function deleteSubscriptionAction(
  formData: FormData
): Promise<ActionResult> {
  const { t } = await getDictionary();
  try {
    const id = Number(formData.get("id"));
    if (!Number.isInteger(id) || id <= 0) {
      return { ok: false, error: "Invalid subscription id" };
    }
    deleteSubscription(id);
    revalidatePath("/");
    revalidatePath("/subscriptions");
    return { ok: true, message: t("toast.subscriptionDeleted") };
  } catch (error) {
    return { ok: false, error: formatActionError(error, t) };
  }
}

export async function pollSubscriptionAction(
  formData: FormData
): Promise<ActionResult> {
  const { t } = await getDictionary();
  try {
    const id = Number(formData.get("id"));
    if (!Number.isFinite(id)) return { ok: false, error: "Invalid subscription id" };
    const subscription = getSubscription(id);
    if (!subscription) return { ok: false, error: "Subscription not found" };
    enqueueAndKickWorkerTask("poll_subscription", subscription.id);
    revalidatePath("/");
    revalidatePath("/subscriptions");
    return { ok: true, message: t("toast.pollQueued") };
  } catch (error) {
    return { ok: false, error: formatActionError(error, t) };
  }
}

export async function pollAllSubscriptionsAction(): Promise<ActionResult> {
  const { t } = await getDictionary();
  try {
    enqueueAndKickWorkerTask("poll_all");
    revalidatePath("/");
    revalidatePath("/subscriptions");
    return { ok: true, message: t("toast.pollQueued") };
  } catch (error) {
    return { ok: false, error: formatActionError(error, t) };
  }
}

export async function pollSelectedSubscriptionAction(
  formData: FormData
): Promise<ActionResult> {
  const { t } = await getDictionary();
  try {
    const value = formData.get("subscriptionId")?.toString();
    if (value === "all") {
      enqueueAndKickWorkerTask("poll_all");
    } else {
      const id = Number(value);
      if (!Number.isFinite(id)) {
        return { ok: false, error: "Invalid subscription id" };
      }
      const subscription = getSubscription(id);
      if (!subscription) {
        return { ok: false, error: "Subscription not found" };
      }
      enqueueAndKickWorkerTask("poll_subscription", subscription.id);
    }
    revalidatePath("/");
    revalidatePath("/subscriptions");
    return { ok: true, message: t("toast.pollQueued") };
  } catch (error) {
    return { ok: false, error: formatActionError(error, t) };
  }
}

export async function submitQueueAction(): Promise<ActionResult> {
  const { t } = await getDictionary();
  try {
    enqueueAndKickWorkerTask("submit_queued");
    revalidatePath("/");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: formatActionError(error, t) };
  }
}

export async function scanIncomingAction(): Promise<ActionResult> {
  const { t } = await getDictionary();
  try {
    enqueueAndKickWorkerTask("scan_incoming");
    revalidatePath("/");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: formatActionError(error, t) };
  }
}

export async function retryJobAction(formData: FormData): Promise<ActionResult> {
  const { t } = await getDictionary();
  try {
    const id = Number(formData.get("id"));
    if (!Number.isFinite(id)) return { ok: false, error: "Invalid job id" };
    await retryJob(id);
    revalidatePath("/");
    return { ok: true, message: t("toast.jobRetried") };
  } catch (error) {
    revalidatePath("/");
    return { ok: false, error: formatActionError(error, t) };
  }
}

export async function cleanAndRetryJobAction(
  formData: FormData
): Promise<ActionResult> {
  const { t } = await getDictionary();
  try {
    const id = Number(formData.get("id"));
    if (!Number.isFinite(id)) return { ok: false, error: "Invalid job id" };
    await cleanAndRetryJob(id);
    revalidatePath("/");
    return { ok: true, message: t("toast.jobCleanedAndRetried") };
  } catch (error) {
    revalidatePath("/");
    return { ok: false, error: formatActionError(error, t) };
  }
}

const assignEpisodeSchema = z.object({
  id: z.coerce.number().int().positive(),
  episodeNumber: z.coerce.number().int().min(0).max(999),
  releaseRevision: z.preprocess(
    (value) => (value === "" || value == null ? undefined : value),
    z.coerce.number().int().min(1).max(99).optional()
  )
});

export async function assignEpisodeAndConfirmJobAction(
  formData: FormData
): Promise<ActionResult> {
  const { t } = await getDictionary();
  try {
    const parsed = assignEpisodeSchema.parse({
      id: formData.get("id"),
      episodeNumber: formData.get("episodeNumber"),
      releaseRevision: formData.get("releaseRevision")
    });
    const job = getJob(parsed.id);
    if (!job) return { ok: false, error: "Job not found" };
    updateFeedItemEpisodeNumber(
      job.feedItemId,
      parsed.episodeNumber,
      parsed.releaseRevision
    );
    await confirmJob(job.id);
    revalidatePath("/");
    return { ok: true, message: t("toast.jobConfirmed") };
  } catch (error) {
    revalidatePath("/");
    return { ok: false, error: formatActionError(error, t) };
  }
}

export async function confirmJobAction(formData: FormData): Promise<ActionResult> {
  const { t } = await getDictionary();
  try {
    const id = Number(formData.get("id"));
    if (!Number.isFinite(id)) return { ok: false, error: "Invalid job id" };
    await confirmJob(id);
    revalidatePath("/");
    return { ok: true, message: t("toast.jobConfirmed") };
  } catch (error) {
    revalidatePath("/");
    return { ok: false, error: formatActionError(error, t) };
  }
}

export async function forceConfirmJobAction(
  formData: FormData
): Promise<ActionResult> {
  const { t } = await getDictionary();
  try {
    const id = Number(formData.get("id"));
    if (!Number.isFinite(id)) return { ok: false, error: "Invalid job id" };
    await confirmJob(id, { force: true });
    revalidatePath("/");
    return { ok: true, message: t("toast.jobForceConfirmed") };
  } catch (error) {
    revalidatePath("/");
    return { ok: false, error: formatActionError(error, t) };
  }
}

export async function manualSupplementEpisodeAction(
  formData: FormData
): Promise<ActionResult> {
  const { t } = await getDictionary();
  try {
    const parsed = manualEpisodeSchema.parse({
      subscriptionId: formData.get("subscriptionId"),
      episodeNumber: formData.get("episodeNumber"),
      releaseRevision: formData.get("releaseRevision") || 1,
      sourceUrl: formData.get("sourceUrl"),
      title: formData.get("title")?.toString() ?? ""
    });
    const subscription = getSubscription(parsed.subscriptionId);
    if (!subscription) return { ok: false, error: "Subscription not found" };

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
      errorMessage: null
    });
    enqueueAndKickWorkerTask("submit_queued");
    revalidatePath("/");
    return { ok: true, message: t("toast.manualQueued") };
  } catch (error) {
    return { ok: false, error: formatActionError(error, t) };
  }
}

export async function saveSettingsAction(
  formData: FormData
): Promise<ActionResult> {
  const { t } = await getDictionary();
  try {
    const parsed = parseSettingsForm(formData);
    const settings = saveSystemSettings(parsed);
    await ensureConfiguredOpenListDirectories(settings).catch(() => undefined);
    revalidatePath("/");
    revalidatePath("/settings");
    return { ok: true, message: t("toast.settingsSaved") };
  } catch (error) {
    return { ok: false, error: formatActionError(error, t) };
  }
}

export async function check115ConnectivityAction(
  formData: FormData
): Promise<ActionResult<OpenList115CheckResult>> {
  const { t } = await getDictionary();
  try {
    const parsed = parseSettingsForm(formData);
    const settings = saveSystemSettings(parsed);
    const directoryCheck = await ensureConfiguredOpenListDirectoriesCheck(settings);
    const tempDirCheck = await configure115TempDirCheck(settings.openlistIncomingPath);
    const result = await check115Connectivity(t);
    const checks = [...result.checks];
    const apiCheckIndex = checks.findIndex((check) => check.label === "OpenList API");
    checks.splice(
      apiCheckIndex >= 0 ? apiCheckIndex + 1 : 0,
      0,
      directoryCheck,
      tempDirCheck
    );
    const mergedResult: OpenList115CheckResult = {
      ok: checks.every((check) => check.ok),
      checks
    };
    revalidatePath("/");
    revalidatePath("/settings");
    return {
      ok: mergedResult.ok,
      message: mergedResult.ok ? t("toast.checkPassed") : t("toast.checkFailed"),
      data: mergedResult
    };
  } catch (error) {
    return { ok: false, error: formatActionError(error, t) };
  }
}

export async function testMediaServerAction(
  formData: FormData
): Promise<ActionResult> {
  const { t } = await getDictionary();
  try {
    const parsed = parseSettingsForm(formData);
    saveSystemSettings(parsed);
    const result = await triggerMediaServerRefresh();
    revalidatePath("/settings");
    if (result.error) {
      return { ok: false, error: result.error };
    }
    if (!result.triggered) {
      return { ok: false, error: t("toast.mediaServerNotConfigured") };
    }
    return { ok: true, message: t("toast.mediaServerTestOk") };
  } catch (error) {
    return { ok: false, error: formatActionError(error, t) };
  }
}

export async function testNotificationAction(
  formData: FormData
): Promise<ActionResult> {
  const { t } = await getDictionary();
  try {
    const parsed = parseSettingsForm(formData);
    saveSystemSettings(parsed);
    const result = await sendNotification({
      type: "test",
      title: "Aniflow · Test notification",
      body: "Notification channels are configured and working."
    });
    revalidatePath("/settings");
    if (result.sent.length === 0 && result.failed.length === 0) {
      return { ok: false, error: t("toast.notificationNotConfigured") };
    }
    if (result.failed.length > 0) {
      return {
        ok: false,
        error: result.failed
          .map((item) => `${item.channel}: ${item.error}`)
          .join("; ")
      };
    }
    return {
      ok: true,
      message: t("toast.notificationTestOk", {
        channels: result.sent.join(", ")
      })
    };
  } catch (error) {
    return { ok: false, error: formatActionError(error, t) };
  }
}

export async function resetRuntimeDataAction(formData: FormData) {
  const typed = String(formData.get("confirmRuntimeReset") ?? "").trim();
  if (typed !== RUNTIME_RESET_CONFIRM_PHRASE) {
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
  const existing = getSystemSettings();
  const incomingPath =
    formData.get("openlistIncomingPath")?.toString() ?? "/115/Anime/_incoming";
  const mediaLibraryRoot =
    formData.get("mediaLibraryRoot")?.toString() ?? "/115/Anime";
  const submittedOpenlistToken = formData.get("openlistToken")?.toString().trim() ?? "";
  const clearOpenlistToken = toBool(formData.get("clearOpenlistToken"));
  const openlistToken = clearOpenlistToken
    ? ""
    : submittedOpenlistToken || existing.openlistToken;

  const submittedTmdbToken = formData.get("tmdbBearerToken")?.toString().trim() ?? "";
  const clearTmdbToken = toBool(formData.get("clearTmdbBearerToken"));
  const tmdbBearerToken = clearTmdbToken
    ? ""
    : submittedTmdbToken || existing.tmdbBearerToken;

  const submittedMediaServerToken =
    formData.get("mediaServerToken")?.toString().trim() ?? "";
  const mediaServerToken = toBool(formData.get("clearMediaServerToken"))
    ? ""
    : submittedMediaServerToken || existing.mediaServerToken;

  const submittedTelegramToken =
    formData.get("telegramBotToken")?.toString().trim() ?? "";
  const telegramBotToken = toBool(formData.get("clearTelegramBotToken"))
    ? ""
    : submittedTelegramToken || existing.telegramBotToken;

  const submittedBarkKey =
    formData.get("barkDeviceKey")?.toString().trim() ?? "";
  const barkDeviceKey = toBool(formData.get("clearBarkDeviceKey"))
    ? ""
    : submittedBarkKey || existing.barkDeviceKey;

  const parsed = settingsSchema.parse({
    openlistBaseUrl: formData.get("openlistBaseUrl")?.toString() ?? "",
    openlistToken,
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
    tmdbBearerToken,
    workerIntervalSeconds: formData.get("workerIntervalSeconds") ?? 300,
    downloadTimeoutMinutes: formData.get("downloadTimeoutMinutes") ?? 30,
    mediaServerType: formData.get("mediaServerType")?.toString() ?? "none",
    mediaServerUrl: formData.get("mediaServerUrl")?.toString() ?? "",
    mediaServerToken,
    mediaServerLibraryId: formData.get("mediaServerLibraryId")?.toString() ?? "",
    webhookEnabled: toBool(formData.get("webhookEnabled")),
    webhookUrl: formData.get("webhookUrl")?.toString() ?? "",
    telegramEnabled: toBool(formData.get("telegramEnabled")),
    telegramBotToken,
    telegramChatId: formData.get("telegramChatId")?.toString() ?? "",
    barkEnabled: toBool(formData.get("barkEnabled")),
    barkServerUrl:
      formData.get("barkServerUrl")?.toString() || "https://api.day.app",
    barkDeviceKey,
    notifyOnCompleted: toBool(formData.get("notifyOnCompleted")),
    notifyOnFailed: toBool(formData.get("notifyOnFailed")),
    notifyOnNeedsReview: toBool(formData.get("notifyOnNeedsReview"))
  }) satisfies SystemSettings;
  return parsed;
}

async function configure115TempDirCheck(
  tempDir: string
): Promise<OpenList115CheckResult["checks"][number]> {
  const settings = getSystemSettings();
  const { t } = await getDictionary();
  try {
    await configure115TempDir(tempDir);
    return {
      label: t("check.openlistSync"),
      ok: true,
      message: t("check.openlistSyncOk", {
        path: tempDir,
        mode: settings.openlist115Mode
      })
    };
  } catch (error) {
    return {
      label: t("check.openlistSync"),
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
  const { t } = await getDictionary();
  try {
    await ensureConfiguredOpenListDirectories(settings);
    return {
      label: t("check.openlistDirs"),
      ok: true,
      message: t("check.openlistDirsOk", {
        media: settings.mediaLibraryRoot,
        incoming: settings.openlistIncomingPath
      })
    };
  } catch (error) {
    return {
      label: t("check.openlistDirs"),
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
  return value.startsWith("magnet:?") || isMikanDownloadUrl(value);
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

function isEmptyOrHttpUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return true;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isEmptyOrValidProxyUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return true;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
  return isEmptyOrHttpUrl(candidate);
}

function optionalFormString(value: FormDataEntryValue | null) {
  const text = value?.toString().trim();
  return text || undefined;
}

function formatActionError(
  error: unknown,
  t: (key: string, params?: Record<string, string | number>) => string
) {
  if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    if (!issue) return "Invalid input";
    const field = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    return `${field}${issue.message}`;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/UNIQUE constraint failed:\s*subscriptions\.rss_url/i.test(message)) {
    return t("toast.duplicateRss");
  }
  return message;
}
