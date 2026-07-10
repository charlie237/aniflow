import { randomUUID } from "node:crypto";
import type {
  DownloadJob,
  FilterRule,
  ReleaseMetadata,
  Subscription
} from "@/lib/db/types";
import {
  acquireWorkerLease,
  claimQueuedJob,
  createOrUpdateJob,
  failStaleDownloadingJobs,
  findMetadataBySubscription,
  getEpisodeFileForFeedItem,
  getFeedItem,
  getJob,
  getJobForFeedItem,
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
  refreshWorkerLease,
  releaseWorkerLease,
  requeueFailedDownloadJobs,
  touchDownloadingJobActivity,
  touchSubscriptionPolled,
  updateJobStatus,
  upsertEpisodeFile,
  upsertFeedItem
} from "@/lib/db/repositories";
import { fetchText } from "@/lib/net/fetch";
import {
  add115OfflineDownload,
  ensureOpenListDirectory,
  isAlreadyInOfflineListErrorMessage,
  isOfflineTaskFailed,
  isOpenListNotFoundError,
  listOfflineDownloadDone,
  listOfflineDownloadTransferUndone,
  listOfflineDownloadUndone,
  listOpenListFiles,
  moveOpenListFiles,
  renameOpenListFile,
  removeOpenListFiles,
  type OpenListFileEntry,
  type OpenListTask
} from "@/lib/openlist/client";
import { evaluateRules } from "@/lib/rules/engine";
import { parseRss } from "@/lib/rss/parser";
import { parseReleaseTitle } from "@/lib/rss/title-parser";
import { resolveOfflineDownloadUrl } from "@/lib/torrent/magnet";
import {
  buildEpisodePath,
  getExtension,
  getRemoteBaseName,
  getRemoteDirName,
  isMediaFile,
  isRemotePathWithin,
  joinRemotePath,
  resolveSubscriptionIncomingPath
} from "@/lib/utils/path";
import {
  MIN_TRACKED_JOB_MATCH_SCORE,
  pickBestIncomingSubscriptionMatch,
  scoreIncomingSubscriptionMatch,
  scoreTrackedJobIdentity
} from "@/lib/worker/match";
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

export interface DeletedSubscriptionIncomingCleanup {
  subscriptionName: string;
  incomingPath: string;
  rules: Array<Pick<FilterRule, "type" | "value" | "enabled">>;
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

  for (const subscription of listEnabledSubscriptions()) {
    try {
      const result = await pollSubscriptionFeed(subscription.id);
      totals.fetched += result.fetched;
      totals.discovered += result.discovered;
      totals.queued += result.queued;
      totals.skipped += result.skipped;
      totals.failed += result.failed;
    } catch (error) {
      totals.failed += 1;
      console.error(
        `[pipeline] poll failed for subscription#${subscription.id}: ${errorMessage(error)}`
      );
    }
  }

