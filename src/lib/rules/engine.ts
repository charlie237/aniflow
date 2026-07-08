import type { FilterRule, ReleaseMetadata } from "@/lib/db/types";

export interface RuleDecision {
  allowed: boolean;
  reasons: string[];
}

export function evaluateRules(
  title: string,
  metadata: ReleaseMetadata | Omit<ReleaseMetadata, "id" | "feedItemId">,
  rules: FilterRule[]
): RuleDecision {
  const enabledRules = rules.filter((rule) => rule.enabled);
  const reasons: string[] = [];
  const haystack = [
    title,
    metadata.releaseGroup,
    metadata.parsedTitle,
    metadata.resolution,
    metadata.subtitleLanguage,
    metadata.source,
    metadata.codec,
    metadata.audio,
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
    reasons.push("字幕组不在白名单");
  }

  for (const rule of enabledRules.filter((entry) => entry.type === "group_block")) {
    if (equalsLoose(metadata.releaseGroup, rule.value)) {
      reasons.push(`字幕组 ${rule.value} 已屏蔽`);
    }
  }

  const resolutionAllow = enabledRules.filter(
    (rule) => rule.type === "resolution_allow"
  );
  if (
    resolutionAllow.length > 0 &&
    !resolutionAllow.some((rule) => equalsLoose(metadata.resolution, rule.value))
  ) {
    reasons.push("分辨率不在允许范围");
  }

  const languageAllow = enabledRules.filter((rule) => rule.type === "language_allow");
  if (
    languageAllow.length > 0 &&
    !languageAllow.some((rule) =>
      equalsLoose(metadata.subtitleLanguage, rule.value)
    )
  ) {
    reasons.push("字幕语言不在允许范围");
  }

  for (const rule of enabledRules.filter((entry) => entry.type === "keyword_include")) {
    if (!haystack.includes(rule.value.toLowerCase())) {
      reasons.push(`缺少关键词 ${rule.value}`);
    }
  }

  for (const rule of enabledRules.filter((entry) => entry.type === "keyword_exclude")) {
    if (haystack.includes(rule.value.toLowerCase())) {
      reasons.push(`命中排除词 ${rule.value}`);
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
