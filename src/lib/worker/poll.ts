import {
  createOrUpdateJob,
  getFeedItem,
  getJobForFeedItem,
  getLibraryEpisodeState,
  getMetadataForFeedItem,
  getPreferredFeedItemIdForRelease,
  getSubscription,
  getSystemSettings,
  listEnabledSubscriptions,
  listRules,
  touchSubscriptionPolled,
  updateJobStatus,
  upsertFeedItem
} from "@/lib/db/repositories";
import { fetchText } from "@/lib/net/fetch";
import { parseRss } from "@/lib/rss/parser";
import { evaluateRules } from "@/lib/rules/engine";
import { runDownloadMaintenance } from "@/lib/worker/download";
import { syncSubscriptionLibrary } from "@/lib/worker/library-sync";
import {
  contextualError,
  markSupersededJob,
  resolveEffectiveEpisodeNumber,
  supersedeSiblingRevisionJobs,
  type PipelineResult,
  type WorkerTaskProgress,
  type WorkerTaskProgressReporter
} from "@/lib/worker/pipeline-shared";

export async function pollAllSubscriptions(
  reportProgress?: WorkerTaskProgressReporter
) {
  const totals: PipelineResult = {
    fetched: 0,
    discovered: 0,
    queued: 0,
    skipped: 0,
    failed: 0
  };
  const errors: string[] = [];
  let lastProgress: WorkerTaskProgress | null = null;
  let failedProgress: WorkerTaskProgress | null = null;
  const report = (progress: WorkerTaskProgress) => {
    lastProgress = progress;
    reportProgress?.(progress);
  };

  const subscriptions = listEnabledSubscriptions();
  for (const [index, subscription] of subscriptions.entries()) {
    const progress = {
      detail: subscription.name,
      current: index + 1,
      total: subscriptions.length
    };
    try {
      report({ phase: "syncing_library", ...progress });
      await syncSubscriptionLibrary(subscription.id);
      report({ phase: "fetching_rss", ...progress });
      const result = await pollSubscriptionFeed(subscription.id, {
        reportProgress: report,
        ...progress
      });
      totals.fetched += result.fetched;
      totals.discovered += result.discovered;
      totals.queued += result.queued;
      totals.skipped += result.skipped;
      totals.failed += result.failed;
    } catch (error) {
      failedProgress ??= lastProgress;
      totals.failed += 1;
      const message = contextualError("Subscription poll failed", error, {
        subscriptionId: subscription.id,
        subscription: subscription.name
      });
      errors.push(message);
      console.error(`[pipeline] ${message}`);
    }
  }

  await runDownloadMaintenance(report);
  if (errors.length > 0) {
    if (failedProgress) reportProgress?.(failedProgress);
    throw new Error(errors.join("\n"));
  }
  return totals;
}

export async function refreshSubscriptionFeedCache(subscriptionId: number) {
  const subscription = getSubscription(subscriptionId);
  if (!subscription) throw new Error(`Subscription ${subscriptionId} not found`);

  const response = await fetchText(subscription.rssUrl, {
    headers: {
      "User-Agent": "Aniflow/0.1 RSS worker"
    }
  });

  if (!response.ok) {
    throw new Error(`RSS fetch failed (${response.status}) for ${subscription.name}`);
  }

  const items = parseRss(response.body);
  const rules = listRules(subscription.id);
  let stored = 0;
  for (const item of items) {
    // Only cache rule-matching releases — same policy as pollSubscription.
    if (!evaluateRules(item.title, item.metadata, rules).allowed) continue;
    upsertFeedItem(subscription, item);
    stored += 1;
  }
  touchSubscriptionPolled(subscription.id);

  return {
    fetched: items.length,
    discovered: stored
  };
}

export async function pollSubscription(
  subscriptionId: number,
  reportProgress?: WorkerTaskProgressReporter
): Promise<PipelineResult> {
  let lastProgress: WorkerTaskProgress | null = null;
  let failedProgress: WorkerTaskProgress | null = null;
  const report = (progress: WorkerTaskProgress) => {
    lastProgress = progress;
    reportProgress?.(progress);
  };
  try {
    const subscription = getSubscription(subscriptionId);
    if (subscription?.enabled) {
      report({
        phase: "syncing_library",
        detail: subscription.name,
        current: 1,
        total: 1
      });
      await syncSubscriptionLibrary(subscriptionId);
    }
    report({
      phase: "fetching_rss",
      detail: subscription?.name ?? null,
      current: 1,
      total: 1
    });
    return await pollSubscriptionFeed(subscriptionId, {
      reportProgress: report,
      detail: subscription?.name ?? null,
      current: 1,
      total: 1
    });
  } catch (error) {
    failedProgress = lastProgress;
    throw error;
  } finally {
    await runDownloadMaintenance(report);
    if (failedProgress) reportProgress?.(failedProgress);
  }
}

