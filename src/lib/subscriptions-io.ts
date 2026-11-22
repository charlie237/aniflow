import { z } from "zod";
import { getDb } from "@/lib/db/client";
import {
  listRules,
  listSubscriptions
} from "@/lib/db/repositories";
import { filterRules, subscriptions } from "@/lib/db/schema";
import type { RuleType } from "@/lib/db/types";
import { isMikanRssUrl } from "@/lib/net/url-policy";

const exportedRuleSchema = z.object({
  type: z.enum([
    "group_allow",
    "group_block",
    "resolution_allow",
    "language_allow",
    "keyword_include",
    "keyword_exclude"
  ]),
  value: z.string().trim().min(1),
  enabled: z.boolean().optional().default(true)
});

const exportedSubscriptionSchema = z.object({
  name: z.string().trim().min(1).max(160),
  rssUrl: z.string().url().refine(isMikanRssUrl, {
    message: "Only mikanani.me/RSS/ or allowed Mikan mirror URLs are supported"
  }),
  enabled: z.boolean().optional().default(true),
  autoDownload: z.boolean().optional().default(true),
  seasonNumber: z.coerce.number().int().min(0).max(99).optional().default(1),
  episodeOffset: z.coerce.number().int().min(-999).max(999).optional().default(0),
  startEpisode: z.coerce.number().int().min(0).max(999).nullable().optional().default(null),
  destinationRoot: z.string().trim().min(1).optional().default("/115/Anime"),
  rules: z.array(exportedRuleSchema).optional().default([])
});

export const subscriptionsBackupSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string().optional(),
  subscriptions: z.array(exportedSubscriptionSchema).max(500)
});

export type SubscriptionsBackup = z.infer<typeof subscriptionsBackupSchema>;

export function exportSubscriptionsPayload(): SubscriptionsBackup {
  const allSubs = listSubscriptions();
  const allRules = listRules();
  const rulesBySub = new Map<number, typeof allRules>();
  for (const rule of allRules) {
    const list = rulesBySub.get(rule.subscriptionId) ?? [];
    list.push(rule);
    rulesBySub.set(rule.subscriptionId, list);
  }

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    subscriptions: allSubs.map((sub) => ({
      name: sub.name,
      rssUrl: sub.rssUrl,
      enabled: sub.enabled,
      autoDownload: sub.autoDownload,
      seasonNumber: sub.seasonNumber,
      episodeOffset: sub.episodeOffset,
      startEpisode: sub.startEpisode,
      destinationRoot: sub.destinationRoot,
      rules: (rulesBySub.get(sub.id) ?? []).map((rule) => ({
        type: rule.type,
        value: rule.value,
        enabled: rule.enabled
      }))
    }))
  };
}

export function importSubscriptionsPayload(input: unknown): {
  imported: number;
  skipped: number;
} {
  const parsed = subscriptionsBackupSchema.parse(input);
  const existingUrls = new Set(
    listSubscriptions().map((sub) => sub.rssUrl.trim())
  );

  let imported = 0;
  let skipped = 0;

  getDb().transaction((tx) => {
    for (const entry of parsed.subscriptions) {
      const rssUrl = entry.rssUrl.trim();
      if (existingUrls.has(rssUrl)) {
        skipped += 1;
        continue;
      }

      const result = tx
        .insert(subscriptions)
        .values({
          name: entry.name.trim(),
          rssUrl,
          enabled: entry.enabled ? 1 : 0,
          autoDownload: entry.autoDownload ? 1 : 0,
          seasonNumber: entry.seasonNumber,
          episodeOffset: entry.episodeOffset,
          startEpisode: entry.startEpisode,
          destinationRoot: entry.destinationRoot,
          incomingPath: null,
          tmdbSeriesId: null
        })
        .run();

      const subId = Number(result.lastInsertRowid);
      for (const rule of entry.rules) {
        tx.insert(filterRules)
          .values({
            subscriptionId: subId,
            type: rule.type as RuleType,
            value: rule.value.trim(),
            enabled: rule.enabled ? 1 : 0
          })
          .run();
      }
      existingUrls.add(rssUrl);
      imported += 1;
    }
  });

  return { imported, skipped };
}
