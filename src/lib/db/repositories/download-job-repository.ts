import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  notInArray,
  or,
  sql
} from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { mapJob } from "@/lib/db/mappers";
import { downloadJobs } from "@/lib/db/schema";
import type { DownloadJob, JobStatus } from "@/lib/db/types";
import { getSystemSettings } from "@/lib/db/repositories/system-settings-repository";
import { joinRemotePath } from "@/lib/utils/path";

export function getJobForFeedItem(feedItemId: number) {
  const row = getDb()
    .select()
    .from(downloadJobs)
    .where(eq(downloadJobs.feedItemId, feedItemId))
    .get();
  return row ? mapJob(row as unknown as Record<string, unknown>) : null;
}

export function getJob(id: number) {
  const row = getDb().select().from(downloadJobs).where(eq(downloadJobs.id, id)).get();
  return row ? mapJob(row as unknown as Record<string, unknown>) : null;
}

export function createOrUpdateJob(params: {
  subscriptionId: number;
  feedItemId: number;
  status: JobStatus;
  sourceUrl?: string | null;
  targetPath?: string | null;
  openlistTaskId?: string | null;
  errorMessage?: string | null;
}) {
  getDb()
    .insert(downloadJobs)
    .values({
      subscriptionId: params.subscriptionId,
      feedItemId: params.feedItemId,
      status: params.status,
      sourceUrl: params.sourceUrl ?? null,
      targetPath: params.targetPath ?? null,
      openlistTaskId: params.openlistTaskId ?? null,
      errorMessage: params.errorMessage ?? null,
      attempts: 0
    })
    .onConflictDoUpdate({
      target: downloadJobs.feedItemId,
      set: {
        status: params.status,
        sourceUrl: params.sourceUrl
          ? params.sourceUrl
          : sql`${downloadJobs.sourceUrl}`,
        targetPath: params.targetPath
          ? params.targetPath
          : sql`${downloadJobs.targetPath}`,
        openlistTaskId: params.openlistTaskId
          ? params.openlistTaskId
          : sql`${downloadJobs.openlistTaskId}`,
        errorMessage: params.errorMessage ?? null,
        updatedAt: sql`CURRENT_TIMESTAMP`
      }
    })
    .run();
  return getJobForFeedItem(params.feedItemId);
}

export function markJobAttempt(
  jobId: number,
  fields: Partial<DownloadJob>,
  options: { incrementAttempt?: boolean } = {}
) {
  getDb()
    .update(downloadJobs)
    .set({
      status: fields.status ? fields.status : sql`${downloadJobs.status}`,
      openlistTaskId:
        fields.openlistTaskId !== undefined
          ? fields.openlistTaskId
          : sql`${downloadJobs.openlistTaskId}`,
      infoHash:
        fields.infoHash !== undefined
          ? fields.infoHash
          : sql`${downloadJobs.infoHash}`,
      offlineName:
        fields.offlineName !== undefined
          ? fields.offlineName
          : sql`${downloadJobs.offlineName}`,
      targetPath:
        fields.targetPath !== undefined && fields.targetPath !== null
          ? fields.targetPath
          : sql`${downloadJobs.targetPath}`,
      errorMessage:
        fields.errorMessage !== undefined
          ? fields.errorMessage
          : sql`${downloadJobs.errorMessage}`,
      scanMissCount:
        fields.scanMissCount !== undefined
          ? fields.scanMissCount
          : sql`${downloadJobs.scanMissCount}`,
      attempts:
        options.incrementAttempt === false
          ? sql`${downloadJobs.attempts}`
          : sql`${downloadJobs.attempts} + 1`,
      updatedAt: sql`CURRENT_TIMESTAMP`
    })
    .where(eq(downloadJobs.id, jobId))
    .run();
}

export function listJobs(limit = 200) {
  return getDb()
    .select()
    .from(downloadJobs)
    .orderBy(desc(downloadJobs.updatedAt))
    .limit(limit)
    .all()
    .map((row) => mapJob(row as unknown as Record<string, unknown>));
}

export function listJobsByStatus(statuses: JobStatus[]) {
  if (statuses.length === 0) return [];
  return getDb()
    .select()
    .from(downloadJobs)
    .where(inArray(downloadJobs.status, statuses))
    .orderBy(asc(downloadJobs.updatedAt))
    .all()
    .map((row) => mapJob(row as unknown as Record<string, unknown>));
}

