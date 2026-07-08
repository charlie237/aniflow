import type { DownloadJob, Subscription } from "@/lib/db/types";
import {
  createOrUpdateJob,
  findMetadataBySubscription,
  getFeedItem,
  getJob,
  getJobForFeedItem,
  getMetadataForFeedItem,
  getSystemSettings,
  getSubscription,
  listEnabledSubscriptions,
  listJobsByStatus,
  listRules,
  markJobAttempt,
  touchSubscriptionPolled,
  updateJobStatus,
  upsertEpisodeFile,
  upsertFeedItem
} from "@/lib/db/repositories";
import { fetchText } from "@/lib/net/fetch";
import {
  add115OfflineDownload,
  ensureOpenListDirectory,
  listOpenListFiles,
  moveOpenListFiles,
  renameOpenListFile,
  type OpenListFileEntry
} from "@/lib/openlist/client";
import { evaluateRules } from "@/lib/rules/engine";
import { parseRss } from "@/lib/rss/parser";
import { parseReleaseTitle } from "@/lib/rss/title-parser";
import {
  buildEpisodePath,
  getExtension,
  getRemoteBaseName,
  getRemoteDirName,
  isMediaFile,
  joinRemotePath
} from "@/lib/utils/path";

export interface PipelineResult {
  discovered: number;
  queued: number;
  skipped: number;
  failed: number;
}

export async function pollAllSubscriptions() {
  const totals: PipelineResult = {
    discovered: 0,
    queued: 0,
    skipped: 0,
    failed: 0
  };

  for (const subscription of listEnabledSubscriptions()) {
    const result = await pollSubscription(subscription.id);
    totals.discovered += result.discovered;
    totals.queued += result.queued;
    totals.skipped += result.skipped;
    totals.failed += result.failed;
  }

  return totals;
}

export async function pollSubscription(subscriptionId: number): Promise<PipelineResult> {
  const subscription = getSubscription(subscriptionId);
  if (!subscription) throw new Error(`Subscription ${subscriptionId} not found`);

  const result: PipelineResult = {
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

  const xml = response.body;
  const items = parseRss(xml);
  const rules = listRules(subscription.id);

  for (const item of items) {
    const feedItem = upsertFeedItem(subscription, item);
    const metadata = getMetadataForFeedItem(feedItem.id);
    const existingJob = getJobForItem(feedItem.id);
    result.discovered += 1;
    if (existingJob) continue;

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

    if (!metadata || metadata.needsReview) {
      createOrUpdateJob({
        subscriptionId: subscription.id,
        feedItemId: feedItem.id,
        status: "needs_review",
        sourceUrl: item.downloadUrl,
        errorMessage: "Episode number could not be parsed confidently"
      });
      result.skipped += 1;
      continue;
    }

    const decision = evaluateRules(item.title, metadata, rules);
    if (!decision.allowed) {
      createOrUpdateJob({
        subscriptionId: subscription.id,
        feedItemId: feedItem.id,
        status: "skipped",
        sourceUrl: item.downloadUrl,
        errorMessage: decision.reasons.join("; ")
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
  return result;
}

export async function submitQueuedJobs() {
  const jobs = listJobsByStatus(["queued"]);
  for (const job of jobs) {
    await submitJob(job);
  }
}

export async function retryJob(jobId: number) {
  const job = getJob(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);
  updateJobStatus(job.id, "queued", { errorMessage: null });
  await submitJob({ ...job, status: "queued" });
}

export async function confirmJob(jobId: number) {
  const job = getJob(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);
  updateJobStatus(job.id, "queued", { errorMessage: null });
  await submitJob({ ...job, status: "queued" });
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

  const targetPath = subscription.incomingPath ?? getSystemSettings().openlistIncomingPath;
  try {
    const tasks = await add115OfflineDownload({
      urls: [job.sourceUrl],
      path: targetPath
    });
    markJobAttempt(job.id, {
      status: "downloading",
      openlistTaskId: tasks[0]?.id ?? null,
      targetPath,
      errorMessage: null
    });
  } catch (error) {
    markJobAttempt(job.id, {
      status: "failed",
      targetPath,
      errorMessage: error instanceof Error ? error.message : String(error)
    });
  }
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
    const files = await listIncomingMediaFiles(incomingPath);
    for (const file of files) {
      if (seen.has(file.path)) continue;
      seen.add(file.path);
      await renameIncomingFile(file, subscriptions);
    }
  }
}

async function renameIncomingFile(
  file: OpenListFileEntry,
  subscriptions: Subscription[]
) {
  const parsed = parseReleaseTitle(file.name);
  if (parsed.episodeNumber == null) return;

  const subscription = findBestSubscription(subscriptions, file.name, parsed);
  if (!subscription) return;

  const extension = getExtension(file.name);
  if (!extension) return;

  const settings = getSystemSettings();
  const finalPath = buildEpisodePath({
    destinationRoot: settings.mediaLibraryRoot || subscription.destinationRoot,
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

  try {
    await ensureOpenListDirectory(finalDir);

    if (currentName !== finalName) {
      await renameOpenListFile({
        path: currentPath,
        name: finalName
      });
      currentName = finalName;
      currentPath = joinRemotePath(sourceDir, finalName);
    }

    if (sourceDir !== finalDir) {
      await moveOpenListFiles({
        srcDir: sourceDir,
        dstDir: finalDir,
        names: [currentName]
      });
    }

    upsertEpisodeFile({
      subscriptionId: subscription.id,
      episodeNumber: parsed.episodeNumber,
      originalPath: file.path,
      finalPath,
      sizeBytes: file.size,
      status: "renamed"
    });
    markCompletedJob(subscription, parsed.episodeNumber, finalPath);
  } catch (error) {
    upsertEpisodeFile({
      subscriptionId: subscription.id,
      episodeNumber: parsed.episodeNumber,
      originalPath: file.path,
      finalPath,
      sizeBytes: file.size,
      status: "failed",
      errorMessage: error instanceof Error ? error.message : String(error)
    });
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

function findBestSubscription(
  subscriptions: Subscription[],
  filename: string,
  parsed: ReturnType<typeof parseReleaseTitle>
) {
  const normalizedFilename = filename.toLowerCase();
  const parsedTitle = parsed.parsedTitle?.toLowerCase();
  return (
    subscriptions.find((subscription) =>
      normalizedFilename.includes(subscription.name.toLowerCase())
    ) ??
    subscriptions.find(
      (subscription) =>
        parsedTitle && subscription.name.toLowerCase().includes(parsedTitle)
    ) ??
    subscriptions.find((subscription) =>
      findMetadataBySubscription(subscription.id).some(
        (metadata) => metadata.episodeNumber === parsed.episodeNumber
      )
    )
  );
}

function markCompletedJob(
  subscription: Subscription,
  episodeNumber: number,
  finalPath: string
) {
  const metadata = findMetadataBySubscription(subscription.id).find(
    (item) => item.episodeNumber === episodeNumber
  );
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