async function pollSubscriptionFeed(
  subscriptionId: number,
  progress?: {
    reportProgress?: WorkerTaskProgressReporter;
    detail?: string | null;
    current?: number | null;
    total?: number | null;
  }
): Promise<PipelineResult> {
  const subscription = getSubscription(subscriptionId);
  if (!subscription) throw new Error(`Subscription ${subscriptionId} not found`);

  const result: PipelineResult = {
    fetched: 0,
    discovered: 0,
    queued: 0,
    skipped: 0,
    failed: 0
  };

  if (!subscription.enabled) return result;

  const response = await fetchText(subscription.rssUrl, {
    headers: {
      "User-Agent": "Aniflow/0.1 RSS worker"
    }
  });

  if (!response.ok) {
    throw new Error(`RSS fetch failed (${response.status}) for ${subscription.name}`);
  }

  progress?.reportProgress?.({
    phase: "processing_feed",
    detail: progress.detail ?? subscription.name,
    current: progress.current ?? null,
    total: progress.total ?? null
  });

  const items = parseRss(response.body);
  result.fetched = items.length;
  const rules = listRules(subscription.id);
  const settings = getSystemSettings();

  // Phase 1: cache every rule-matching item so preferred revision is known
  // before any job is created (first download goes straight to v2 when present).
  const candidates: Array<{
    feedItemId: number;
    downloadUrl: string | null;
  }> = [];

  for (const item of items) {
    const decision = evaluateRules(item.title, item.metadata, rules);
    if (!decision.allowed) {
      result.skipped += 1;
      continue;
    }

    const feedItem = upsertFeedItem(subscription, item);
    result.discovered += 1;
    candidates.push({
      feedItemId: feedItem.id,
      downloadUrl: item.downloadUrl
    });
  }

  // Phase 2: only the preferred revision per variant may create/keep a job.
  for (const candidate of candidates) {
    const feedItem = getFeedItem(candidate.feedItemId);
    const metadata = getMetadataForFeedItem(candidate.feedItemId);
    if (!feedItem || !metadata) {
      result.skipped += 1;
      continue;
    }

    const preferredFeedItemId = getPreferredFeedItemIdForRelease(
      subscription.id,
      metadata
    );
    if (preferredFeedItemId != null && preferredFeedItemId !== feedItem.id) {
      markSupersededJob(feedItem.id);
      result.skipped += 1;
      continue;
    }

    if (preferredFeedItemId === feedItem.id) {
      supersedeSiblingRevisionJobs(subscription.id, feedItem.id, metadata);
    }

    const existingJob = getJobForFeedItem(feedItem.id);
    const effectiveEpisode = resolveEffectiveEpisodeNumber(
      metadata.episodeNumber,
      subscription.episodeOffset
    );
    if (
      subscription.startEpisode != null &&
      effectiveEpisode != null &&
      effectiveEpisode < subscription.startEpisode
    ) {
      if (
        existingJob &&
        ["discovered", "queued", "needs_review"].includes(existingJob.status)
      ) {
        updateJobStatus(existingJob.id, "skipped", {
          errorMessage: `Episode ${effectiveEpisode} is before start episode ${subscription.startEpisode}`
        });
      }
      result.skipped += 1;
      continue;
    }

    const libraryEpisode =
      effectiveEpisode == null
        ? null
        : getLibraryEpisodeState(subscription.id, effectiveEpisode);
    if (libraryEpisode) {
      const knownRevision = libraryEpisode.knownRevision;
      const isKnownUpgrade =
        knownRevision != null &&
        metadata.releaseRevision > knownRevision &&
        settings.replaceExistingOnRevision;

      const existingJobIsActiveOrFailed =
        existingJob != null &&
        ["downloading", "waiting_file", "ready_to_rename", "failed"].includes(
          existingJob.status
        );

      if (
        knownRevision == null &&
        metadata.releaseRevision > 1 &&
        !existingJobIsActiveOrFailed
      ) {
        createOrUpdateJob({
          subscriptionId: subscription.id,
          feedItemId: feedItem.id,
          status: "needs_review",
          sourceUrl: candidate.downloadUrl,
          targetPath: libraryEpisode.path,
          errorMessage:
            "Library episode exists but its revision is unknown; confirm before replacing it"
        });
        result.skipped += 1;
        continue;
      }

      if (!isKnownUpgrade) {
        if (
          existingJob &&
          ["discovered", "queued", "needs_review"].includes(existingJob.status)
        ) {
          updateJobStatus(existingJob.id, "skipped", {
            targetPath: libraryEpisode.path,
            errorMessage: "Library episode already exists; download was not submitted"
          });
        }
        result.skipped += 1;
        continue;
      }
    }

    if (existingJob) {
      // autoDownload was off when discovered; promote once enabled.
      if (
        existingJob.status === "discovered" &&
        subscription.autoDownload &&
        preferredFeedItemId === feedItem.id &&
        existingJob.sourceUrl
      ) {
        updateJobStatus(existingJob.id, "queued", {
          errorMessage: null
        });
        result.queued += 1;
        continue;
      }
      result.skipped += 1;
      continue;
    }

    if (!candidate.downloadUrl) {
      createOrUpdateJob({
        subscriptionId: subscription.id,
        feedItemId: feedItem.id,
        status: "needs_review",
        errorMessage: "No torrent or magnet URL found in RSS item"
      });
      result.failed += 1;
      continue;
    }

    if (metadata.needsReview || metadata.episodeNumber == null || effectiveEpisode == null) {
      createOrUpdateJob({
        subscriptionId: subscription.id,
        feedItemId: feedItem.id,
        status: "needs_review",
        sourceUrl: candidate.downloadUrl,
        errorMessage:
          metadata.episodeNumber != null && effectiveEpisode == null
            ? `Episode ${metadata.episodeNumber} with offset ${subscription.episodeOffset} produces an invalid episode number`
            : "Episode number could not be parsed"
      });
      result.skipped += 1;
      continue;
    }

    if (!subscription.autoDownload) {
      createOrUpdateJob({
        subscriptionId: subscription.id,
        feedItemId: feedItem.id,
        status: "discovered",
        sourceUrl: candidate.downloadUrl
      });
      result.skipped += 1;
      continue;
    }

    createOrUpdateJob({
      subscriptionId: subscription.id,
      feedItemId: feedItem.id,
      status: "queued",
      sourceUrl: candidate.downloadUrl
    });
    result.queued += 1;
  }

  touchSubscriptionPolled(subscription.id);
  return result;
}
