import type {
  ReleaseMetadata,
  Subscription,
  WorkerTaskPhase
} from "@/lib/db/types";
import {
  getJobForFeedItem,
  getSystemSettings,
  listVariantFeedItemIds,
  updateJobStatus
} from "@/lib/db/repositories";
import {
  listOpenListFiles,
  type OpenListFileEntry
} from "@/lib/openlist/client";
import { isMediaFile, joinRemotePath } from "@/lib/utils/path";

export interface PipelineResult {
  /** Total items in the RSS feed this poll. */
  fetched: number;
  /** Items that matched rules and were written to SQLite. */
  discovered: number;
  queued: number;
  skipped: number;
  failed: number;
}

export interface WorkerTaskProgress {
  phase: WorkerTaskPhase;
  detail?: string | null;
  current?: number | null;
  total?: number | null;
}

export type WorkerTaskProgressReporter = (
  progress: WorkerTaskProgress
) => void;

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function contextualError(
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

export async function listOpenListMediaFiles(
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
      files.push(...(await listOpenListMediaFiles(entry.path, visited)));
    } else if (isMediaFile(entry.path)) {
      files.push(entry);
    }
  }
  return files;
}

export function supersedeSiblingRevisionJobs(
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

export function markSupersededJob(feedItemId: number) {
  const job = getJobForFeedItem(feedItemId);
  if (!job) return;
  // User-forced downloads are exempt from revision supersede handling.
  if (job.forceDownload) return;

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

/**
 * Apply a subscription's episodeOffset to a parsed feed episode number.
 * Returns null if the raw episode is null or the shifted episode would be negative.
 */
export function resolveEffectiveEpisodeNumber(
  rawEpisode: number | null | undefined,
  episodeOffset = 0
): number | null {
  if (rawEpisode == null || !Number.isInteger(rawEpisode)) return null;
  const shifted = rawEpisode + (Number.isInteger(episodeOffset) ? episodeOffset : 0);
  return shifted >= 0 ? shifted : null;
}
