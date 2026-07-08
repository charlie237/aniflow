"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { redirect } from "next/navigation";
import {
  addRule,
  createSubscription,
  deleteRule,
  getSystemSettings,
  getSubscription,
  saveSystemSettings,
  updateSubscription
} from "@/lib/db/repositories";
import type { RuleType, SystemSettings } from "@/lib/db/types";
import {
  confirmJob,
  pollSubscription,
  retryJob,
  submitQueuedJobs
} from "@/lib/worker/pipeline";
import {
  check115Connectivity,
  configure115TempDir,
  type OpenList115CheckResult
} from "@/lib/openlist/client";
import { toBool } from "@/lib/utils";

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
  releaseGroup: z.string().optional(),
  resolution: z.string().optional(),
  subtitleLanguage: z.string().optional(),
  seasonNumber: z.coerce.number().int().min(0).max(99),
  incomingPath: z.string().optional(),
  autoDownload: z.boolean()
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
  openlist115TempDir: z.string().optional().default("/115/anime/_incoming"),
  openlistIncomingPath: z.string().optional().default("/115/anime/_incoming"),
  mediaLibraryRoot: z.string().optional().default("/115/anime"),
  seasonPathTemplate: z.string().optional().default("{title}/Season {season_pad}"),
  episodeFileTemplate: z
    .string()
    .optional()
    .default("{title} - S{season_pad}E{episode_pad}.{ext}"),
  proxyEnabled: z.boolean().default(false),
  proxyUrl: z.string().optional().default("http://127.0.0.1:7890"),
  tmdbBearerToken: z.string().optional().default(""),
  workerIntervalSeconds: z.coerce.number().int().min(30).max(86400)
});

export async function saveSubscriptionAction(formData: FormData) {
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

  if (parsed.id) {
    updateSubscription(parsed.id, parsed);
  } else {
    createSubscription(parsed);
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
    incomingPath: parsed.incomingPath ?? settings.openlistIncomingPath
  });

  if (subscription) {
    const rules: Array<[RuleType, string | undefined]> = [
      ["group_allow", parsed.releaseGroup],
      ["resolution_allow", parsed.resolution],
      ["language_allow", parsed.subtitleLanguage]
    ];
    for (const [type, value] of rules) {
      if (value) addRule(subscription.id, type, value);
    }
  }

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

export async function pollSubscriptionAction(formData: FormData) {
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) return;
  const subscription = getSubscription(id);
  if (!subscription) return;
  await pollSubscription(subscription.id);
  revalidatePath("/");
  revalidatePath("/subscriptions");
}

export async function submitQueueAction() {
  await submitQueuedJobs();
  revalidatePath("/");
}

export async function retryJobAction(formData: FormData) {
  const id = Number(formData.get("id"));
  if (Number.isFinite(id)) await retryJob(id);
  revalidatePath("/");
}

export async function confirmJobAction(formData: FormData) {
  const id = Number(formData.get("id"));
  if (Number.isFinite(id)) await confirmJob(id);
  revalidatePath("/");
}

export async function saveSettingsAction(formData: FormData) {
  const parsed = parseSettingsForm(formData);
  saveSystemSettings(parsed);
  revalidatePath("/");
  revalidatePath("/settings");
}

export async function check115ConnectivityAction(formData: FormData) {
  const parsed = parseSettingsForm(formData);
  const settings = saveSystemSettings(parsed);
  const tempDirCheck = await configure115TempDirCheck(settings.openlist115TempDir);
  const result = await check115Connectivity();
  const checks = [...result.checks];
  const apiCheckIndex = checks.findIndex((check) => check.label === "OpenList API");
  checks.splice(apiCheckIndex >= 0 ? apiCheckIndex + 1 : 0, 0, tempDirCheck);
  const mergedResult = {
    ok: checks.every((check) => check.ok),
    checks
  };
  const payload = Buffer.from(JSON.stringify(mergedResult)).toString("base64url");
  redirect(`/settings?check=${payload}`);
}

function parseSettingsForm(formData: FormData): SystemSettings {
  const parsed = settingsSchema.parse({
    openlistBaseUrl: formData.get("openlistBaseUrl")?.toString() ?? "",
    openlistToken: formData.get("openlistToken")?.toString() ?? "",
    openlist115Mode: formData.get("openlist115Mode")?.toString() ?? "115 Cloud",
    openlist115TempDir:
      formData.get("openlist115TempDir")?.toString() ??
      "/115/anime/_incoming",
    openlistIncomingPath:
      formData.get("openlistIncomingPath")?.toString() ??
      "/115/anime/_incoming",
    mediaLibraryRoot:
      formData.get("mediaLibraryRoot")?.toString() ?? "/115/anime",
    seasonPathTemplate:
      formData.get("seasonPathTemplate")?.toString() ??
      "{title}/Season {season_pad}",
    episodeFileTemplate:
      formData.get("episodeFileTemplate")?.toString() ??
      "{title} - S{season_pad}E{episode_pad}.{ext}",
    proxyEnabled: toBool(formData.get("proxyEnabled")),
    proxyUrl: formData.get("proxyUrl")?.toString() ?? "http://127.0.0.1:7890",
    tmdbBearerToken: formData.get("tmdbBearerToken")?.toString() ?? "",
    workerIntervalSeconds: formData.get("workerIntervalSeconds") ?? 300
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
      label: "OpenList 115 临时目录",
      ok: true,
      message: `${tempDir} 已写入 OpenList 的 ${settings.openlist115Mode} 临时目录`
    };
  } catch (error) {
    return {
      label: "OpenList 115 临时目录",
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

function optionalFormString(value: FormDataEntryValue | null) {
  const text = value?.toString().trim();
  if (text === "__none__") return undefined;
  return text || undefined;
}
