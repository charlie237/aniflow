import { describe, expect, it } from "vitest";
import { evaluateRules } from "@/lib/rules/engine";
import type { FilterRule, ReleaseMetadata } from "@/lib/db/types";

const metadata: Omit<ReleaseMetadata, "id" | "feedItemId"> = {
  releaseGroup: "GroupA",
  parsedTitle: "Test Anime",
  episodeNumber: 1,
  episodeText: "01",
  releaseRevision: 1,
  resolution: "1080p",
  subtitleLanguage: "CHS",
  container: "mkv",
  tags: ["GroupA", "1080p", "CHS"],
  parseConfidence: 95,
  needsReview: false
};

function rule(type: FilterRule["type"], value: string): FilterRule {
  return {
    id: Math.random(),
    subscriptionId: 1,
    type,
    value,
    enabled: true,
    createdAt: new Date().toISOString()
  };
}

describe("evaluateRules", () => {
  it("allows matching releases", () => {
    const decision = evaluateRules("Test Anime", metadata, [
      rule("group_allow", "GroupA"),
      rule("resolution_allow", "1080p"),
      rule("language_allow", "CHS")
    ]);

    expect(decision.allowed).toBe(true);
  });

  it("blocks excluded keywords", () => {
    const decision = evaluateRules("Test Anime AVC", metadata, [
      rule("keyword_exclude", "AVC")
    ]);

    expect(decision.allowed).toBe(false);
    expect(decision.reasons[0]).toContain("AVC");
  });

  it("matches resolution case-insensitively only (no 1920x1080 alias)", () => {
    expect(
      evaluateRules("Test", metadata, [rule("resolution_allow", "1080P")]).allowed
    ).toBe(true);

    expect(
      evaluateRules("Test", { ...metadata, resolution: "1920x1080" }, [
        rule("resolution_allow", "1080p")
      ]).allowed
    ).toBe(false);
  });

  it("matches language by exact label only", () => {
    expect(
      evaluateRules("Test", { ...metadata, subtitleLanguage: "简体内嵌" }, [
        rule("language_allow", "简体")
      ]).allowed
    ).toBe(false);

    expect(
      evaluateRules("Test", { ...metadata, subtitleLanguage: "简体内嵌" }, [
        rule("language_allow", "简体内嵌")
      ]).allowed
    ).toBe(true);
  });
});