export function updateJobStatus(
  jobId: number,
  status: JobStatus,
  fields?: {
    openlistTaskId?: string | null;
    clearOpenlistTaskId?: boolean;
    infoHash?: string | null;
    offlineName?: string | null;
    targetPath?: string | null;
    errorMessage?: string | null;
    scanMissCount?: number;
  }
) {
  getDb()
    .update(downloadJobs)
    .set({
      status,
      openlistTaskId: fields?.clearOpenlistTaskId
        ? null
        : fields?.openlistTaskId
          ? fields.openlistTaskId
          : sql`${downloadJobs.openlistTaskId}`,
      infoHash:
        fields?.infoHash !== undefined
          ? fields.infoHash
          : sql`${downloadJobs.infoHash}`,
      offlineName:
        fields?.offlineName !== undefined
          ? fields.offlineName
          : sql`${downloadJobs.offlineName}`,
      targetPath:
        fields?.targetPath !== undefined && fields.targetPath !== null
          ? fields.targetPath
          : sql`${downloadJobs.targetPath}`,
      errorMessage: fields?.errorMessage ?? null,
      scanMissCount:
        fields?.scanMissCount !== undefined
          ? fields.scanMissCount
          : sql`${downloadJobs.scanMissCount}`,
      updatedAt: sql`CURRENT_TIMESTAMP`
    })
    .where(eq(downloadJobs.id, jobId))
    .run();
}

export function migrateLegacyDownloadJobsToFailed() {
  const jobsRoot = joinRemotePath(getSystemSettings().openlistIncomingPath, "jobs");
  return getDb()
    .update(downloadJobs)
    .set({
      status: "failed",
      errorMessage:
        "Legacy shared download directory is no longer supported; clean the OpenList task and files, then resubmit manually",
      updatedAt: sql`CURRENT_TIMESTAMP`
    })
    .where(
      and(
        inArray(downloadJobs.status, ["downloading", "waiting_file"]),
        or(
          eq(downloadJobs.status, "waiting_file"),
          isNull(downloadJobs.targetPath),
          sql`${downloadJobs.targetPath} != ${jobsRoot} || '/' || cast(${downloadJobs.id} as text)`
        )
      )
    )
    .run().changes;
}

export function claimQueuedJob(jobId: number, targetPath?: string) {
  const result = getDb()
    .update(downloadJobs)
    .set({
      status: "downloading",
      targetPath: targetPath ?? sql`${downloadJobs.targetPath}`,
      attempts: sql`${downloadJobs.attempts} + 1`,
      errorMessage: sql`case
        when ${downloadJobs.errorMessage} is null or ${downloadJobs.errorMessage} = ''
          then 'Submitting offline download'
        else ${downloadJobs.errorMessage}
      end`,
      updatedAt: sql`CURRENT_TIMESTAMP`
    })
    .where(and(eq(downloadJobs.id, jobId), eq(downloadJobs.status, "queued")))
    .run();
  return result.changes > 0;
}

export function failStaleDownloadingJobs(
  maxAgeSeconds?: number,
  errorMessage = "Download timed out waiting for OpenList / 115 completion",
  excludedJobIds: number[] = []
) {
  const ageSeconds =
    maxAgeSeconds ??
    Math.max(1, getSystemSettings().downloadTimeoutMinutes) * 60;
  const excludedIds = [...new Set(excludedJobIds.filter(Number.isInteger))];
  const staleOffset = `-${Math.max(60, ageSeconds)} seconds`;
  const notExcluded =
    excludedIds.length > 0 ? notInArray(downloadJobs.id, excludedIds) : undefined;
  const stale = sql`datetime(${downloadJobs.updatedAt}) < datetime('now', ${staleOffset})`;

  const downloading = getDb()
    .update(downloadJobs)
    .set({ status: "failed", errorMessage, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(and(eq(downloadJobs.status, "downloading"), stale, notExcluded))
    .run().changes;

  const renaming = getDb()
    .update(downloadJobs)
    .set({
      status: "failed",
      errorMessage: "Rename timed out waiting for OpenList file organization",
      updatedAt: sql`CURRENT_TIMESTAMP`
    })
    .where(and(eq(downloadJobs.status, "ready_to_rename"), stale, notExcluded))
    .run().changes;

  return downloading + renaming;
}
