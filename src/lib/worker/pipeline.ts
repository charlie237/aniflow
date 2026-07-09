import type {
  DownloadJob,
  FilterRule,
  ReleaseMetadata,
  Subscription
} from "@/lib/db/types";
import {
  createOrUpdateJob,
  failStaleDownloadingJobs,
  findMetadataBySubscription,
  getFeedItem,
  getJob,
  getJobForFeedItem,
  getMetadataForFeedItem,
  getPreferredFeedItemIdForRelease,
  getSystemSettings,
  getSubscription,
  listEnabledSubscriptions,
  listJobsByStatus,
  listRules,
  markJobAttempt,
  requeueFailedDownloadJobs,
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
  joinRemotePath
} from "@/lib/utils/path";
import {
  pickBestIncomingSubscriptionMatch,
  scoreIncomingSubscriptionMatch
} from "@/lib/worker/match";

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

export async function pollAllSubscriptions() {
  const totals: PipelineResult = {
    fetched: 0,
    discovered: 0,
    queued: 0,
    skipped: 0,
    failed: 0
  };

  for (const subscription of listEnabledSubscriptions()) {
    const result = await pollSubscription(subscription.id);
    totals.fetched += result.fetched;
    totals.discovered += result.discovered;
    totals.queued += result.queued;
    totals.skipped += result.skipped;
    totals.failed += result.failed;
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
  const subscription = getSubscription(subscriptionId);
  if (!subscription) throw new Error(`Subscription ${subscriptionId} not found`);

  const result: PipelineResult = {
    fetched: 0,
    discovered: 0,
    queued: 0,
    skipped: 0,
    failed: 0
  };

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

  for (const item of items) {
    // Gate on rules before any DB write — only matching releases are stored.
    const decision = evaluateRules(item.title, item.metadata, rules);
    if (!decision.allowed) {
      result.skipped += 1;
      continue;
    }

    const feedItem = upsertFeedItem(subscription, item);
    result.discovered += 1;
    const metadata: ReleaseMetadata | Omit<ReleaseMetadata, "id" | "feedItemId"> =
      getMetadataForFeedItem(feedItem.id) ?? {
        ...item.metadata,
        releaseRevision: item.metadata.releaseRevision ?? 1
      };

    const preferredFeedItemId = getPreferredFeedItemIdForRelease(
      subscription.id,
      metadata as ReleaseMetadata
    );
    if (preferredFeedItemId != null && preferredFeedItemId !== feedItem.id) {
      markSupersededJob(feedItem.id);
      result.skipped += 1;
      continue;
    }

    const existingJob = getJobForItem(feedItem.id);
    if (existingJob) {
      result.skipped += 1;
      continue;
    }

    if (!item.downloadUrl) {
      createOrUpdateJob({
        subscriptionId: subscription.id,
        feedItemId: feedItem.id,
        status: "needs_review",
        errorMessage: "No torrent or magnet URL found in RSS item"
      });
      result.failed += 1;
      continue;
    }

    if (!metadata || metadata.needsReview || metadata.episodeNumber == null) {
      createOrUpdateJob({
        subscriptionId: subscription.id,
        feedItemId: feedItem.id,
        status: "needs_review",
        sourceUrl: item.downloadUrl,
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
        sourceUrl: item.downloadUrl
      });
      result.skipped += 1;
      continue;
    }

    createOrUpdateJob({
      subscriptionId: subscription.id,
      feedItemId: feedItem.id,
      status: "queued",
      sourceUrl: item.downloadUrl,
      targetPath: subscription.incomingPath ?? getSystemSettings().openlistIncomingPath
    });
    result.queued += 1;
  }

  touchSubscriptionPolled(subscription.id);
  await submitQueuedJobs();
  await reconcileDownloadingJobs();
  await scanAndRenameIncoming();
  return result;
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
    failStaleDownloadingJobs(staleSeconds);
    return { checked: 0, failed: 0 };
  }

  let failed = 0;

  if (settings.openlistBaseUrl && settings.openlistToken) {
    const [undone, done, transferring] = await Promise.all([
      listOfflineDownloadUndone(),
      listOfflineDownloadDone(),
      listOfflineDownloadTransferUndone()
    ]);
    const byId = new Map<string, OpenListTask>();
    for (const task of [...undone, ...done, ...transferring]) {
      if (task.id) byId.set(String(task.id), task);
    }

    const activeIds = new Set([
      ...undone.map((task) => String(task.id)),
      ...transferring.map((task) => String(task.id))
    ]);

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
        // Still running (download or transfer) — leave as downloading.
        continue;
      }
      // Task not in active lists: either succeeded and was purged (115), or vanished.
      // Do not mark completed here; wait for file scan or stale timeout.
    }
  }

  failed += failStaleDownloadingJobs(staleSeconds);
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

    const decision = evaluateRules(feedItem.title, metadata, listRules(subscription.id));
    if (!decision.allowed) {
      updateJobStatus(job.id, "skipped", {
        errorMessage: decision.reasons.join("; ")
      });
      return;
    }
  }

  const targetPath = subscription.incomingPath ?? getSystemSettings().openlistIncomingPath;
  try {
    const offlineUrl = await resolveOfflineDownloadUrl(job.sourceUrl);
    await ensureOpenListDirectory(targetPath);
    const tasks = await add115OfflineDownload({
      urls: [offlineUrl],
      path: targetPath
    });
    markJobAttempt(job.id, {
      status: "downloading",
      openlistTaskId: tasks[0]?.id ?? null,
      targetPath,
      errorMessage: null
    });
    console.log(
      `[pipeline] job#${job.id} submitted offline task=${tasks[0]?.id ?? "n/a"}`
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
      });
      console.log(
        `[pipeline] job#${job.id} already in offline list — waiting for file`
      );
      return;
    }
    markJobAttempt(job.id, {
      status: "failed",
      targetPath,
      errorMessage: message
    });
    console.error(`[pipeline] job#${job.id} submit failed: ${message}`);
  }
}

