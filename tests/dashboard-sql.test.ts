import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const tempDir = mkdtempSync(join(tmpdir(), "aniflow-dash-"));
const dbPath = join(tempDir, "test.sqlite");

process.env.DATABASE_PATH = dbPath;

const { getSqlite } = await import("@/lib/db/client");
const {
  addRule,
  completeWorkerTask,
  createOrUpdateJob,
  createSubscription,
  enqueueWorkerTask,
  getDashboardEpisodePage,
  getDashboardWorkerTaskPage,
  getLibraryEpisodeState,
  syncLibraryEpisodeInventory,
  upsertFeedItem
} = await import("@/lib/db/repositories");

describe("dashboard SQL pagination", () => {
  beforeAll(() => {
    getSqlite(); // migrate
  });

  beforeEach(() => {
    const db = getSqlite();
    db.exec(`
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

  it("paginates preferred episode variants and applies allow rules in SQL", () => {
    const sub = createSubscription({
      name: "Test Show",
      rssUrl: "https://example.com/rss-dash-1",
      seasonNumber: 1,
      destinationRoot: "/115/Anime",
      autoDownload: true
    });
    expect(sub).toBeTruthy();
    if (!sub) return;

    addRule(sub.id, "group_allow", "GroupA");
    addRule(sub.id, "resolution_allow", "1080p");
    addRule(sub.id, "language_allow", "CHS");

    for (const [ep, rev, guid] of [
      [1, 1, "ep1-v1"],
      [1, 2, "ep1-v2"],
      [2, 1, "ep2-v1"]
    ] as const) {
      const feed = upsertFeedItem(sub, {
        guid,
        title: `[GroupA] Test Show - ${String(ep).padStart(2, "0")}${rev > 1 ? `v${rev}` : ""} [1080p][CHS].mkv`,
        downloadUrl: `https://example.com/${guid}.torrent`,
        publishedAt: new Date(Date.UTC(2026, 0, ep + rev)).toISOString(),
        metadata: {
          releaseGroup: "GroupA",
          parsedTitle: "Test Show",
          episodeNumber: ep,
          episodeText: String(ep).padStart(2, "0"),
          releaseRevision: rev,
          resolution: "1080p",
          subtitleLanguage: "CHS",
          container: "mkv",
          tags: ["GroupA", "1080p", "CHS"],
          parseConfidence: 90,
          needsReview: false
        }
      });
      createOrUpdateJob({
        subscriptionId: sub.id,
        feedItemId: feed.id,
        status: rev === 2 || ep === 2 ? "completed" : "skipped",
        sourceUrl: `https://example.com/${guid}.torrent`
      });
    }

    upsertFeedItem(sub, {
      guid: "blocked",
      title: "[Other] Test Show - 03 [1080p][CHS].mkv",
      downloadUrl: "https://example.com/blocked.torrent",
      metadata: {
        releaseGroup: "Other",
        parsedTitle: "Test Show",
        episodeNumber: 3,
        episodeText: "03",
        releaseRevision: 1,
        resolution: "1080p",
        subtitleLanguage: "CHS",
        container: "mkv",
        tags: [],
        parseConfidence: 90,
        needsReview: false
      }
    });

    const page = getDashboardEpisodePage({
      episodeSubscriptionId: String(sub.id),
      episodePage: "1",
      episodePageSize: "10"
    });

    expect(page.total).toBe(2);
    expect(page.rows).toHaveLength(2);
    const episodes = page.rows.map((row) => row.episodeNumber).sort();
    expect(episodes).toEqual([1, 2]);
    const ep1 = page.rows.find((row) => row.episodeNumber === 1);
    expect(ep1?.metadata?.releaseRevision).toBe(2);
    expect(page.counts.all).toBe(2);
  });

  it("supports status filter and page size in SQL", () => {
    const sub = createSubscription({
      name: "Show B",
      rssUrl: "https://example.com/rss-dash-2",
      seasonNumber: 1,
      destinationRoot: "/115/Anime"
    });
    if (!sub) return;

    for (let ep = 1; ep <= 5; ep += 1) {
      const feed = upsertFeedItem(sub, {
        guid: `b-${ep}`,
        title: `[G] Show B - ${String(ep).padStart(2, "0")} [720p][CHS].mkv`,
        downloadUrl: `https://example.com/b-${ep}.torrent`,
        metadata: {
          releaseGroup: "G",
          parsedTitle: "Show B",
          episodeNumber: ep,
          episodeText: String(ep).padStart(2, "0"),
          releaseRevision: 1,
          resolution: "720p",
          subtitleLanguage: "CHS",
          container: "mkv",
          tags: [],
          parseConfidence: 80,
          needsReview: false
        }
      });
      createOrUpdateJob({
        subscriptionId: sub.id,
        feedItemId: feed.id,
        status: ep <= 2 ? "failed" : ep === 3 ? "needs_review" : "queued",
        sourceUrl: `https://example.com/b-${ep}.torrent`
      });
    }

    const failed = getDashboardEpisodePage({
      episodeSubscriptionId: String(sub.id),
      episodeStatus: "failed",
      episodePageSize: "10"
    });
    expect(failed.total).toBe(2);
    expect(failed.counts.failed).toBe(2);
    expect(failed.counts.waiting).toBe(1);
    expect(failed.counts.active).toBe(2);

    // pageSize is restricted to 10/20/50; with 5 rows a single page is enough.
    const page1 = getDashboardEpisodePage({
      episodeSubscriptionId: String(sub.id),
      episodeStatus: "all",
      episodePage: "1",
      episodePageSize: "10"
    });
    expect(page1.pageSize).toBe(10);
    expect(page1.pageCount).toBe(1);
    expect(page1.rows).toHaveLength(5);
    expect(page1.total).toBe(5);
  });

  it("paginates and categorizes worker tasks in SQL", () => {
    for (let index = 0; index < 25; index += 1) {
      const task = enqueueWorkerTask({ type: "poll_all" });
      expect(task).toBeTruthy();
      if (!task) return;
      completeWorkerTask(task.id, {
        fetched: 100,
        discovered: 10,
        queued: index % 2 === 0 ? 1 : 0,
        skipped: index % 2 === 0 ? 99 : 100,
        failed: 0
      });
    }

    const secondPage = getDashboardWorkerTaskPage({
      workerTaskPage: "2",
      workerTaskPageSize: "10"
    });
    expect(secondPage).toMatchObject({
      total: 25,
      taskTotal: 25,
      page: 2,
      pageSize: 10,
      pageCount: 3,
      counts: {
        all: 25,
        action: 13,
        routine: 12,
        active: 0,
        attention: 0,
        other: 0
      }
    });
    expect(secondPage.rows).toHaveLength(10);

    const routinePage = getDashboardWorkerTaskPage({
      workerTaskCategory: "routine",
      workerTaskPage: "2",
      workerTaskPageSize: "10"
    });
    expect(routinePage).toMatchObject({
      total: 12,
      taskTotal: 12,
      page: 2,
      pageSize: 10,
      pageCount: 2,
      filters: { category: "routine" }
    });
    expect(routinePage.rows).toHaveLength(2);
  });

  it("shows scanned library episodes without RSS and merges RSS later", () => {
    const sub = createSubscription({
      name: "Frieren",
      rssUrl: "https://example.com/rss-library-sync",
      seasonNumber: 2,
      destinationRoot: "/115/Anime"
    });
    if (!sub) return;

    const root = "/115/Anime/Frieren/Season 02";
    syncLibraryEpisodeInventory(sub.id, root, [
      {
        path: `${root}/Frieren - S02E01.mkv`,
        episodeNumber: 1,
        sizeBytes: 100
      },
      {
        path: `${root}/Frieren - S02E02.mkv`,
        episodeNumber: 2,
        sizeBytes: 200
      }
    ]);

    expect(getLibraryEpisodeState(sub.id, 1)).toMatchObject({
      knownRevision: null,
      fileCount: 1
    });

    let page = getDashboardEpisodePage({
      episodeSubscriptionId: String(sub.id),
      episodePageSize: "10"
    });
    expect(page.total).toBe(2);
    expect(page.rows.every((row) => row.item == null)).toBe(true);
    expect(page.rows.map((row) => row.episodeNumber).sort()).toEqual([1, 2]);

    upsertFeedItem(sub, {
      guid: "frieren-s2-e2",
      title: "[Group] Frieren S2 - 02 [1080p][CHS].mkv",
      downloadUrl: "https://example.com/frieren-s2-e2.torrent",
      metadata: {
        releaseGroup: "Group",
        parsedTitle: "Frieren S2",
        episodeNumber: 2,
        episodeText: "02",
        releaseRevision: 1,
        resolution: "1080p",
        subtitleLanguage: "CHS",
        container: "mkv",
        tags: [],
        parseConfidence: 90,
        needsReview: false
      }
    });

    page = getDashboardEpisodePage({
      episodeSubscriptionId: String(sub.id),
      episodePageSize: "10"
    });
    expect(page.total).toBe(2);
    expect(page.rows.find((row) => row.episodeNumber === 2)?.item).not.toBeNull();
    expect(page.rows.find((row) => row.episodeNumber === 2)?.files).toHaveLength(1);

    syncLibraryEpisodeInventory(sub.id, root, [
      {
        path: `${root}/Frieren - S02E02.mkv`,
        episodeNumber: 2,
        sizeBytes: 200
      }
    ]);
    expect(getLibraryEpisodeState(sub.id, 1)).toBeNull();
  });

  it("shows active subscriptions by default and archived subscriptions on demand", () => {
    const active = createSubscription({
      name: "Active Show",
      rssUrl: "https://example.com/rss-active",
      destinationRoot: "/115/Anime"
    });
    const archived = createSubscription({
      name: "Archived Show",
      rssUrl: "https://example.com/rss-archived",
      destinationRoot: "/115/Anime",
      enabled: false
    });
    if (!active || !archived) return;

    for (const [subscription, guid] of [
      [active, "active-1"],
      [archived, "archived-1"]
    ] as const) {
      upsertFeedItem(subscription, {
        guid,
        title: `[G] ${subscription.name} - 01 [1080p][CHS].mkv`,
        downloadUrl: `https://example.com/${guid}.torrent`,
        metadata: {
          releaseGroup: "G",
          parsedTitle: subscription.name,
          episodeNumber: 1,
          episodeText: "01",
          releaseRevision: 1,
          resolution: "1080p",
          subtitleLanguage: "CHS",
          container: "mkv",
          tags: [],
          parseConfidence: 90,
          needsReview: false
        }
      });
    }

    const activePage = getDashboardEpisodePage({ episodePageSize: "10" });
    expect(activePage.total).toBe(1);
    expect(activePage.rows[0]?.subscriptionName).toBe("Active Show");
    expect(activePage.filters.subscriptionState).toBe("active");
    expect(activePage.subscriptionCounts).toEqual({ active: 1, archived: 1 });
    expect(activePage.manualSubscriptionOptions.map((item) => item.id)).toEqual([
      active.id
    ]);

    const archivedPage = getDashboardEpisodePage({
      episodeSubscriptionState: "archived",
      episodePageSize: "10"
    });
    expect(archivedPage.total).toBe(1);
    expect(archivedPage.rows[0]?.subscriptionName).toBe("Archived Show");
    expect(archivedPage.filters.subscriptionState).toBe("archived");
    expect(archivedPage.subscriptionOptions.map((item) => item.id)).toEqual([
      archived.id
    ]);
  });
});

// Prevent unused import lint noise if vi is needed for future stubs
void vi;
