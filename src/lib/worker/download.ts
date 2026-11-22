import type { DownloadJob } from "@/lib/db/types";
import {
  claimQueuedJob,
  failStaleDownloadingJobs,
  getFeedItem,
  getJob,
  getLibraryEpisodeState,
  getMetadataForFeedItem,
  getPreferredFeedItemIdForRelease,
  getSubscription,
  getSystemSettings,
  listJobsByStatus,
  listRules,
  markJobAttempt,
  migrateLegacyDownloadJobsToFailed,
  touchJobActivity,
  updateJobStatus
} from "@/lib/db/repositories";
import {
  add115OfflineDownload,
  ensureOpenListDirectory,
  isOfflineTaskFailed,
  listOfflineDownloadDone,
  listOfflineDownloadTransferUndone,
  listOfflineDownloadUndone,
  listOpenListFiles
} from "@/lib/openlist/client";
import { evaluateRules } from "@/lib/rules/engine";
import { resolveOfflineDownloadUrl } from "@/lib/torrent/magnet";
import {
  canOverwriteLibraryFile,
  resolveClaimedRevision
} from "@/lib/worker/revision-policy";
import { scanAndRenameIncoming } from "@/lib/worker/organize";
import {
  contextualError,
  incomingPathForJob,
  resolveEffectiveEpisodeNumber,
  supersedeSiblingRevisionJobs,
  type WorkerTaskProgressReporter
} from "@/lib/worker/pipeline-shared";

/** Keep download lifecycle work independent from RSS polling success. */
export async function runDownloadMaintenance(
  reportProgress?: WorkerTaskProgressReporter
) {
  const migrated = migrateLegacyDownloadJobsToFailed();
  if (migrated > 0) {
    console.log(
      `[pipeline] marked ${migrated} legacy shared-path download job(s) as failed`
    );
  }
  // A file already present in the job-owned directory is the strongest completion signal.
  reportProgress?.({ phase: "scanning_files" });
  await scanAndRenameIncoming();
  reportProgress?.({ phase: "checking_downloads" });
  await reconcileDownloadingJobs();
  reportProgress?.({ phase: "submitting_downloads" });
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
 *
 * Fail-stop policy: a job is only failed on a *confirmed* signal —
 * (a) the OpenList task itself reports failure, or (b) no activity can be
 * confirmed for `downloadTimeoutMinutes`. A task that is present and not
 * failed refreshes the job's activity timestamp, so long downloads and the
 * post-download transfer phase are never killed by the wall-clock timer.
 * Transient OpenList list failures are logged, never treated as job failure.
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
    ].filter(({ result }) => !result.available);
    if (unavailable.length > 0) {
      console.warn(
        `[pipeline] OpenList task list unavailable; keeping ${openJobs.length} downloading job(s) active until confirmed failure or timeout: ${unavailable
          .map(({ name, result }) => `${name}: ${result.error ?? "unavailable"}`)
          .join("; ")}`
      );
    }

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
      if (task) {
        // Task is present and not failed: confirmed working, keep the job alive.
        // Half-window throttle avoids re-ordering the dashboard on every cycle.
        touchJobActivity(job.id, Math.floor(staleSeconds / 2));
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

export async function confirmJob(
  jobId: number,
  options?: { force?: boolean }
) {
  const job = getJob(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);
  const force = options?.force ?? false;
  if (!["discovered", "needs_review"].includes(job.status) && !(force && job.status === "skipped")) {
    throw new Error(
      `Job ${jobId} cannot be confirmed from status ${job.status}; expected discovered, needs_review, or skipped (forced)`
    );
  }
  console.log(`[pipeline] confirm job#${job.id}${force ? " (forced)" : ""}`);
  updateJobStatus(job.id, "queued", {
    errorMessage: null,
    clearOpenlistTaskId: true,
    forceDownload: force
  });
  await submitJob({ ...job, status: "queued", openlistTaskId: null, forceDownload: force });
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
  if (feedItem && metadata && !job.forceDownload) {
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

  // Pre-flight library check: retry must not re-download an episode that is
  // already in the library unless the revision policy would replace it.
  const settings = getSystemSettings();
  const effectiveEpisode = resolveEffectiveEpisodeNumber(
    metadata?.episodeNumber,
    subscription.episodeOffset
  );
  if (effectiveEpisode != null) {
    const libraryEpisode = getLibraryEpisodeState(
      subscription.id,
      effectiveEpisode
    );
    if (libraryEpisode) {
      const claimedRevision = resolveClaimedRevision({
        jobMetadataRevision: metadata?.releaseRevision
      });
      const overwriteDecision = canOverwriteLibraryFile({
        claimedRevision,
        existingRevision: libraryEpisode.knownRevision,
        replaceExistingOnRevision: settings.replaceExistingOnRevision,
        libraryFileExists: true
      });
      if (!overwriteDecision.allow) {
        updateJobStatus(job.id, "failed", {
          errorMessage: contextualError(
            "Library episode already exists",
            overwriteDecision.reason,
            { episodeNumber: effectiveEpisode, path: libraryEpisode.path }
          )
        });
        console.log(
          `[pipeline] job#${job.id} blocked: ${overwriteDecision.reason}`
        );
        return;
      }
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
    markJobAttempt(
      job.id,
      {
        status: "failed",
        ...(returnedTaskId ? { openlistTaskId: returnedTaskId } : {}),
        targetPath,
        errorMessage: message
      },
      { incrementAttempt: !claimedAttempt }
    );
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
