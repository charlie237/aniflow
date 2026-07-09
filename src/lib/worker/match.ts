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
  knownMetadata?: Array<Pick<
    ReleaseMetadata,
    "episodeNumber" | "releaseGroup" | "resolution" | "subtitleLanguage" | "parsedTitle"
  >>;
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
    if (subscriptionName.includes(parsedTitle) || parsedTitle.includes(subscriptionName)) {
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
    .sort((left, right) => right.score - left.score || left.subscription.id - right.subscription.id);

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
 * Score whether a downloading job is the right owner for an incoming file.
 * Episode equality is assumed by the caller; this only scores identity signals.
 * A hard group mismatch scores 0.
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

  // Both sides have a group and they disagree → never this job.
  if (group && parsedGroup && !equalsLoose(group, parsedGroup)) {
    return 0;
  }

  let score = 0;

  if (group && parsedGroup && equalsLoose(group, parsedGroup)) {
    score += 50;
  } else if (group && normalizedFilename.includes(group.toLowerCase())) {
    score += 45;
  }

  const subName = subscriptionName.trim().toLowerCase();
  if (subName && normalizedFilename.includes(subName)) {
    score += 40;
  }

  const metaTitle = metadata.parsedTitle?.trim().toLowerCase() ?? "";
  if (metaTitle && normalizedFilename.includes(metaTitle)) {
    score += 30;
  }

  const feed = feedTitle.trim().toLowerCase();
  if (feed && (normalizedFilename.includes(feed) || feed.includes(normalizedFilename.slice(0, 40)))) {
    // Weak: full feed titles are long; only count a clear containment either way.
    if (normalizedFilename.length >= 8 && feed.includes(normalizedFilename.replace(/\.[a-z0-9]+$/i, ""))) {
      score += 15;
    }
  }

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

  return score;
}

function equalsLoose(left: string | null | undefined, right: string | null | undefined) {
  const a = (left ?? "").trim().toLowerCase();
  const b = (right ?? "").trim().toLowerCase();
  return a.length > 0 && a === b;
}
