import { randomUUID } from "node:crypto";
import type {
  DownloadJob,
  ReleaseMetadata,
  Subscription
} from "@/lib/db/types";
import {
  acquireWorkerLease,
  claimQueuedJob,
  createOrUpdateJob,
  failStaleDownloadingJobs,
  getFeedItem,
  getJob,
  getJobForFeedItem,
  getLibraryEpisodeState,
  getMetadataForFeedItem,
  getHighestReleaseRevisionForVariant,
  getLibraryFileRevisionAtPath,
  getPreferredFeedItemIdForRelease,
  getSystemSettings,
  getSubscription,
  libraryFileExistsAtPath,
  listEnabledSubscriptions,
  listJobsByStatus,
  listRules,
  listSubscriptions,
  listVariantFeedItemIds,
  markJobAttempt,
  migrateLegacyDownloadJobsToFailed,
  refreshWorkerLease,
  releaseWorkerLease,
  syncLibraryEpisodeInventory,
  touchSubscriptionPolled,
  updateJobStatus,
  upsertEpisodeFile,
  upsertFeedItem
} from "@/lib/db/repositories";
import { fetchText } from "@/lib/net/fetch";
import {
  add115OfflineDownload,
  ensureOpenListDirectory,
  isOfflineTaskFailed,
  isOpenListNotFoundError,
  listOfflineDownloadDone,
  listOfflineDownloadTransferUndone,
  listOfflineDownloadUndone,
  listOpenListFiles,
  moveOpenListFiles,
  renameOpenListFile,
  removeOpenListFiles,
  type OpenListFileEntry
} from "@/lib/openlist/client";
import { evaluateRules } from "@/lib/rules/engine";
import { parseRss } from "@/lib/rss/parser";
import { parseReleaseTitle } from "@/lib/rss/title-parser";
import { resolveOfflineDownloadUrl } from "@/lib/torrent/magnet";
import {
  buildEpisodePath,
  buildSeasonLibraryPath,
  extractEpisodeNumberFromFilename,
  getExtension,
  getRemoteBaseName,
  getRemoteDirName,
  isMediaFile,
  isRemotePathWithin,
  joinRemotePath
} from "@/lib/utils/path";
import {
  canImportReleaseRevision,
  canOverwriteLibraryFile,
  resolveClaimedRevision
} from "@/lib/worker/revision-policy";

export interface PipelineResult {
  /** Total items in the RSS feed this poll. */
  fetched: number;
  /** Items that matched rules and were written to SQLite. */
  discovered: number;
  queued: number;
  skipped: number;
  failed: number;
}

const INCOMING_MUTATION_LEASE = "incoming-mutation";
const INCOMING_MUTATION_LEASE_SECONDS = 2 * 60 * 60;

