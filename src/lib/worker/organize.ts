import { randomUUID } from "node:crypto";
import type { DownloadJob, Subscription } from "@/lib/db/types";
import {
  acquireWorkerLease,
  getHighestReleaseRevisionForVariant,
  getLibraryFileRevisionAtPath,
  getMetadataForFeedItem,
  getPreferredFeedItemIdForRelease,
  getSubscription,
  getSystemSettings,
  libraryFileExistsAtPath,
  listJobsByStatus,
  refreshWorkerLease,
  releaseWorkerLease,
  updateJobStatus,
  upsertEpisodeFile
} from "@/lib/db/repositories";
import {
  ensureOpenListDirectory,
  isOpenListNotFoundError,
  listOpenListFiles,
  moveOpenListFiles,
  removeOpenListFiles,
  renameOpenListFile,
  type OpenListFileEntry
} from "@/lib/openlist/client";
import { parseReleaseTitle } from "@/lib/rss/title-parser";
import {
  buildEpisodePath,
  extractEpisodeNumberFromFilename,
  getExtension,
  getRemoteBaseName,
  getRemoteDirName,
  isRemotePathWithin,
  joinRemotePath
} from "@/lib/utils/path";
import {
  canImportReleaseRevision,
  canOverwriteLibraryFile,
  resolveClaimedRevision
} from "@/lib/worker/revision-policy";
import {
  contextualError,
  errorMessage,
  incomingPathForJob,
  libraryRootForSubscription,
  listOpenListMediaFiles,
  resolveEffectiveEpisodeNumber
} from "@/lib/worker/pipeline-shared";

const INCOMING_MUTATION_LEASE = "incoming-mutation";
const INCOMING_MUTATION_LEASE_SECONDS = 5 * 60;

/** Episode ranges like "01-13" / "01~13" in a single filename: batch releases. */
const EPISODE_RANGE_RE = /\b\d{1,3}\s*[-~～至]\s*\d{1,3}\b/;

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
  // The job's own directory is authoritative: scan where the download actually
  // landed (stored target_path), so changing openlistIncomingPath mid-flight
  // does not kill in-flight jobs. Only legacy shared/foreign directories fail.
  const targetPath = joinRemotePath(job.targetPath ?? "");
  const expectedJobDir = `/jobs/${job.id}`;
  if (
    targetPath === "/" ||
    !targetPath.endsWith(expectedJobDir) ||
    targetPath.length <= expectedJobDir.length
  ) {
    updateJobStatus(job.id, "failed", {
      targetPath: job.targetPath,
      errorMessage: contextualError(
        "Cannot scan legacy shared download directory",
        "This job must be cleaned in OpenList and manually resubmitted",
        {
          targetPath: job.targetPath,
          expectedTargetPath: incomingPathForJob(job.id)
        }
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
    files = await listOpenListMediaFiles(targetPath);
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
        `Multiple media files found; expected exactly one for episode ${metadata.episodeNumber}. This is likely a batch, multi-part, or sample-containing release — organize it manually in OpenList`,
        {
          targetPath,
          files: files.map((file) => file.name).join(", ")
        }
      )
    });
    return;
  }

  const file = files[0];
  if (EPISODE_RANGE_RE.test(file.name)) {
    updateJobStatus(job.id, "failed", {
      errorMessage: contextualError(
        "Downloaded file validation failed",
        "Filename contains an episode range; this is a batch or multi-part release — organize it manually in OpenList",
        { targetPath, file: file.name }
      )
    });
    return;
  }
  const effectiveEpisode = resolveEffectiveEpisodeNumber(
    metadata.episodeNumber,
    subscription.episodeOffset
  );
  if (effectiveEpisode == null) {
    updateJobStatus(job.id, "failed", {
      errorMessage: contextualError(
        "Downloaded file validation failed",
        `Episode ${metadata.episodeNumber} with offset ${subscription.episodeOffset} produces an invalid episode number`,
        { targetPath, file: file.name }
      )
    });
    return;
  }

  const parsed = parseReleaseTitle(file.name);
  const episode =
    parsed.episodeNumber ??
    extractEpisodeNumberFromFilename({
      filename: file.name,
      seasonNumber: subscription.seasonNumber,
      episodeFileTemplate: getSystemSettings().episodeFileTemplate
    });
  // Accept either the raw RSS episode number (e.g. ep 25 before offset -24) or
  // the already season-adjusted episode number (e.g. S02E01).
  if (episode !== metadata.episodeNumber && episode !== effectiveEpisode) {
    updateJobStatus(job.id, "failed", {
      errorMessage: contextualError(
        "Downloaded file validation failed",
        `Media file episode ${episode ?? "unknown"} does not match expected episode ${metadata.episodeNumber}`,
        { targetPath, file: file.name }
      )
    });
    return;
  }

  await organizeJobFile(file, subscription, job, effectiveEpisode);
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
  if (!job.forceDownload && !importDecision.allow) {
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
  if (!job.forceDownload && effectiveMetadata) {
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
    const renamedBeforeFailure = currentPath !== file.path;
    const message = contextualError(
      renamedBeforeFailure
        ? "Organize downloaded file failed after rename"
        : "Organize downloaded file failed",
      error,
      {
        sourcePath: currentPath,
        targetPath: finalPath
      }
    );
    updateJobStatus(job.id, "failed", {
      targetPath: currentPath,
      errorMessage: message
    });
    upsertEpisodeFile({
      subscriptionId: subscription.id,
      feedItemId,
      episodeNumber: expectedEpisodeNumber,
      originalPath: currentPath,
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

function assertIncomingMutationLease(owner: string) {
  if (!refreshWorkerLease(INCOMING_MUTATION_LEASE, owner)) {
    throw new Error("Incoming mutation lease was lost");
  }
}