  await runDownloadMaintenance();
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
    if (existingJob) {
      // autoDownload was off when discovered; promote once enabled.
      if (
        existingJob.status === "discovered" &&
        subscription.autoDownload &&
        preferredFeedItemId === feedItem.id &&
        existingJob.sourceUrl
      ) {
        updateJobStatus(existingJob.id, "queued", {
          errorMessage: null,
          targetPath: incomingPathForSubscription(subscription)
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
      sourceUrl: candidate.downloadUrl,
      targetPath: incomingPathForSubscription(subscription)
    });
    result.queued += 1;
  }

  touchSubscriptionPolled(subscription.id);
  return result;
}

/** Keep download lifecycle work independent from RSS polling success. */
export async function runDownloadMaintenance() {
  // Scan first so late files can complete failed/ready jobs before retries are queued.
  await scanAndRenameIncoming();
  await reconcileDownloadingJobs();
  await submitQueuedJobs();
}

export async function submitQueuedJobs() {
  requeueFailedDownloadJobs();
  const jobs = listJobsByStatus(["queued"]);
  for (const job of jobs) {
    await submitJob(job);
  }
}

/**
 * Reconcile jobs stuck in "downloading":
 * - mark failed when OpenList reports task error
 * - mark failed when job is older than settings.downloadTimeoutMinutes with no completion
 *
 * Successful completion still happens via scanAndRenameIncoming when the media file appears.
 */
export async function reconcileDownloadingJobs() {
  const settings = getSystemSettings();
  const staleSeconds = Math.max(1, settings.downloadTimeoutMinutes) * 60;
  const downloading = listJobsByStatus(["downloading"]);
  if (downloading.length === 0) {
    const failed = failStaleDownloadingJobs(staleSeconds);
    return { checked: 0, failed };
  }

  let failed = 0;
  const protectedFromTimeout = new Set<number>();

  if (settings.openlistBaseUrl && settings.openlistToken) {
    const [undoneResult, doneResult, transferringResult] = await Promise.all([
      listOfflineDownloadUndone(),
      listOfflineDownloadDone(),
      listOfflineDownloadTransferUndone()
    ]);
    const undone = undoneResult.tasks;
    const done = doneResult.tasks;
    const transferring = transferringResult.tasks;
    const byId = new Map<string, OpenListTask>();
    for (const task of [...undone, ...done, ...transferring]) {
      if (task.id) byId.set(String(task.id), task);
    }

    const activeIds = new Set([
      ...undone.map((task) => String(task.id)),
      ...transferring.map((task) => String(task.id))
    ]);
    const activeTaskListsAvailable =
      undoneResult.available && transferringResult.available;
    if (!activeTaskListsAvailable) {
      const unavailable = [
        { name: "offline_download/undone", result: undoneResult },
        {
          name: "offline_download_transfer/undone",
          result: transferringResult
        }
      ]
        .filter(({ result }) => !result.available)
        .map(({ name, result }) => `${name}: ${result.error ?? "unavailable"}`)
        .join("; ");
      console.warn(
        `[pipeline] OpenList active task state unavailable; preserving jobs: ${unavailable}`
      );
    }

    for (const job of downloading) {
      if (!job.openlistTaskId) continue;
      const taskId = String(job.openlistTaskId);
      const task = byId.get(taskId);
      if (task && isOfflineTaskFailed(task)) {
        updateJobStatus(job.id, "failed", {
          clearOpenlistTaskId: true,
          errorMessage: task.error?.trim() || `OpenList offline task failed (${task.status || task.state})`
        });
        failed += 1;
        continue;
      }
      if (activeIds.has(taskId)) {
        // Keep the timeout clock tied to the last confirmed OpenList activity.
        touchDownloadingJobActivity(job.id);
        continue;
      }
      if (!activeTaskListsAvailable) {
        // A network/endpoint error is not evidence that the remote task vanished.
        protectedFromTimeout.add(job.id);
        continue;
      }
      // Task not in active lists: either succeeded and was purged (115), or vanished.
      // Do not mark completed here; wait for file scan or stale timeout.
    }
  }

  failed += failStaleDownloadingJobs(
    staleSeconds,
    undefined,
    [...protectedFromTimeout]
  );
  return { checked: downloading.length, failed };
}

/** Re-submit offline download (clears OpenList task id). */
export async function retryJob(jobId: number) {
  const job = getJob(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);
  console.log(`[pipeline] redownload job#${job.id}`);
  updateJobStatus(job.id, "queued", {
    errorMessage: null,
    clearOpenlistTaskId: true
  });
  await submitJob({ ...job, status: "queued", openlistTaskId: null });
}

/**
 * Only re-scan / re-organize incoming files — do not submit a new offline download.
 * Use when the file may already be in _incoming but rename/move failed.
 */
export async function reorganizeJob(jobId: number) {
  const job = getJob(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);
  console.log(`[pipeline] reorganize job#${job.id}`);
  updateJobStatus(job.id, "ready_to_rename", {
    errorMessage: null
  });
  await scanAndRenameIncoming();
}

export async function confirmJob(jobId: number) {
  const job = getJob(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);
  console.log(`[pipeline] confirm job#${job.id}`);
  updateJobStatus(job.id, "queued", {
    errorMessage: null,
    clearOpenlistTaskId: true
  });
  await submitJob({ ...job, status: "queued", openlistTaskId: null });
}

export async function submitJob(job: DownloadJob) {
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

  const targetPath = incomingPathForSubscription(subscription);

  // Atomic claim prevents web + worker double-submit of the same queued job.
  let claimedAttempt = false;
  if (job.status === "queued") {
    if (!claimQueuedJob(job.id)) {
      console.log(`[pipeline] job#${job.id} already claimed by another worker`);
      return;
    }
    claimedAttempt = true;
  }

  try {
    const offlineUrl = await resolveOfflineDownloadUrl(job.sourceUrl);
    await ensureOpenListDirectory(targetPath);
    const tasks = await add115OfflineDownload({
      urls: [offlineUrl],
      path: targetPath
    });
    const taskId = tasks[0]?.id ? String(tasks[0].id) : null;
    markJobAttempt(job.id, {
      status: "downloading",
      openlistTaskId: taskId,
      targetPath,
      errorMessage: taskId
        ? null
        : "OpenList returned no offline task id; waiting for file or timeout"
    }, { incrementAttempt: !claimedAttempt });
    console.log(
      `[pipeline] job#${job.id} submitted offline task=${taskId ?? "n/a"}`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // 115/OpenList often reject duplicate offline URLs — treat as "already downloading".
    if (isAlreadyInOfflineListError(message)) {
      markJobAttempt(job.id, {
        status: "downloading",
        targetPath,
        errorMessage:
          "URL already in OpenList offline list; waiting for file in download directory"
      }, { incrementAttempt: !claimedAttempt });
      console.log(
        `[pipeline] job#${job.id} already in offline list — waiting for file`
      );
      return;
    }
    markJobAttempt(job.id, {
      status: "failed",
      targetPath,
      errorMessage: message
    }, { incrementAttempt: !claimedAttempt });
    console.error(`[pipeline] job#${job.id} submit failed: ${message}`);
  }
}

function isAlreadyInOfflineListError(message: string) {
  return isAlreadyInOfflineListErrorMessage(message);
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
    const subscriptions = listSubscriptions();
    await recoverMovedReadyJobs(subscriptions, leaseOwner);
    const subscriptionPaths = subscriptions.flatMap((subscription) => {
      try {
        return [incomingPathForSubscription(subscription)];
      } catch (error) {
        console.error(
          `[pipeline] unsafe incoming path for subscription#${subscription.id}: ${errorMessage(error)}`
        );
        return [];
      }
    });
    const incomingPaths = uniquePaths([
      settings.openlistIncomingPath,
      ...subscriptionPaths
    ]);
    const seen = new Set<string>();

    for (const incomingPath of incomingPaths) {
      assertIncomingMutationLease(leaseOwner);
      await ensureOpenListDirectory(incomingPath);
      const files = await listIncomingMediaFiles(incomingPath);
      for (const file of files) {
        if (seen.has(file.path)) continue;
        seen.add(file.path);
        await renameIncomingFile(file, subscriptions);
        assertIncomingMutationLease(leaseOwner);
      }
      await cleanupEmptyIncomingDirectories(incomingPath);
    }
  } finally {
    releaseWorkerLease(INCOMING_MUTATION_LEASE, leaseOwner);
  }
}

export async function cleanupDeletedSubscriptionIncoming(
  payload: DeletedSubscriptionIncomingCleanup
) {
  const settings = getSystemSettings();
  if (!settings.openlistBaseUrl || !settings.openlistToken) return { removed: 0 };

  const incomingPath = joinRemotePath(payload.incomingPath);
  if (!isRemotePathWithin(incomingPath, settings.openlistIncomingPath)) {
    throw new Error(
      `Refusing to clean outside the global incoming root: ${incomingPath}`
    );
  }

  const leaseOwner = randomUUID();
  if (
    !acquireWorkerLease(
      INCOMING_MUTATION_LEASE,
      leaseOwner,
      INCOMING_MUTATION_LEASE_SECONDS
    )
  ) {
    throw new Error("Incoming file operations are busy; cleanup will retry");
  }

  try {
    const files = await listIncomingMediaFiles(incomingPath);
    const rules = payload.rules.map((rule, index): FilterRule => ({
      id: index + 1,
      subscriptionId: 0,
      type: rule.type,
      value: rule.value,
      enabled: rule.enabled,
      createdAt: ""
    }));
    let removed = 0;

    for (const file of files) {
      assertIncomingMutationLease(leaseOwner);
      const parsed = parseReleaseTitle(file.name);
      if (!matchesDeletedSubscription(payload.subscriptionName, file.name, parsed)) {
        continue;
      }
      if (rules.length > 0 && !evaluateRules(file.name, parsed, rules).allowed) {
        continue;
      }

      await removeOpenListFiles({
        dir: getRemoteDirName(file.path),
        names: [getRemoteBaseName(file.path)]
      });
      removed += 1;
      await cleanupEmptyDirectory(getRemoteDirName(file.path), incomingPath);
    }

    await cleanupEmptyIncomingDirectories(incomingPath);
    return { removed };
  } finally {
    releaseWorkerLease(INCOMING_MUTATION_LEASE, leaseOwner);
  }
}

/**
 * A remote rename/move cannot share a transaction with SQLite. When a worker
 * stops after the move but before the database update, finish that intent once
 * the original file is gone and its recorded destination exists.
 */
async function recoverMovedReadyJobs(
  subscriptions: Subscription[],
  leaseOwner: string
) {
  const subscriptionById = new Map(
    subscriptions.map((subscription) => [subscription.id, subscription])
  );

  for (const job of listJobsByStatus(["ready_to_rename"])) {
    assertIncomingMutationLease(leaseOwner);
    const subscription = subscriptionById.get(job.subscriptionId);
    const pendingFile = getEpisodeFileForFeedItem(job.feedItemId);
    if (
      !subscription ||
      !pendingFile ||
      pendingFile.status !== "detected" ||
      !pendingFile.finalPath
    ) {
      continue;
    }

    try {
      const source = await findOpenListFile(pendingFile.originalPath);
      if (source) continue;

      const destination = await findOpenListFile(pendingFile.finalPath);
      if (!destination) continue;

      upsertEpisodeFile({
        subscriptionId: subscription.id,
        feedItemId: job.feedItemId,
        episodeNumber: pendingFile.episodeNumber,
        originalPath: pendingFile.originalPath,
        finalPath: pendingFile.finalPath,
        sizeBytes: destination.size,
        status: "renamed",
        errorMessage: null
      });
      updateJobStatus(job.id, "completed", {
        targetPath: pendingFile.finalPath,
        errorMessage: null
      });
      await cleanupEmptyDirectory(
        getRemoteDirName(pendingFile.originalPath),
        incomingPathForSubscription(subscription)
      );
      console.log(`[pipeline] recovered completed move for job#${job.id}`);
    } catch (error) {
      console.error(
        `[pipeline] unable to recover ready job#${job.id}: ${errorMessage(error)}`
      );
    }
  }
}

async function findOpenListFile(path: string) {
  try {
    const entries = await listOpenListFiles(getRemoteDirName(path), {
      refresh: true
    });
    const name = getRemoteBaseName(path);
    return entries.find((entry) => !entry.isDirectory && entry.name === name) ?? null;
  } catch (error) {
    if (isOpenListNotFoundError(error)) return null;
    throw error;
  }
}

async function renameIncomingFile(
  file: OpenListFileEntry,
  subscriptions: Subscription[]
) {
  const parsed = parseReleaseTitle(file.name);
  if (parsed.episodeNumber == null) return;

  const match = findIncomingMatch(subscriptions, file.path, file.name, parsed);
  if (!match) return;

  const extension = getExtension(file.name);
  if (!extension) return;

  const { subscription } = match;
  const settings = getSystemSettings();
  const finalPath = buildEpisodePath({
    destinationRoot: libraryRootForSubscription(subscription),
    subscriptionName: subscription.name,
    seasonNumber: subscription.seasonNumber,
    episodeNumber: parsed.episodeNumber,
    extension,
    seasonPathTemplate: settings.seasonPathTemplate,
    episodeFileTemplate: settings.episodeFileTemplate
  });
  const finalDir = getRemoteDirName(finalPath);
  const finalName = getRemoteBaseName(finalPath);
  const sourceDir = getRemoteDirName(file.path);
  let currentName = getRemoteBaseName(file.path);
  let currentPath = file.path;
  const jobMetadata = match.job
    ? getMetadataForFeedItem(match.job.feedItemId)
    : null;
  const fallbackJob = match.job
    ? null
    : findCompletableJob(subscription, parsed.episodeNumber, parsed.releaseRevision);
  const job = match.job ?? fallbackJob?.job ?? null;
  const effectiveMetadata =
    jobMetadata ?? (job ? getMetadataForFeedItem(job.feedItemId) : null);
  const feedItemId = job?.feedItemId ?? null;
  const cleanupRoot = incomingPathForSubscription(subscription);

  const variantFacets = {
    episodeNumber: effectiveMetadata?.episodeNumber ?? parsed.episodeNumber,
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
    if (job) {
      updateJobStatus(job.id, "skipped", {
        targetPath: file.path,
        errorMessage: importDecision.reason
      });
    }
    console.log(
      `[pipeline] skip import ${file.name}: ${importDecision.reason}`
    );
    return;
  }

  // Preferred feed item may have moved on while this file was still downloading.
  if (job && effectiveMetadata) {
    const preferredFeedItemId = getPreferredFeedItemIdForRelease(
      subscription.id,
      effectiveMetadata
    );
    if (preferredFeedItemId != null && preferredFeedItemId !== job.feedItemId) {
      updateJobStatus(job.id, "skipped", {
        targetPath: file.path,
        errorMessage: "Superseded by a newer release revision"
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
    if (job) {
      updateJobStatus(job.id, "skipped", {
        targetPath: file.path,
        errorMessage: overwriteDecision.reason
      });
    }
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
    if (job) {
      updateJobStatus(job.id, "ready_to_rename", {
        targetPath: file.path,
        errorMessage: null
      });
      // Persist the intended destination before mutating OpenList. This makes a
      // completed remote move recoverable after a worker restart.
      upsertEpisodeFile({
        subscriptionId: subscription.id,
        feedItemId,
        episodeNumber: parsed.episodeNumber,
        originalPath: file.path,
        finalPath,
        sizeBytes: file.size,
        status: "detected",
        errorMessage: null
      });
    }

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
      episodeNumber: parsed.episodeNumber,
      originalPath: file.path,
      finalPath,
      sizeBytes: file.size,
      status: "renamed"
    });
    if (job) {
      updateJobStatus(job.id, "completed", {
        targetPath: finalPath,
        errorMessage: null
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Previously not-found returned silently and left jobs stuck in ready_to_rename.
    if (job) {
      updateJobStatus(job.id, "failed", {
        targetPath: file.path,
        errorMessage: isOpenListNotFoundError(error)
          ? `Source file not found during rename: ${message}`
          : message
      });
    }
    if (isOpenListNotFoundError(error)) return;
    upsertEpisodeFile({
      subscriptionId: subscription.id,
      feedItemId,
      episodeNumber: parsed.episodeNumber,
      originalPath: file.path,
      finalPath,
      sizeBytes: file.size,
      status: "failed",
      errorMessage: message
    });
  }
}

function matchesDeletedSubscription(
  subscriptionName: string,
  filename: string,
  parsed: ReturnType<typeof parseReleaseTitle>
) {
  const normalizedName = subscriptionName.trim().toLowerCase();
  if (!normalizedName) return false;

  const normalizedFilename = filename.toLowerCase();
  const parsedTitle = parsed.parsedTitle?.toLowerCase();
  return (
    normalizedFilename.includes(normalizedName) ||
    Boolean(parsedTitle && normalizedName.includes(parsedTitle)) ||
    Boolean(parsedTitle && parsedTitle.includes(normalizedName))
  );
}

async function cleanupEmptyIncomingDirectories(root: string) {
  const hasActiveJob = listJobsByStatus(["queued", "downloading", "ready_to_rename"])
    .some((job) => job.targetPath && isRemotePathWithin(job.targetPath, root));
  if (hasActiveJob) return;

  await cleanupEmptyChildDirectories(root, root);
}

async function cleanupEmptyChildDirectories(path: string, root: string) {
  let entries: OpenListFileEntry[];
  try {
    entries = await listOpenListFiles(path, { refresh: true });
  } catch (error) {
    if (isOpenListNotFoundError(error)) return;
    throw error;
  }

  for (const entry of entries) {
    if (entry.isDirectory) {
      await cleanupEmptyChildDirectories(entry.path, root);
    }
  }

  await cleanupEmptyDirectory(path, root);
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

function findIncomingMatch(
  subscriptions: Subscription[],
  filePath: string,
  filename: string,
  parsed: ReturnType<typeof parseReleaseTitle>
) {
  const tracked = findTrackedJobMatch(subscriptions, filePath, parsed);
  if (tracked) return tracked;

  const subscription = findSubscriptionByFilenameRules(
    subscriptionsForIncomingFile(
      subscriptions.filter((item) => item.enabled),
      filePath
    ),
    filename,
    parsed
  );
  return subscription ? { subscription, job: null } : null;
}

function findTrackedJobMatch(
  subscriptions: Subscription[],
  filePath: string,
  parsed: ReturnType<typeof parseReleaseTitle>
) {
  if (parsed.episodeNumber == null) return null;

  const subscriptionById = new Map(
    subscriptions.map((subscription) => [subscription.id, subscription])
  );
  const filename = getRemoteBaseName(filePath);

  const candidates: Array<{
    subscription: Subscription;
    job: DownloadJob;
    metadata: ReleaseMetadata;
    score: number;
  }> = [];

  for (const job of listJobsByStatus(["downloading", "ready_to_rename", "failed"])) {
    const subscription = subscriptionById.get(job.subscriptionId);
    if (!subscription) continue;
    const pendingFile = getEpisodeFileForFeedItem(job.feedItemId);
    const expectedRenamedSource =
      pendingFile?.status === "detected" && pendingFile.finalPath
        ? joinRemotePath(
            getRemoteDirName(pendingFile.originalPath),
            getRemoteBaseName(pendingFile.finalPath)
          )
        : null;
    const isExpectedRenamedSource = expectedRenamedSource === filePath;
    let jobRoot: string;
    try {
      jobRoot = job.targetPath ?? incomingPathForSubscription(subscription);
    } catch {
      continue;
    }
    if (!isExpectedRenamedSource && !isRemotePathWithin(filePath, jobRoot)) {
      continue;
    }

    const feedItem = getFeedItem(job.feedItemId);
    const metadata = getMetadataForFeedItem(job.feedItemId);
    if (!feedItem || !metadata) continue;
    if (metadata.episodeNumber !== parsed.episodeNumber) continue;
    // Do not require exact releaseRevision: torrent/file names often omit "v2"
    // while the RSS title carried it.

    const decision = evaluateRules(feedItem.title, metadata, listRules(subscription.id));
    if (!decision.allowed) continue;

    const score =
      scoreTrackedJobIdentity({
        subscriptionName: subscription.name,
        feedTitle: feedItem.title,
        metadata,
        filename,
        parsed
      }) + (isExpectedRenamedSource ? MIN_TRACKED_JOB_MATCH_SCORE : 0);
    if (score < MIN_TRACKED_JOB_MATCH_SCORE) continue;

    candidates.push({ subscription, job, metadata, score });
  }

  if (candidates.length === 0) return null;

  candidates.sort((left, right) => {
    if (left.score !== right.score) return right.score - left.score;
    const leftExact = left.metadata.releaseRevision === parsed.releaseRevision ? 1 : 0;
    const rightExact = right.metadata.releaseRevision === parsed.releaseRevision ? 1 : 0;
    if (leftExact !== rightExact) return rightExact - leftExact;
    return (
      right.metadata.releaseRevision - left.metadata.releaseRevision ||
      right.job.id - left.job.id
    );
  });

  // Ambiguous: two strong matches for different subscriptions — refuse rather than mis-file.
  if (
    candidates.length > 1 &&
    candidates[0].score === candidates[1].score &&
    candidates[0].subscription.id !== candidates[1].subscription.id
  ) {
    console.log(
      `[pipeline] ambiguous tracked job match for ${filename} (score=${candidates[0].score})`
    );
    return null;
  }

  const best = candidates[0];
  return { subscription: best.subscription, job: best.job };
}

function findSubscriptionByFilenameRules(
  subscriptions: Subscription[],
  filename: string,
  parsed: ReturnType<typeof parseReleaseTitle>
) {
  const candidates = subscriptions.map((subscription) =>
    scoreIncomingSubscriptionMatch({
      subscription,
      filename,
      parsed,
      rules: listRules(subscription.id),
      knownMetadata: findMetadataBySubscription(subscription.id)
    })
  );
  return pickBestIncomingSubscriptionMatch(candidates);
}

function subscriptionsForIncomingFile(
  subscriptions: Subscription[],
  filePath: string
) {
  const matches = subscriptions.flatMap((subscription) => {
    try {
      const incomingPath = incomingPathForSubscription(subscription);
      return isRemotePathWithin(filePath, incomingPath)
        ? [{ subscription, incomingPath }]
        : [];
    } catch {
      return [];
    }
  });
  if (matches.length === 0) return subscriptions;

  const deepestPathLength = Math.max(
    ...matches.map(
      ({ incomingPath }) => incomingPath.split("/").filter(Boolean).length
    )
  );
  return matches
    .filter(
      ({ incomingPath }) =>
        incomingPath.split("/").filter(Boolean).length === deepestPathLength
    )
    .map(({ subscription }) => subscription);
}

function assertIncomingMutationLease(owner: string) {
  if (!refreshWorkerLease(INCOMING_MUTATION_LEASE, owner)) {
    throw new Error("Incoming mutation lease was lost");
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function findCompletableJob(
  subscription: Subscription,
  episodeNumber: number,
  releaseRevision: number
) {
  // Prefer exact revision, then highest revision with an in-flight job.
  // Filename often lacks "v2" even when the RSS metadata had it.
  const inFlight = new Set(["discovered", "queued", "downloading", "ready_to_rename"]);
  const metadata = findMetadataBySubscription(subscription.id)
    .filter((item) => item.episodeNumber === episodeNumber)
    .map((item) => {
      const job = getJobForItem(item.feedItemId);
      return { item, job };
    })
    .filter((entry) => entry.job && inFlight.has(entry.job.status))
    .sort((left, right) => {
      const leftExact = left.item.releaseRevision === releaseRevision ? 1 : 0;
      const rightExact = right.item.releaseRevision === releaseRevision ? 1 : 0;
      if (leftExact !== rightExact) return rightExact - leftExact;
      return (
        right.item.releaseRevision - left.item.releaseRevision ||
        right.item.feedItemId - left.item.feedItemId
      );
    })[0];
  return metadata?.job
    ? { job: metadata.job, feedItemId: metadata.item.feedItemId }
    : null;
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
  // Also drop in-flight downloads for older revisions so a later v2 rename
  // is not raced by the superseded job completing.
  if (
    !job ||
    !["discovered", "queued", "needs_review", "downloading", "ready_to_rename"].includes(
      job.status
    )
  ) {
    return;
  }
  updateJobStatus(job.id, "skipped", {
    errorMessage: "Superseded by a newer release revision"
  });
}

function uniquePaths(paths: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      paths
        .filter((path): path is string => Boolean(path?.trim()))
        .map((path) => joinRemotePath(path))
    )
  );
}

export function incomingPathForSubscription(subscription: Subscription) {
  const settings = getSystemSettings();
  return resolveSubscriptionIncomingPath({
    incomingRoot: settings.openlistIncomingPath,
    subscriptionName: subscription.name,
    incomingPath: subscription.incomingPath
  });
}

/** Prefer per-subscription library root when set; otherwise global mediaLibraryRoot. */
export function libraryRootForSubscription(subscription: Subscription) {
  const settings = getSystemSettings();
  const root = subscription.destinationRoot?.trim() || settings.mediaLibraryRoot;
  return joinRemotePath(root);
}
