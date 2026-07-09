import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const tempDir = mkdtempSync(join(tmpdir(), "aniflow-rev-"));
const dbPath = join(tempDir, "test.sqlite");

process.env.DATABASE_PATH = dbPath;

const { getSqlite } = await import("@/lib/db/client");
const {
  createOrUpdateJob,
  createSubscription,
  getHighestReleaseRevisionForVariant,
  getJobForFeedItem,
  getLibraryFileRevisionAtPath,
  getPreferredFeedItemIdForRelease,
  libraryFileExistsAtPath,
  listVariantFeedItemIds,
  upsertEpisodeFile,
  upsertFeedItem
} = await import("@/lib/db/repositories");

function meta(
  partial: Partial<{
    releaseGroup: string | null;
    resolution: string | null;
    subtitleLanguage: string | null;
    episodeNumber: number;
    releaseRevision: number;
  }> = {}
) {
  return {
    releaseGroup: partial.releaseGroup ?? "GroupA",
    parsedTitle: "Test Show",
    episodeNumber: partial.episodeNumber ?? 1,
    episodeText: String(partial.episodeNumber ?? 1).padStart(2, "0"),
    releaseRevision: partial.releaseRevision ?? 1,
    resolution: partial.resolution ?? "1080p",
    subtitleLanguage: partial.subtitleLanguage ?? "CHS",
    container: "mkv",
    tags: [],
    parseConfidence: 90,
    needsReview: false
  };
}

describe("release revision preferred variant", () => {
  beforeAll(() => {
    getSqlite();
  });

  beforeEach(() => {
    getSqlite().exec(`
      DELETE FROM episode_files;
      DELETE FROM download_jobs;
      DELETE FROM release_metadata;
      DELETE FROM feed_items;
      DELETE FROM filter_rules;
      DELETE FROM worker_tasks;
      DELETE FROM subscriptions;
    `);
  });

  afterAll(() => {
    try {
      getSqlite().close();
    } catch {
      // ignore
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("prefers higher revision within the same variant facets", () => {
    const sub = createSubscription({
      name: "Test Show",
      rssUrl: "https://example.com/rss-rev-1",
      seasonNumber: 1,
      destinationRoot: "/115/Anime"
    });
    if (!sub) throw new Error("failed to create subscription");

    const v1 = upsertFeedItem(sub, {
      guid: "ep1-v1",
      title: "[GroupA] Test Show - 01 [1080p][CHS].mkv",
      downloadUrl: "https://example.com/v1.torrent",
      metadata: meta({ releaseRevision: 1 })
    });
    const v2 = upsertFeedItem(sub, {
      guid: "ep1-v2",
      title: "[GroupA] Test Show - 01v2 [1080p][CHS].mkv",
      downloadUrl: "https://example.com/v2.torrent",
      metadata: meta({ releaseRevision: 2 })
    });

    expect(
      getPreferredFeedItemIdForRelease(sub.id, meta({ releaseRevision: 1 }))
    ).toBe(v2.id);
    expect(listVariantFeedItemIds(sub.id, meta())).toEqual([v2.id, v1.id]);
  });

  it("matches preferred facets case-insensitively and with trim", () => {
    const sub = createSubscription({
      name: "Test Show",
      rssUrl: "https://example.com/rss-rev-2",
      seasonNumber: 1,
      destinationRoot: "/115/Anime"
    });
    if (!sub) throw new Error("failed to create subscription");

    const v2 = upsertFeedItem(sub, {
      guid: "ep1-v2-case",
      title: "[groupa] Test Show - 01v2 [1080P][chs].mkv",
      downloadUrl: "https://example.com/v2-case.torrent",
      metadata: meta({
        releaseGroup: "groupa",
        resolution: "1080P",
        subtitleLanguage: "chs",
        releaseRevision: 2
      })
    });

    expect(
      getPreferredFeedItemIdForRelease(
        sub.id,
        meta({
          releaseGroup: "GroupA",
          resolution: "1080p",
          subtitleLanguage: " CHS ",
          releaseRevision: 1
        })
      )
    ).toBe(v2.id);
  });

  it("keeps jobs on preferred feed item while siblings remain queryable", () => {
    const sub = createSubscription({
      name: "Test Show",
      rssUrl: "https://example.com/rss-rev-3",
      seasonNumber: 1,
      destinationRoot: "/115/Anime"
    });
    if (!sub) throw new Error("failed to create subscription");

    const v1 = upsertFeedItem(sub, {
      guid: "job-v1",
      title: "[GroupA] Test Show - 02 [1080p][CHS].mkv",
      downloadUrl: "https://example.com/job-v1.torrent",
      metadata: meta({ episodeNumber: 2, releaseRevision: 1 })
    });
    const v2 = upsertFeedItem(sub, {
      guid: "job-v2",
      title: "[GroupA] Test Show - 02 [v2][1080p][CHS].mkv",
      downloadUrl: "https://example.com/job-v2.torrent",
      metadata: meta({ episodeNumber: 2, releaseRevision: 2 })
    });

    createOrUpdateJob({
      subscriptionId: sub.id,
      feedItemId: v1.id,
      status: "queued",
      sourceUrl: "https://example.com/job-v1.torrent"
    });
    createOrUpdateJob({
      subscriptionId: sub.id,
      feedItemId: v2.id,
      status: "queued",
      sourceUrl: "https://example.com/job-v2.torrent"
    });

    expect(getPreferredFeedItemIdForRelease(sub.id, meta({ episodeNumber: 2 }))).toBe(
      v2.id
    );
    expect(getJobForFeedItem(v1.id)?.status).toBe("queued");
    expect(getJobForFeedItem(v2.id)?.status).toBe("queued");
    expect(listVariantFeedItemIds(sub.id, meta({ episodeNumber: 2 }))).toContain(v1.id);
  });

  it("reports highest revision and library file revision for overwrite guards", () => {
    const sub = createSubscription({
      name: "Test Show",
      rssUrl: "https://example.com/rss-rev-4",
      seasonNumber: 1,
      destinationRoot: "/115/Anime"
    });
    if (!sub) throw new Error("failed to create subscription");

    const v1 = upsertFeedItem(sub, {
      guid: "lib-v1",
      title: "[GroupA] Test Show - 03 [1080p][CHS].mkv",
      downloadUrl: "https://example.com/lib-v1.torrent",
      metadata: meta({ episodeNumber: 3, releaseRevision: 1 })
    });
    upsertFeedItem(sub, {
      guid: "lib-v2",
      title: "[GroupA] Test Show - 03v2 [1080p][CHS].mkv",
      downloadUrl: "https://example.com/lib-v2.torrent",
      metadata: meta({ episodeNumber: 3, releaseRevision: 2 })
    });

    expect(getHighestReleaseRevisionForVariant(sub.id, meta({ episodeNumber: 3 }))).toBe(
      2
    );

    const finalPath = "/115/Anime/Test Show/Season 01/Test Show - S01E03.mkv";
    expect(libraryFileExistsAtPath(sub.id, finalPath)).toBe(false);

    upsertEpisodeFile({
      subscriptionId: sub.id,
      feedItemId: v1.id,
      episodeNumber: 3,
      originalPath: "/115/Anime/_incoming/v1.mkv",
      finalPath,
      status: "renamed"
    });

    expect(libraryFileExistsAtPath(sub.id, finalPath)).toBe(true);
    expect(getLibraryFileRevisionAtPath(sub.id, finalPath)).toBe(1);
  });
});