export async function pollAllSubscriptions() {
  const totals: PipelineResult = {
    fetched: 0,
    discovered: 0,
    queued: 0,
    skipped: 0,
    failed: 0
  };
  const errors: string[] = [];

  for (const subscription of listEnabledSubscriptions()) {
    try {
      await syncSubscriptionLibrary(subscription.id);
      const result = await pollSubscriptionFeed(subscription.id);
      totals.fetched += result.fetched;
      totals.discovered += result.discovered;
      totals.queued += result.queued;
      totals.skipped += result.skipped;
      totals.failed += result.failed;
    } catch (error) {
      totals.failed += 1;
      const message = contextualError("Subscription poll failed", error, {
        subscriptionId: subscription.id,
        subscription: subscription.name
      });
      errors.push(message);
      console.error(`[pipeline] ${message}`);
    }
  }

  await runDownloadMaintenance();
  if (errors.length > 0) {
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

export async function pollSubscription(subscriptionId: number): Promise<PipelineResult> {
  try {
    const subscription = getSubscription(subscriptionId);
    if (subscription?.enabled) {
      await syncSubscriptionLibrary(subscriptionId);
    }
    return await pollSubscriptionFeed(subscriptionId);
  } finally {
    await runDownloadMaintenance();
  }
}

async function pollSubscriptionFeed(subscriptionId: number): Promise<PipelineResult> {
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

    const existingJob = getJobForItem(feedItem.id);
    const libraryEpisode =
      metadata.episodeNumber == null
        ? null
        : getLibraryEpisodeState(subscription.id, metadata.episodeNumber);
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

    if (metadata.needsReview || metadata.episodeNumber == null) {
      createOrUpdateJob({
        subscriptionId: subscription.id,
        feedItemId: feedItem.id,
        status: "needs_review",
        sourceUrl: candidate.downloadUrl,
        errorMessage: "Episode number could not be parsed"
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

/** Keep download lifecycle work independent from RSS polling success. */
export async function runDownloadMaintenance() {
  const migrated = migrateLegacyDownloadJobsToFailed();
  if (migrated > 0) {
    console.log(
      `[pipeline] marked ${migrated} legacy shared-path download job(s) as failed`
    );
  }
  // A file already present in the job-owned directory is the strongest completion signal.
  await scanAndRenameIncoming();
  await reconcileDownloadingJobs();
  await submitQueuedJobs();
}

export async function submitQueuedJobs() {
  const jobs = listJobsByStatus(["queued"]);
  for (const job of jobs) {
    await submitJob(job);
  }
}

/**
 * Surface exact OpenList task failures. The task id is diagnostic only: files
 * are always discovered from the job-owned target_path.
 */
export async function reconcileDownloadingJobs() {
  const settings = getSystemSettings();
  const staleSeconds = Math.max(1, settings.downloadTimeoutMinutes) * 60;
  const openJobs = listJobsByStatus(["downloading"]);
  if (openJobs.length === 0) {
    const failed = failStaleDownloadingJobs(staleSeconds);
    return { checked: 0, failed };
  }

  let failed = 0;
  if (settings.openlistBaseUrl && settings.openlistToken) {
    const [undoneResult, doneResult, transferringResult] = await Promise.all([
      listOfflineDownloadUndone(),
      listOfflineDownloadDone(),
      listOfflineDownloadTransferUndone()
    ]);
    const undone = undoneResult.tasks;
    const done = doneResult.tasks;
    const transferring = transferringResult.tasks;
    const byId = new Map<string, (typeof undone)[number]>();
    for (const task of [...undone, ...done, ...transferring]) {
      if (task.id) byId.set(String(task.id), task);
    }
    const unavailable = [
      { name: "offline_download/undone", result: undoneResult },
      { name: "offline_download/done", result: doneResult },
      { name: "offline_download_transfer/undone", result: transferringResult }
    ]
      .filter(({ result }) => !result.available)
      .map(({ name, result }) => `${name}: ${result.error ?? "unavailable"}`);

    for (const job of openJobs) {
      if (!job.openlistTaskId) continue;
      const taskId = String(job.openlistTaskId);
      const task = byId.get(taskId);
      if (task && isOfflineTaskFailed(task)) {
        updateJobStatus(job.id, "failed", {
          errorMessage: contextualError(
            "OpenList offline task failed",
            task.error?.trim() || `${task.status || task.state}`,
            { taskId, targetPath: job.targetPath }
          )
        });
        failed += 1;
        continue;
      }
      if (!task && unavailable.length > 0) {
        updateJobStatus(job.id, "failed", {
          errorMessage: contextualError(
            "Unable to query OpenList offline task",
            unavailable.join("; "),
            { taskId, targetPath: job.targetPath }
          )
        });
        failed += 1;
      }
    }
  }

  failed += failStaleDownloadingJobs(staleSeconds);
  return { checked: openJobs.length, failed };
}

/** User-triggered reset and one fresh submit. Remote cleanup is always manual. */
export async function retryJob(jobId: number) {
  const job = getJob(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);
  if (job.status !== "failed") {
    throw new Error(
      `Job ${jobId} cannot be retried from status ${job.status}; expected failed`
    );
  }
  const targetPath = incomingPathForJob(job.id);
  try {
    await assertJobTargetDirectoryEmpty(targetPath, "Cannot resubmit download");
  } catch (error) {
    const message = contextualError("Manual resubmit preflight failed", error, {
      targetPath
    });
    updateJobStatus(job.id, "failed", {
      targetPath,
      errorMessage: message
    });
    console.error(`[pipeline] job#${job.id} resubmit blocked: ${message}`);
    return;
  }
  console.log(`[pipeline] user resubmit job#${job.id}`);
  updateJobStatus(job.id, "queued", {
    errorMessage: null,
    clearOpenlistTaskId: true,
    targetPath
  });
  await submitJob({
    ...job,
    status: "queued",
    openlistTaskId: null,
    errorMessage: null,
    targetPath
  });
}

export async function confirmJob(jobId: number) {
  const job = getJob(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);
  if (!["discovered", "needs_review"].includes(job.status)) {
    throw new Error(
      `Job ${jobId} cannot be confirmed from status ${job.status}; expected discovered or needs_review`
    );
  }
  console.log(`[pipeline] confirm job#${job.id}`);
  updateJobStatus(job.id, "queued", {
    errorMessage: null,
    clearOpenlistTaskId: true
  });
  await submitJob({ ...job, status: "queued", openlistTaskId: null });
}

export async function submitJob(job: DownloadJob) {
  try {
    await submitJobOnce(job);
  } catch (error) {
    const message = contextualError("Download pipeline failed", error, {
      jobId: job.id,
      targetPath: incomingPathForJob(job.id),
      sourceUrl: job.sourceUrl
    });
    updateJobStatus(job.id, "failed", {
      targetPath: incomingPathForJob(job.id),
      errorMessage: message
    });
    console.error(`[pipeline] job#${job.id} failed: ${message}`);
  }
}

async function submitJobOnce(job: DownloadJob) {
  if (!job.sourceUrl) {
    updateJobStatus(job.id, "failed", {
      errorMessage: "Job has no source URL"
    });
    return;
  }

  const subscription = getSubscription(job.subscriptionId);
  if (!subscription) {
    updateJobStatus(job.id, "failed", {
      errorMessage: "Subscription no longer exists"
    });
    return;
  }
  if (!subscription.enabled) {
    updateJobStatus(job.id, "discovered", {
      errorMessage: "Subscription is disabled; download submission paused"
    });
    return;
  }

  const feedItem = getFeedItem(job.feedItemId);
  const metadata = getMetadataForFeedItem(job.feedItemId);
  if (feedItem && metadata) {
    const preferredFeedItemId = getPreferredFeedItemIdForRelease(
      subscription.id,
      metadata
    );
    if (preferredFeedItemId != null && preferredFeedItemId !== feedItem.id) {
      updateJobStatus(job.id, "skipped", {
        errorMessage: "Superseded by a newer release revision"
      });
      return;
    }

    if (preferredFeedItemId === feedItem.id) {
      supersedeSiblingRevisionJobs(subscription.id, feedItem.id, metadata);
    }

    const decision = evaluateRules(feedItem.title, metadata, listRules(subscription.id));
    if (!decision.allowed) {
      updateJobStatus(job.id, "skipped", {
        errorMessage: decision.reasons.join("; ")
      });
      return;
    }
  }

  const targetPath = incomingPathForJob(job.id);

  let claimedAttempt = false;
  let returnedTaskId: string | null = null;
  try {
    const offlineUrl = await resolveOfflineDownloadUrl(job.sourceUrl);
    // Create the owned directory before exposing the job as downloading. The
    // atomic claim writes target_path too, closing the web/worker submit race.
    await ensureOpenListDirectory(targetPath);
    if (job.status === "queued") {
      if (!claimQueuedJob(job.id, targetPath)) {
        console.log(`[pipeline] job#${job.id} already claimed by another worker`);
        return;
      }
      claimedAttempt = true;
    }
    await assertJobTargetDirectoryEmpty(targetPath, "Cannot submit download");
    const tasks = await add115OfflineDownload({
      urls: [offlineUrl],
      path: targetPath
    });
    const task = tasks[0];
    const taskId = task?.id ? String(task.id) : null;
    returnedTaskId = taskId;
    const taskError = task?.error?.trim() || "";
    if (taskError) throw new Error(taskError);
    markJobAttempt(
      job.id,
      {
        status: "downloading",
        openlistTaskId: taskId,
        targetPath,
        errorMessage: null
      },
      { incrementAttempt: !claimedAttempt }
    );
    console.log(
      `[pipeline] job#${job.id} submitted path=${targetPath} task=${taskId ?? "n/a"}`
    );
  } catch (error) {
    const message = contextualError("Submit offline download failed", error, {
      targetPath,
      sourceUrl: job.sourceUrl
    });
    markJobAttempt(job.id, {
      status: "failed",
      ...(returnedTaskId ? { openlistTaskId: returnedTaskId } : {}),
      targetPath,
      errorMessage: message
    }, { incrementAttempt: !claimedAttempt });
    console.error(`[pipeline] job#${job.id} submit failed: ${message}`);
  }
}

async function assertJobTargetDirectoryEmpty(targetPath: string, action: string) {
  await ensureOpenListDirectory(targetPath);
  const entries = await listOpenListFiles(targetPath, { refresh: true });
  if (entries.length === 0) return;
  throw new Error(
    `${action}: target directory is not empty; clean it in OpenList first (targetPath=${targetPath}, entries=${entries
      .slice(0, 5)
      .map((entry) => entry.name)
      .join(", ")})`
  );
}

/** Rebuild one subscription season's file index before RSS jobs are created. */
export async function syncSubscriptionLibrary(subscriptionId: number) {
  const subscription = getSubscription(subscriptionId);
  if (!subscription) throw new Error(`Subscription ${subscriptionId} not found`);

  const settings = getSystemSettings();
  if (!settings.openlistBaseUrl || !settings.openlistToken) {
    return {
      root: null,
      scanned: 0,
      recognized: 0,
      unrecognized: 0,
      imported: 0,
      updated: 0,
      removed: 0,
      available: false
    };
  }

  const seasonRoot = buildSeasonLibraryPath({
    destinationRoot: libraryRootForSubscription(subscription),
    subscriptionName: subscription.name,
    seasonNumber: subscription.seasonNumber,
    seasonPathTemplate: settings.seasonPathTemplate
  });

  let files: OpenListFileEntry[];
  try {
    files = await listLibraryMediaFiles(seasonRoot);
  } catch (error) {
    if (!isOpenListNotFoundError(error)) throw error;
    files = [];
  }

  const inventory = files.map((file) => {
    const parsed = parseReleaseTitle(file.name);
    const templateEpisode = extractEpisodeNumberFromFilename({
      filename: file.name,
      seasonNumber: subscription.seasonNumber,
      episodeFileTemplate: settings.episodeFileTemplate
    });
    const parsedEpisode =
      parsed.seasonNumber == null || parsed.seasonNumber === subscription.seasonNumber
        ? parsed.episodeNumber
        : null;
    return {
      path: file.path,
      episodeNumber: templateEpisode ?? parsedEpisode,
      sizeBytes: file.size
    };
  });
  const synced = syncLibraryEpisodeInventory(
    subscription.id,
    seasonRoot,
    inventory
  );
  const recognized = inventory.filter((file) => file.episodeNumber != null).length;
  const result = {
    root: seasonRoot,
    scanned: inventory.length,
    recognized,
    unrecognized: inventory.length - recognized,
    ...synced,
    available: true
  };
  console.log(
    `[pipeline] library sync subscription#${subscription.id} ${JSON.stringify(result)}`
  );
  return result;
}

export async function scanAndRenameIncoming() {
  const settings = getSystemSettings();
  if (!settings.openlistBaseUrl || !settings.openlistToken) {
    return;
  }

  const leaseOwner = randomUUID();
  if (
    !acquireWorkerLease(
      INCOMING_MUTATION_LEASE,
      leaseOwner,
      INCOMING_MUTATION_LEASE_SECONDS
    )
  ) {
    console.log("[pipeline] incoming scan skipped; another process holds the lease");
    return;
  }

  try {
    for (const job of listJobsByStatus(["downloading"])) {
      try {
        assertIncomingMutationLease(leaseOwner);
        await scanJobTarget(job);
      } catch (error) {
        const message = contextualError("Download scan pipeline failed", error, {
          jobId: job.id,
          targetPath: job.targetPath
        });
        updateJobStatus(job.id, "failed", { errorMessage: message });
        console.error(`[pipeline] job#${job.id} scan failed: ${message}`);
        if (/lease was lost/i.test(errorMessage(error))) break;
      }
    }
  } finally {
    releaseWorkerLease(INCOMING_MUTATION_LEASE, leaseOwner);
  }
}

async function scanJobTarget(job: DownloadJob) {
  const targetPath = incomingPathForJob(job.id);
  if (joinRemotePath(job.targetPath ?? "") !== targetPath) {
    updateJobStatus(job.id, "failed", {
      targetPath: job.targetPath,
      errorMessage: contextualError(
        "Cannot scan legacy shared download directory",
        "This job must be cleaned in OpenList and manually resubmitted",
        { targetPath: job.targetPath, expectedTargetPath: targetPath }
      )
    });
    return;
  }

  const subscription = getSubscription(job.subscriptionId);
  const metadata = getMetadataForFeedItem(job.feedItemId);
  if (!subscription || metadata?.episodeNumber == null) {
    updateJobStatus(job.id, "failed", {
      errorMessage: contextualError(
        "Cannot validate downloaded file",
        subscription ? "Expected episode metadata is missing" : "Subscription no longer exists",
        { targetPath }
      )
    });
    return;
  }

  let files: OpenListFileEntry[];
  try {
    files = await listIncomingMediaFiles(targetPath);
  } catch (error) {
    updateJobStatus(job.id, "failed", {
      errorMessage: contextualError("Scan job download directory failed", error, {
        targetPath
      })
    });
    return;
  }
  if (files.length === 0) return;

  if (files.length !== 1) {
    updateJobStatus(job.id, "failed", {
      errorMessage: contextualError(
        "Downloaded file validation failed",
        `Multiple media files found; expected exactly one for episode ${metadata.episodeNumber}`,
        {
          targetPath,
          files: files.map((file) => file.name).join(", ")
        }
      )
    });
    return;
  }

  const file = files[0];
  const parsed = parseReleaseTitle(file.name);
  const episode =
    parsed.episodeNumber ??
    extractEpisodeNumberFromFilename({
      filename: file.name,
      seasonNumber: subscription.seasonNumber,
      episodeFileTemplate: getSystemSettings().episodeFileTemplate
    });
  if (episode !== metadata.episodeNumber) {
    updateJobStatus(job.id, "failed", {
      errorMessage: contextualError(
        "Downloaded file validation failed",
        `Media file episode ${episode ?? "unknown"} does not match expected episode ${metadata.episodeNumber}`,
        { targetPath, file: file.name }
      )
    });
    return;
  }

  await organizeJobFile(file, subscription, job, metadata.episodeNumber);
}

async function organizeJobFile(
  file: OpenListFileEntry,
  subscription: Subscription,
  job: DownloadJob,
  expectedEpisodeNumber: number
) {
  const parsed = parseReleaseTitle(file.name);
  const extension = getExtension(file.name);
  if (!extension) {
    updateJobStatus(job.id, "failed", {
      errorMessage: contextualError(
        "Downloaded file validation failed",
        "Media file extension is missing",
        { sourcePath: file.path, targetPath: job.targetPath }
      )
    });
    return;
  }

  const settings = getSystemSettings();
  const finalPath = buildEpisodePath({
    destinationRoot: libraryRootForSubscription(subscription),
    subscriptionName: subscription.name,
    seasonNumber: subscription.seasonNumber,
    episodeNumber: expectedEpisodeNumber,
    extension,
    seasonPathTemplate: settings.seasonPathTemplate,
    episodeFileTemplate: settings.episodeFileTemplate
  });
  const finalDir = getRemoteDirName(finalPath);
  const finalName = getRemoteBaseName(finalPath);
  const sourceDir = getRemoteDirName(file.path);
  let currentName = getRemoteBaseName(file.path);
  let currentPath = file.path;
  const effectiveMetadata = getMetadataForFeedItem(job.feedItemId);
  const feedItemId = job.feedItemId;
  const cleanupRoot = joinRemotePath(settings.openlistIncomingPath, "jobs");

  const variantFacets = {
    episodeNumber: effectiveMetadata?.episodeNumber ?? expectedEpisodeNumber,
    releaseGroup: effectiveMetadata?.releaseGroup ?? parsed.releaseGroup,
    resolution: effectiveMetadata?.resolution ?? parsed.resolution,
    subtitleLanguage: effectiveMetadata?.subtitleLanguage ?? parsed.subtitleLanguage
  };
  const claimedRevision = resolveClaimedRevision({
    jobMetadataRevision: effectiveMetadata?.releaseRevision,
    parsedRevision: parsed.releaseRevision
  });
  const highestKnown = getHighestReleaseRevisionForVariant(
    subscription.id,
    variantFacets
  );
  const importDecision = canImportReleaseRevision({
    claimedRevision,
    highestKnownRevision: highestKnown
  });
  if (!importDecision.allow) {
    updateJobStatus(job.id, "failed", {
      targetPath: file.path,
      errorMessage: contextualError(
        "Downloaded file validation failed",
        importDecision.reason,
        { sourcePath: file.path, targetPath: finalPath }
      )
    });
    console.log(
      `[pipeline] skip import ${file.name}: ${importDecision.reason}`
    );
    return;
  }

  // Preferred feed item may have moved on while this file was still downloading.
  if (effectiveMetadata) {
    const preferredFeedItemId = getPreferredFeedItemIdForRelease(
      subscription.id,
      effectiveMetadata
    );
    if (preferredFeedItemId != null && preferredFeedItemId !== job.feedItemId) {
      updateJobStatus(job.id, "failed", {
        targetPath: file.path,
        errorMessage: contextualError(
          "Downloaded file was superseded",
          "A newer release revision became preferred; clean the OpenList task and job directory manually, and do not retry this older revision",
          { sourcePath: file.path, taskId: job.openlistTaskId }
        )
      });
      return;
    }
  }

  const libraryExists = libraryFileExistsAtPath(subscription.id, finalPath);
  const existingRevision = libraryExists
    ? getLibraryFileRevisionAtPath(subscription.id, finalPath)
    : null;
  const overwriteDecision = canOverwriteLibraryFile({
    claimedRevision,
    existingRevision,
    replaceExistingOnRevision: settings.replaceExistingOnRevision,
    libraryFileExists: libraryExists
  });
  if (!overwriteDecision.allow) {
    updateJobStatus(job.id, "failed", {
      targetPath: file.path,
      errorMessage: contextualError(
        "Organize downloaded file failed",
        overwriteDecision.reason,
        { sourcePath: file.path, targetPath: finalPath }
      )
    });
    console.log(
      `[pipeline] skip overwrite ${file.name}: ${overwriteDecision.reason}`
    );
    return;
  }

  // Overwrite only when policy allows: higher/equal revision covering an older library file,
  // or same-path replace for unknown revision (different group / re-download).
  const shouldReplaceExisting =
    libraryExists && settings.replaceExistingOnRevision && overwriteDecision.allow;

  try {
    updateJobStatus(job.id, "ready_to_rename", {
      targetPath: file.path,
      errorMessage: null
    });
    upsertEpisodeFile({
      subscriptionId: subscription.id,
      feedItemId,
      episodeNumber: expectedEpisodeNumber,
      originalPath: file.path,
      finalPath,
      sizeBytes: file.size,
      status: "detected",
      errorMessage: null
    });

    await ensureOpenListDirectory(finalDir);

    if (currentName !== finalName) {
      await renameOpenListFile({
        path: currentPath,
        name: finalName,
        overwrite: shouldReplaceExisting
      });
      currentName = finalName;
      currentPath = joinRemotePath(sourceDir, finalName);
    }

    if (sourceDir !== finalDir) {
      await moveOpenListFiles({
        srcDir: sourceDir,
        dstDir: finalDir,
        names: [currentName],
        overwrite: shouldReplaceExisting
      });
    }

    await cleanupEmptyDirectory(sourceDir, cleanupRoot);

    upsertEpisodeFile({
      subscriptionId: subscription.id,
      feedItemId,
      episodeNumber: expectedEpisodeNumber,
      originalPath: file.path,
      finalPath,
      sizeBytes: file.size,
      status: "renamed"
    });
    updateJobStatus(job.id, "completed", {
      targetPath: finalPath,
      errorMessage: null
    });
  } catch (error) {
    const message = contextualError("Organize downloaded file failed", error, {
      sourcePath: file.path,
      targetPath: finalPath
    });
    updateJobStatus(job.id, "failed", {
      targetPath: file.path,
      errorMessage: message
    });
    upsertEpisodeFile({
      subscriptionId: subscription.id,
      feedItemId,
      episodeNumber: expectedEpisodeNumber,
      originalPath: file.path,
      finalPath,
      sizeBytes: file.size,
      status: "failed",
      errorMessage: message
    });
  }
}

async function cleanupEmptyDirectory(path: string, root: string) {
  const normalizedPath = joinRemotePath(path);
  const normalizedRoot = joinRemotePath(root);
  if (
    normalizedPath === normalizedRoot ||
    !isRemotePathWithin(normalizedPath, normalizedRoot)
  ) {
    return;
  }

  try {
    const entries = await listOpenListFiles(normalizedPath, { refresh: true });
    if (entries.length > 0) return;
    await removeOpenListFiles({
      dir: getRemoteDirName(normalizedPath),
      names: [getRemoteBaseName(normalizedPath)]
    });
  } catch (error) {
    if (isOpenListNotFoundError(error)) return;
    // Cleanup is best-effort; a leftover empty folder should not fail a completed move.
  }
}

async function listIncomingMediaFiles(
  root: string,
  visited = new Set<string>()
): Promise<OpenListFileEntry[]> {
  const normalizedRoot = joinRemotePath(root);
  if (visited.has(normalizedRoot)) return [];
  visited.add(normalizedRoot);

  const entries = await listOpenListFiles(normalizedRoot, {
    refresh: visited.size === 1
  });
  const files: OpenListFileEntry[] = [];
  for (const entry of entries) {
    if (entry.isDirectory) {
      files.push(...(await listIncomingMediaFiles(entry.path, visited)));
    } else if (isMediaFile(entry.path)) {
      files.push(entry);
    }
  }
  return files;
}

async function listLibraryMediaFiles(
  root: string,
  visited = new Set<string>()
): Promise<OpenListFileEntry[]> {
  const normalizedRoot = joinRemotePath(root);
  if (visited.has(normalizedRoot)) return [];
  visited.add(normalizedRoot);

  const entries = await listOpenListFiles(normalizedRoot, {
    refresh: visited.size === 1
  });
  const files: OpenListFileEntry[] = [];
  for (const entry of entries) {
    if (entry.isDirectory) {
      files.push(...(await listLibraryMediaFiles(entry.path, visited)));
    } else if (isMediaFile(entry.path)) {
      files.push(entry);
    }
  }
  return files;
}

function assertIncomingMutationLease(owner: string) {
  if (!refreshWorkerLease(INCOMING_MUTATION_LEASE, owner)) {
    throw new Error("Incoming mutation lease was lost");
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function contextualError(
  action: string,
  error: unknown,
  details: Record<string, string | number | null | undefined> = {}
) {
  const context = Object.entries(details)
    .filter(([, value]) => value != null && String(value).trim() !== "")
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(", ");
  return `${action}: ${errorMessage(error)}${context ? ` (${context})` : ""}`;
}

function getJobForItem(feedItemId: number) {
  return getJobForFeedItem(feedItemId);
}

function supersedeSiblingRevisionJobs(
  subscriptionId: number,
  preferredFeedItemId: number,
  metadata: Pick<
    ReleaseMetadata,
    "episodeNumber" | "releaseGroup" | "resolution" | "subtitleLanguage"
  >
) {
  for (const feedItemId of listVariantFeedItemIds(subscriptionId, metadata)) {
    if (feedItemId === preferredFeedItemId) continue;
    markSupersededJob(feedItemId);
  }
}

function markSupersededJob(feedItemId: number) {
  const job = getJobForItem(feedItemId);
  if (!job) return;

  if (["discovered", "queued", "needs_review"].includes(job.status)) {
    updateJobStatus(job.id, "skipped", {
      errorMessage: "Superseded by a newer release revision"
    });
    return;
  }

  if (["downloading", "waiting_file", "ready_to_rename"].includes(job.status)) {
    updateJobStatus(job.id, "failed", {
      errorMessage: contextualError(
        "Download superseded while remote work may still be active",
        "A newer release revision became preferred; clean the OpenList task and job directory manually, and do not retry this older revision",
        { taskId: job.openlistTaskId, targetPath: job.targetPath }
      )
    });
  }
}

export function incomingPathForJob(jobId: number) {
  if (!Number.isInteger(jobId) || jobId <= 0) {
    throw new Error(`Invalid job id: ${jobId}`);
  }
  return joinRemotePath(
    getSystemSettings().openlistIncomingPath,
    "jobs",
    String(jobId)
  );
}

/** Prefer per-subscription library root when set; otherwise global mediaLibraryRoot. */
export function libraryRootForSubscription(subscription: Subscription) {
  const settings = getSystemSettings();
  const root = subscription.destinationRoot?.trim() || settings.mediaLibraryRoot;
  return joinRemotePath(root);
}
