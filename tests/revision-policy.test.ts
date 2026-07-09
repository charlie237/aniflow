import { describe, expect, it } from "vitest";
import {
  canImportReleaseRevision,
  canOverwriteLibraryFile,
  normalizeRevision,
  resolveClaimedRevision
} from "@/lib/worker/revision-policy";

describe("revision-policy", () => {
  it("normalizes invalid revisions to 1", () => {
    expect(normalizeRevision(undefined)).toBe(1);
    expect(normalizeRevision(0)).toBe(1);
    expect(normalizeRevision(2.9)).toBe(2);
  });

  it("prefers job metadata revision over parsed filename revision", () => {
    expect(
      resolveClaimedRevision({ jobMetadataRevision: 2, parsedRevision: 1 })
    ).toBe(2);
    expect(resolveClaimedRevision({ parsedRevision: 3 })).toBe(3);
  });

  it("allows first download of the highest known revision only", () => {
    expect(
      canImportReleaseRevision({ claimedRevision: 2, highestKnownRevision: 2 }).allow
    ).toBe(true);
    expect(
      canImportReleaseRevision({ claimedRevision: 1, highestKnownRevision: 1 }).allow
    ).toBe(true);

    const stale = canImportReleaseRevision({
      claimedRevision: 1,
      highestKnownRevision: 2
    });
    expect(stale.allow).toBe(false);
    if (!stale.allow) {
      expect(stale.reason).toMatch(/v1/i);
      expect(stale.reason).toMatch(/v2/i);
    }
  });

  it("allows v2 to overwrite v1 in the library when replace is enabled", () => {
    expect(
      canOverwriteLibraryFile({
        claimedRevision: 2,
        existingRevision: 1,
        replaceExistingOnRevision: true,
        libraryFileExists: true
      }).allow
    ).toBe(true);
  });

  it("blocks v1 from overwriting v2 in the library", () => {
    const decision = canOverwriteLibraryFile({
      claimedRevision: 1,
      existingRevision: 2,
      replaceExistingOnRevision: true,
      libraryFileExists: true
    });
    expect(decision.allow).toBe(false);
  });

  it("blocks any overwrite when replaceExistingOnRevision is off", () => {
    const decision = canOverwriteLibraryFile({
      claimedRevision: 2,
      existingRevision: 1,
      replaceExistingOnRevision: false,
      libraryFileExists: true
    });
    expect(decision.allow).toBe(false);
  });

  it("allows first library write when no file exists", () => {
    expect(
      canOverwriteLibraryFile({
        claimedRevision: 1,
        existingRevision: null,
        replaceExistingOnRevision: false,
        libraryFileExists: false
      }).allow
    ).toBe(true);
  });
});
