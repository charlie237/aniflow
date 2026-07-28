import type { FilterRule, ReleaseMetadata, Subscription } from "@/lib/db/types";
import { evaluateRules } from "@/lib/rules/engine";
import type { ParsedReleaseTitle } from "@/lib/rss/title-parser";

/** Minimum score required to accept an untracked incoming file match. */
export const MIN_INCOMING_MATCH_SCORE = 50;

export interface IncomingMatchCandidate {
  subscription: Subscription;
  score: number;
  reasons: string[];
}

/**
 * Score how well an untracked incoming media file matches a subscription.
 * Episode-number-only matches score 0 and are never accepted.
 */
export function scoreIncomingSubscriptionMatch(params: {
  subscription: Subscription;
  filename: string;
  parsed: ParsedReleaseTitle | Omit<ReleaseMetadata, "id" | "feedItemId">;
  rules: FilterRule[];
  knownMetadata?: Array<
    Pick<
      ReleaseMetadata,
      | "episodeNumber"
      | "releaseGroup"
      | "resolution"
      | "subtitleLanguage"
      | "parsedTitle"
    >
  >;
}): IncomingMatchCandidate {
  const { subscription, filename, parsed, rules, knownMetadata = [] } = params;
  const reasons: string[] = [];
  let score = 0;

  const enabledRules = rules.filter((rule) => rule.enabled);
  if (enabledRules.length > 0) {
    const decision = evaluateRules(filename, parsed as ReleaseMetadata, enabledRules);
    if (!decision.allowed) {
      return { subscription, score: 0, reasons: decision.reasons };
    }
  }

  const normalizedFilename = filename.toLowerCase();
  const subscriptionName = subscription.name.trim().toLowerCase();
  const parsedTitle = parsed.parsedTitle?.trim().toLowerCase() ?? null;

  if (subscriptionName && normalizedFilename.includes(subscriptionName)) {
    score += 100;
    reasons.push("filename contains subscription name");
  }

  if (parsedTitle && subscriptionName) {
    if (
      subscriptionName.includes(parsedTitle) ||
      parsedTitle.includes(subscriptionName)
    ) {
      score += 80;
      reasons.push("parsed title matches subscription name");
    }
  }

  if (parsed.episodeNumber != null && knownMetadata.length > 0) {
    const sameEpisode = knownMetadata.filter(
      (item) => item.episodeNumber === parsed.episodeNumber
    );
    if (sameEpisode.length > 0) {
      const groupHit = sameEpisode.some((item) =>
        equalsLoose(item.releaseGroup, parsed.releaseGroup)
      );
      const titleHit = sameEpisode.some((item) =>
        equalsLoose(item.parsedTitle, parsed.parsedTitle)
      );
      // Episode number alone (or only resolution/language) is never enough.
      // Require a strong identity signal: release group or known title.
      if (groupHit || titleHit) {
        if (groupHit) {
          score += 40;
          reasons.push("known release group for episode");
        }
        if (titleHit) {
          score += 25;
          reasons.push("known parsed title for episode");
        }
        if (
          sameEpisode.some((item) => equalsLoose(item.resolution, parsed.resolution))
        ) {
          score += 20;
          reasons.push("known resolution for episode");
        }
        if (
          sameEpisode.some((item) =>
            equalsLoose(item.subtitleLanguage, parsed.subtitleLanguage)
          )
        ) {
          score += 15;
          reasons.push("known subtitle language for episode");
        }
      }
    }
  }

  return { subscription, score, reasons };
}

export function pickBestIncomingSubscriptionMatch(
  candidates: IncomingMatchCandidate[],
  minScore = MIN_INCOMING_MATCH_SCORE
): Subscription | null {
  const ranked = candidates
    .filter((entry) => entry.score >= minScore)
    .sort(
      (left, right) =>
        right.score - left.score || left.subscription.id - right.subscription.id
    );

  if (ranked.length === 0) return null;
  if (ranked.length > 1 && ranked[0].score === ranked[1].score) {
    // Ambiguous: two subscriptions score equally high.
    return null;
  }
  return ranked[0].subscription;
}

/** Minimum identity score for linking an incoming file to a tracked download job. */
export const MIN_TRACKED_JOB_MATCH_SCORE = 40;

/**
 * Minimum title-token boost required to allow a release-group mismatch
 * without full subscription/title containment (e.g. multi-token English names).
 */
export const MIN_GROUP_MISMATCH_TITLE_BOOST = 50;

/**
 * Score whether a downloading job is the right owner for an incoming file.
 * Episode equality is assumed by the caller; this only scores identity signals.
 *
 * Group labels often differ between Mikan RSS (中文组名) and the pack tag in the
 * file name (e.g. 三明治摆烂组 vs smzase). Mismatched groups require strong title
 * evidence — a single generic token like "anime" is not enough. Path/task-name
 * evidence is applied by the caller after this score.
 */