function isAlreadyInOfflineListError(message: string) {
  return /already|exist|duplicate|离线|已存在|in the offline|task url|重复/i.test(
    message
  );
}

export async function scanAndRenameIncoming() {
  const settings = getSystemSettings();
  if (!settings.openlistBaseUrl || !settings.openlistToken) {
    return;
  }

  const subscriptions = listEnabledSubscriptions();
  const incomingPaths = uniquePaths([
    settings.openlistIncomingPath,
    ...subscriptions.map((subscription) => subscription.incomingPath)
  ]);
  const seen = new Set<string>();

  for (const incomingPath of incomingPaths) {
    await ensureOpenListDirectory(incomingPath);
    const files = await listIncomingMediaFiles(incomingPath);
    for (const file of files) {
      if (seen.has(file.path)) continue;
      seen.add(file.path);
      await renameIncomingFile(file, subscriptions);
    }
    await cleanupEmptyIncomingDirectories(incomingPath);
  }
}

export async function cleanupDeletedSubscriptionIncoming(
  payload: DeletedSubscriptionIncomingCleanup
) {
  const settings = getSystemSettings();
  if (!settings.openlistBaseUrl || !settings.openlistToken) return { removed: 0 };

  const incomingPath = joinRemotePath(payload.incomingPath);
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
  const feedItemId = match.job?.feedItemId ?? null;
  const cleanupRoot = match.job?.targetPath ?? incomingPathForSubscription(subscription);
  // When enabled, replace any existing library file at the same final path
  // (same episode from a newer revision, different group, or re-download).
  const shouldReplaceExisting = settings.replaceExistingOnRevision;

  try {
    if (match.job) {
      updateJobStatus(match.job.id, "ready_to_rename", {
        targetPath: file.path,
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
    if (match.job) {
      updateJobStatus(match.job.id, "completed", {
        targetPath: finalPath,
        errorMessage: null
      });
    } else {
      markCompletedJob(
        subscription,
        parsed.episodeNumber,
        parsed.releaseRevision,
        finalPath
      );
    }
  } catch (error) {
    if (isOpenListNotFoundError(error)) return;
    if (match.job) {
      updateJobStatus(match.job.id, "failed", {
        targetPath: file.path,
        errorMessage: error instanceof Error ? error.message : String(error)
      });
    }
    upsertEpisodeFile({
      subscriptionId: subscription.id,
      feedItemId,
      episodeNumber: parsed.episodeNumber,
      originalPath: file.path,
      finalPath,
      sizeBytes: file.size,
      status: "failed",
      errorMessage: error instanceof Error ? error.message : String(error)
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
    .some((job) => job.targetPath && isPathWithin(job.targetPath, root));
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
  if (normalizedPath === normalizedRoot || !isPathWithin(normalizedPath, normalizedRoot)) {
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
  depth = 0
): Promise<OpenListFileEntry[]> {
  if (depth > 4) return [];
  const entries = await listOpenListFiles(root, { refresh: depth === 0 });
  const files: OpenListFileEntry[] = [];
  for (const entry of entries) {
    if (entry.isDirectory) {
      files.push(...(await listIncomingMediaFiles(entry.path, depth + 1)));
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

  const subscription = findSubscriptionByFilenameRules(subscriptions, filename, parsed);
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

  for (const job of listJobsByStatus(["downloading", "ready_to_rename"])) {
    const subscription = subscriptionById.get(job.subscriptionId);
    if (!subscription) continue;
    if (!isPathWithin(filePath, job.targetPath ?? incomingPathForSubscription(subscription))) {
      continue;
    }

    const feedItem = getFeedItem(job.feedItemId);
    const metadata = getMetadataForFeedItem(job.feedItemId);
    if (!feedItem || !metadata) continue;
    if (metadata.episodeNumber !== parsed.episodeNumber) continue;
    if (metadata.releaseRevision !== parsed.releaseRevision) continue;

    const decision = evaluateRules(feedItem.title, metadata, listRules(subscription.id));
    if (!decision.allowed) continue;

    return {
      subscription,
      job
    };
  }

  return null;
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

function isPathWithin(path: string, root: string) {
  const normalizedPath = joinRemotePath(path);
  const normalizedRoot = joinRemotePath(root);
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

function markCompletedJob(
  subscription: Subscription,
  episodeNumber: number,
  releaseRevision: number,
  finalPath: string
) {
  const metadata = findMetadataBySubscription(subscription.id)
    .filter(
      (item) =>
        item.episodeNumber === episodeNumber &&
        item.releaseRevision === releaseRevision
    )
    .sort(
      (left, right) =>
        right.releaseRevision - left.releaseRevision ||
        right.feedItemId - left.feedItemId
    )[0];
  if (!metadata) return;
  const feedItem = getFeedItem(metadata.feedItemId);
  if (!feedItem) return;
  const job = getJobForItem(feedItem.id);
  if (!job) return;
  updateJobStatus(job.id, "completed", {
    targetPath: finalPath,
    errorMessage: null
  });
}

function getJobForItem(feedItemId: number) {
  return getJobForFeedItem(feedItemId);
}

function markSupersededJob(feedItemId: number) {
  const job = getJobForItem(feedItemId);
  if (!job || !["discovered", "queued", "needs_review"].includes(job.status)) {
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
  return joinRemotePath(subscription.incomingPath ?? getSystemSettings().openlistIncomingPath);
}

/** Prefer per-subscription library root when set; otherwise global mediaLibraryRoot. */
export function libraryRootForSubscription(subscription: Subscription) {
  const settings = getSystemSettings();
  const root = subscription.destinationRoot?.trim() || settings.mediaLibraryRoot;
  return joinRemotePath(root);
}
