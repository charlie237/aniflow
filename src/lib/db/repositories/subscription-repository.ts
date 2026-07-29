import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { mapRule, mapSubscription } from "@/lib/db/mappers";
import {
  downloadJobs,
  episodeFiles,
  feedItems,
  filterRules,
  releaseMetadata,
  subscriptions,
  workerTasks
} from "@/lib/db/schema";
import type { RuleType } from "@/lib/db/types";
import { DEFAULT_SYSTEM_SETTINGS } from "@/lib/db/repositories/system-settings-repository";

export interface SubscriptionInput {
  name: string;
  rssUrl: string;
  enabled?: boolean;
  autoDownload?: boolean;
  seasonNumber?: number;
  destinationRoot?: string;
  incomingPath?: string | null;
  tmdbSeriesId?: number | null;
}

export function listSubscriptions() {
  return getDb()
    .select()
    .from(subscriptions)
    .orderBy(desc(subscriptions.enabled), asc(subscriptions.name))
    .all()
    .map((row) => mapSubscription(row as unknown as Record<string, unknown>));
}

export function listEnabledSubscriptions() {
  return getDb()
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.enabled, 1))
    .orderBy(asc(subscriptions.name))
    .all()
    .map((row) => mapSubscription(row as unknown as Record<string, unknown>));
}

export function getSubscription(id: number) {
  const row = getDb()
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, id))
    .get();
  return row ? mapSubscription(row as unknown as Record<string, unknown>) : null;
}

export function createSubscription(input: SubscriptionInput) {
  const values = normalizeSubscriptionInput(input);
  const result = getDb().insert(subscriptions).values(values).run();
  return getSubscription(Number(result.lastInsertRowid));
}

export function updateSubscription(id: number, input: SubscriptionInput) {
  const values = normalizeSubscriptionInput(input);
  getDb()
    .update(subscriptions)
    .set({ ...values, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(subscriptions.id, id))
    .run();
  return getSubscription(id);
}

export function archiveSubscription(id: number) {
  const changes = getDb().transaction((tx) => {
    const subscriptionChanges = tx
      .update(subscriptions)
      .set({ enabled: 0, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(subscriptions.id, id))
      .run().changes;
    const pausedJobs = tx
      .update(downloadJobs)
      .set({
        status: "discovered",
        errorMessage: "Subscription is archived; download submission paused",
        updatedAt: sql`CURRENT_TIMESTAMP`
      })
      .where(
        and(
          eq(downloadJobs.subscriptionId, id),
          eq(downloadJobs.status, "queued")
        )
      )
      .run().changes;
    return { subscriptionChanges, pausedJobs };
  });
  return { subscription: getSubscription(id), ...changes };
}

export function restoreSubscription(id: number) {
  getDb()
    .update(subscriptions)
    .set({ enabled: 1, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(subscriptions.id, id))
    .run();
  return getSubscription(id);
}

export function touchSubscriptionPolled(id: number) {
  getDb()
    .update(subscriptions)
    .set({
      lastPolledAt: sql`CURRENT_TIMESTAMP`,
      updatedAt: sql`CURRENT_TIMESTAMP`
    })
    .where(eq(subscriptions.id, id))
    .run();
}

export function listSubscriptionIdsWithInFlightJobs() {
  return getDb()
    .selectDistinct({ subscriptionId: downloadJobs.subscriptionId })
    .from(downloadJobs)
    .where(
      inArray(downloadJobs.status, [
        "downloading",
        "waiting_file",
        "ready_to_rename"
      ])
    )
    .all()
    .map((row) => row.subscriptionId);
}

export function deleteSubscription(id: number) {
  getDb().transaction((tx) => {
    const inFlight = tx
      .select({ id: downloadJobs.id, status: downloadJobs.status })
      .from(downloadJobs)
      .where(
        and(
          eq(downloadJobs.subscriptionId, id),
          inArray(downloadJobs.status, [
            "downloading",
            "waiting_file",
            "ready_to_rename"
          ])
        )
      )
      .all();
    if (inFlight.length > 0) {
      throw new Error(
        `Cannot delete subscription ${id} while download jobs are in flight: ${inFlight
          .map((job) => `#${job.id}(${job.status})`)
          .join(", ")}`
      );
    }

    const feedItemIds = tx
      .select({ id: feedItems.id })
      .from(feedItems)
      .where(eq(feedItems.subscriptionId, id));
    tx.delete(episodeFiles).where(eq(episodeFiles.subscriptionId, id)).run();
    tx.delete(downloadJobs).where(eq(downloadJobs.subscriptionId, id)).run();
    tx.delete(releaseMetadata)
      .where(inArray(releaseMetadata.feedItemId, feedItemIds))
      .run();
    tx.delete(feedItems).where(eq(feedItems.subscriptionId, id)).run();
    tx.delete(filterRules).where(eq(filterRules.subscriptionId, id)).run();
    tx.delete(workerTasks).where(eq(workerTasks.subscriptionId, id)).run();
    tx.delete(subscriptions).where(eq(subscriptions.id, id)).run();
  });
}

export function listRules(subscriptionId?: number) {
  const rows = subscriptionId
    ? getDb()
        .select()
        .from(filterRules)
        .where(eq(filterRules.subscriptionId, subscriptionId))
        .orderBy(asc(filterRules.type), asc(filterRules.value))
        .all()
    : getDb()
        .select()
        .from(filterRules)
        .orderBy(
          asc(filterRules.subscriptionId),
          asc(filterRules.type),
          asc(filterRules.value)
        )
        .all();
  return rows.map((row) => mapRule(row as unknown as Record<string, unknown>));
}

export function addRule(subscriptionId: number, type: RuleType, value: string) {
  getDb()
    .insert(filterRules)
    .values({ subscriptionId, type, value: value.trim() })
    .run();
}

export function replaceSubscriptionAllowRules(
  subscriptionId: number,
  rules: Array<{
    type: Extract<RuleType, "group_allow" | "resolution_allow" | "language_allow">;
    value: string;
  }>
) {
  getDb().transaction((tx) => {
    tx.delete(filterRules)
      .where(
        and(
          eq(filterRules.subscriptionId, subscriptionId),
          inArray(filterRules.type, [
            "group_allow",
            "resolution_allow",
            "language_allow"
          ])
        )
      )
      .run();
    for (const rule of rules) {
      tx.insert(filterRules)
        .values({
          subscriptionId,
          type: rule.type,
          value: rule.value.trim()
        })
        .run();
    }
  });
}

export function deleteRule(id: number) {
  getDb().delete(filterRules).where(eq(filterRules.id, id)).run();
}

function normalizeSubscriptionInput(input: SubscriptionInput) {
  return {
    name: input.name.trim(),
    rssUrl: input.rssUrl.trim(),
    enabled: input.enabled === false ? 0 : 1,
    autoDownload: input.autoDownload === false ? 0 : 1,
    seasonNumber: input.seasonNumber ?? 1,
    destinationRoot:
      input.destinationRoot?.trim() || DEFAULT_SYSTEM_SETTINGS.mediaLibraryRoot,
    incomingPath: input.incomingPath?.trim() || null,
    tmdbSeriesId: input.tmdbSeriesId ?? null
  };
}
