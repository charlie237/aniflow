/**
 * Policy for release revisions (v2/v3/…):
 * - Prefer the highest known revision of a variant for first download.
 * - Allow a newer revision to replace an older library file (default ON).
 * - Never let a lower revision import overwrite a higher one.
 */

export type RevisionDecision =
  | { allow: true }
  | { allow: false; reason: string };

/** Normalize revision to >= 1. */
export function normalizeRevision(value: number | null | undefined) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

/**
 * Whether an incoming file/job may be imported into the library for this variant.
 * claimed must be the job metadata revision when tracked (authoritative), else parsed.
 */
export function canImportReleaseRevision(params: {
  claimedRevision: number;
  highestKnownRevision: number;
}): RevisionDecision {
  const claimed = normalizeRevision(params.claimedRevision);
  const highest = normalizeRevision(params.highestKnownRevision);
  if (claimed < highest) {
    return {
      allow: false,
      reason: `Stale release revision v${claimed} (preferred is v${highest})`
    };
  }
  return { allow: true };
}

/**
 * Whether overwriting an existing library file is allowed under the revision policy.
 * - replaceExistingOnRevision=false: caller should not request overwrite (OpenList fails if exists).
 * - When existing revision is known, only equal-or-higher claimed may overwrite.
 * - Unknown existing revision: allow overwrite only if replace flag is on (legacy / untracked).
 */
export function canOverwriteLibraryFile(params: {
  claimedRevision: number;
  existingRevision: number | null;
  replaceExistingOnRevision: boolean;
  libraryFileExists: boolean;
}): RevisionDecision {
  if (!params.libraryFileExists) return { allow: true };

  if (!params.replaceExistingOnRevision) {
    return {
      allow: false,
      reason: "Library file exists and replaceExistingOnRevision is disabled"
    };
  }

  if (params.existingRevision == null) return { allow: true };

  const claimed = normalizeRevision(params.claimedRevision);
  const existing = normalizeRevision(params.existingRevision);
  if (claimed < existing) {
    return {
      allow: false,
      reason: `Refusing to overwrite library v${existing} with older v${claimed}`
    };
  }
  return { allow: true };
}

/**
 * Pick the claimed revision for an incoming media file.
 * Job metadata wins (RSS often has v2 while the torrent name does not).
 */
export function resolveClaimedRevision(params: {
  jobMetadataRevision?: number | null;
  parsedRevision?: number | null;
}) {
  if (params.jobMetadataRevision != null) {
    return normalizeRevision(params.jobMetadataRevision);
  }
  return normalizeRevision(params.parsedRevision);
}