export function scoreTrackedJobIdentity(params: {
  subscriptionName: string;
  feedTitle: string;
  metadata: Pick<
    ReleaseMetadata,
    "releaseGroup" | "parsedTitle" | "resolution" | "subtitleLanguage" | "releaseRevision"
  >;
  filename: string;
  parsed: Pick<
    ParsedReleaseTitle,
    "releaseGroup" | "parsedTitle" | "resolution" | "subtitleLanguage" | "releaseRevision"
  >;
}): number {
  const { subscriptionName, feedTitle, metadata, filename, parsed } = params;
  const normalizedFilename = filename.toLowerCase();
  const group = metadata.releaseGroup?.trim() ?? "";
  const parsedGroup = parsed.releaseGroup?.trim() ?? "";

  const titleBoost = titleTokenIdentityBoost(normalizedFilename, [
    subscriptionName,
    metadata.parsedTitle,
    feedTitle
  ]);

  const subName = subscriptionName.trim().toLowerCase();
  const metaTitle = metadata.parsedTitle?.trim().toLowerCase() ?? "";
  const fullTitleHit = Boolean(
    (subName && normalizedFilename.includes(subName)) ||
      (metaTitle.length >= 2 && normalizedFilename.includes(metaTitle))
  );

  const groupMismatch = Boolean(
    group && parsedGroup && !equalsLoose(group, parsedGroup)
  );

  // Cross-group archive is dangerous. Require full title hit or multi-token boost.
  if (
    groupMismatch &&
    !fullTitleHit &&
    titleBoost < MIN_GROUP_MISMATCH_TITLE_BOOST
  ) {
    return 0;
  }

  let score = 0;

  if (group && parsedGroup && equalsLoose(group, parsedGroup)) {
    score += 50;
  } else if (group && normalizedFilename.includes(group.toLowerCase())) {
    score += 45;
  }
  // No soft +10 for group mismatch — that helped weak false positives.

  if (fullTitleHit && subName && normalizedFilename.includes(subName)) {
    score += 40;
  } else if (fullTitleHit && metaTitle && normalizedFilename.includes(metaTitle)) {
    score += 30;
  } else if (subName && normalizedFilename.includes(subName)) {
    score += 40;
  } else if (metaTitle && normalizedFilename.includes(metaTitle)) {
    score += 30;
  }

  score += titleBoost;

  // Soft facets only after identity is already credible (group match or strong title).
  const identityOk =
    !groupMismatch ||
    fullTitleHit ||
    titleBoost >= MIN_GROUP_MISMATCH_TITLE_BOOST;

  if (identityOk) {
    if (
      metadata.resolution &&
      parsed.resolution &&
      equalsLoose(metadata.resolution, parsed.resolution)
    ) {
      score += 10;
    }
    if (
      metadata.subtitleLanguage &&
      parsed.subtitleLanguage &&
      equalsLoose(metadata.subtitleLanguage, parsed.subtitleLanguage)
    ) {
      score += 10;
    }
    if (metadata.releaseRevision === parsed.releaseRevision) {
      score += 5;
    }
  }

  return score;
}

/**
 * Path/task-name evidence strong enough to override a group-mismatch hard reject
 * (OpenList offline task name / magnet dn present in the remote path).
 */
export const MIN_PATH_EVIDENCE_FOR_GROUP_MISMATCH = 90;

function equalsLoose(
  left: string | null | undefined,
  right: string | null | undefined
) {
  const a = (left ?? "").trim().toLowerCase();
  const b = (right ?? "").trim().toLowerCase();
  return a.length > 0 && a === b;
}

/**
 * Score distinctive title tokens that appear in the filename.
 * Latin tokens ≥4 chars and CJK runs ≥2 chars; longer hits score higher.
 */
export function titleTokenIdentityBoost(
  normalizedFilename: string,
  sources: Array<string | null | undefined>
): number {
  let boost = 0;
  const seen = new Set<string>();

  for (const source of sources) {
    if (!source?.trim()) continue;
    const text = source.trim();

    for (const match of text.match(/[A-Za-z][A-Za-z0-9][A-Za-z0-9'-]{2,}/g) ?? []) {
      const token = match.toLowerCase();
      if (token.length < 4 || seen.has(token)) continue;
      // Skip generic media tokens that appear in every release name.
      if (GENERIC_TITLE_TOKENS.has(token)) continue;
      if (!normalizedFilename.includes(token)) continue;
      seen.add(token);
      boost += token.length >= 8 ? 35 : 25;
    }

    for (const match of text.match(/[\u4e00-\u9fff]{2,}/g) ?? []) {
      if (seen.has(match)) continue;
      if (!normalizedFilename.includes(match)) continue;
      seen.add(match);
      boost += match.length >= 4 ? 40 : 30;
    }
  }

  // Cap so token boost cannot alone overwhelm a hard group match, but is
  // enough to separate two same-group / same-episode candidates.
  return Math.min(boost, 80);
}

const GENERIC_TITLE_TOKENS = new Set([
  "webrip",
  "webdl",
  "web-dl",
  "bluray",
  "bdrip",
  "hevc",
  "x264",
  "x265",
  "avc",
  "aac",
  "flac",
  "opus",
  "10bit",
  "8bit",
  "1080p",
  "720p",
  "2160p",
  "480p",
  "season",
  "episode",
  "batch",
  "batch",
  "fin",
  "end",
  "v2",
  "v3",
  "sp",
  "ova",
  "oad",
  "ncop",
  "nced",
  "anime",
  "the",
  "and",
  "show",
  "series"
]);
