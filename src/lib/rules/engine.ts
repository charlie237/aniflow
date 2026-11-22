import type { FilterRule, ReleaseMetadata } from "@/lib/db/types";
import { createT, getMessages, type TranslateFn } from "@/lib/i18n";

export interface RuleDecision {
  allowed: boolean;
  reasons: string[];
}

const defaultT = createT(getMessages("zh-CN"));

/**
 * Strict filter: group / resolution / language must match as stored labels
 * (trim + case-insensitive only). No alias buckets or fuzzy families.
 * Stable for "lock one subtitle group + exact res/lang labels from the title".
 */
export function evaluateRules(
  title: string,
  metadata: ReleaseMetadata | Omit<ReleaseMetadata, "id" | "feedItemId">,
  rules: FilterRule[],
  t: TranslateFn = defaultT
): RuleDecision {
  const enabledRules = rules.filter((rule) => rule.enabled);
  const reasons: string[] = [];
  const haystack = [
    title,
    metadata.releaseGroup,
    metadata.parsedTitle,
    metadata.resolution,
    metadata.subtitleLanguage,
    ...(metadata.tags ?? [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const groupAllow = enabledRules.filter((rule) => rule.type === "group_allow");
  if (
    groupAllow.length > 0 &&
    !groupAllow.some((rule) => equalsLoose(metadata.releaseGroup, rule.value))
  ) {
    reasons.push(t("rules.groupNotAllowed"));
  }

  for (const rule of enabledRules.filter((entry) => entry.type === "group_block")) {
    if (equalsLoose(metadata.releaseGroup, rule.value)) {
      reasons.push(t("rules.groupBlocked", { value: rule.value }));
    }
  }

  const resolutionAllow = enabledRules.filter(
    (rule) => rule.type === "resolution_allow"
  );
  if (
    resolutionAllow.length > 0 &&
    !resolutionAllow.some((rule) => equalsLoose(metadata.resolution, rule.value))
  ) {
    reasons.push(t("rules.resolutionNotAllowed"));
  }

  const languageAllow = enabledRules.filter((rule) => rule.type === "language_allow");
  if (
    languageAllow.length > 0 &&
    !languageAllow.some((rule) =>
      equalsLoose(metadata.subtitleLanguage, rule.value)
    )
  ) {
    reasons.push(t("rules.languageNotAllowed"));
  }

  for (const rule of enabledRules.filter((entry) => entry.type === "keyword_include")) {
    if (!haystack.includes(rule.value.toLowerCase())) {
      reasons.push(t("rules.keywordMissing", { value: rule.value }));
    }
  }

  for (const rule of enabledRules.filter((entry) => entry.type === "keyword_exclude")) {
    if (haystack.includes(rule.value.toLowerCase())) {
      reasons.push(t("rules.keywordExcluded", { value: rule.value }));
    }
  }

  return {
    allowed: reasons.length === 0,
    reasons
  };
}

function equalsLoose(left: string | null | undefined, right: string) {
  return normalize(left) === normalize(right);
}

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}
