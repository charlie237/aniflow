import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const tempDir = mkdtempSync(join(tmpdir(), "aniflow-dl-retry-"));
const dbPath = join(tempDir, "dl-retry.sqlite");
process.env.DATABASE_PATH = dbPath;

const { getSqlite } = await import("@/lib/db/client");
const {
  claimQueuedJob,
  createOrUpdateJob,
  createSubscription,
  failStaleDownloadingJobs,
  getJob,
  requeueFailedDownloadJobs,
  saveSystemSettings,
  getSystemSettings,
  upsertFeedItem
} = await import("@/lib/db/repositories");
const {
  cleanupDeletedSubscriptionIncoming,
  pollSubscription,
  reconcileDownloadingJobs,
  submitJob
} = await import("@/lib/worker/pipeline");

describe("requeueFailedDownloadJobs", () => {
  beforeAll(() => {
    getSqlite();
  });

  beforeEach(() => {
    getSqlite().exec(`
      DELETE FROM download_jobs;
      DELETE FROM release_metadata;
      DELETE FROM feed_items;
      DELETE FROM filter_rules;
      DELETE FROM subscriptions;
    `);
    const current = getSystemSettings();
    saveSystemSettings({
      ...current,
      openlistBaseUrl: "",
      openlistToken: "",
      downloadAutoRetryEnabled: true,
      downloadAutoRetryMaxAttempts: 3,
      downloadAutoRetryCooldownMinutes: 10
    });
  });

  afterAll(() => {
    try {
      getSqlite().close();
    } catch {
      // ignore
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("requeues cooled-down failed jobs and clears openlist task id", () => {
    const sub = createSubscription({
      name: "Retry Show",
      rssUrl: "https://example.com/rss-retry-1",
      seasonNumber: 1,
      destinationRoot: "/115/Anime"
    });
    if (!sub) return;

    const feed = upsertFeedItem(sub, {
      guid: "retry-1",
      title: "[G] Retry Show - 01 [1080p][CHS].mkv",
      downloadUrl: "magnet:?xt=urn:btih:abc",
      metadata: {
        releaseGroup: "G",
        parsedTitle: "Retry Show",
        episodeNumber: 1,
        episodeText: "01",
        releaseRevision: 1,
        resolution: "1080p",
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
      status: "failed",
      sourceUrl: "magnet:?xt=urn:btih:abc",
      openlistTaskId: "old-task-id",
      errorMessage: "timeout"
    });

    getSqlite()
      .prepare(
        `UPDATE download_jobs SET
          attempts = 1,
          updated_at = datetime('now', '-15 minutes')
         WHERE feed_item_id = ?`
      )
      .run(feed.id);

    expect(requeueFailedDownloadJobs()).toBe(1);
    const job = getJob(
      (getSqlite()
        .prepare("SELECT id FROM download_jobs WHERE feed_item_id = ?")
        .get(feed.id) as { id: number }).id
    );
    expect(job?.status).toBe("queued");
    expect(job?.openlistTaskId).toBeNull();
    expect(job?.errorMessage).toContain("auto-retry");
  });

  it("respects max attempts and disabled setting", () => {
    const sub = createSubscription({
      name: "Retry Show 2",
      rssUrl: "https://example.com/rss-retry-2",
      seasonNumber: 1,
      destinationRoot: "/115/Anime"
    });
    if (!sub) return;

    const feed = upsertFeedItem(sub, {
      guid: "retry-2",
      title: "[G] Retry Show 2 - 01 [1080p][CHS].mkv",
      downloadUrl: "magnet:?xt=urn:btih:def",
      metadata: {
        releaseGroup: "G",
        parsedTitle: "Retry Show 2",
        episodeNumber: 1,
        episodeText: "01",
        releaseRevision: 1,
        resolution: "1080p",
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
      status: "failed",
      sourceUrl: "magnet:?xt=urn:btih:def",
      errorMessage: "boom"
    });
    getSqlite()
      .prepare(
        `UPDATE download_jobs SET
          attempts = 3,
          updated_at = datetime('now', '-15 minutes')
         WHERE feed_item_id = ?`
      )
      .run(feed.id);

    expect(requeueFailedDownloadJobs()).toBe(0);

    getSqlite()
      .prepare(
        `UPDATE download_jobs SET attempts = 1 WHERE feed_item_id = ?`
      )
      .run(feed.id);

    const current = getSystemSettings();
    saveSystemSettings({ ...current, downloadAutoRetryEnabled: false });
    expect(requeueFailedDownloadJobs()).toBe(0);
  });

  it("does not requeue failed jobs for a disabled subscription", () => {
    const sub = createSubscription({
      name: "Paused Show",
      rssUrl: "https://example.com/rss-paused",
      enabled: false,
      seasonNumber: 1,
      destinationRoot: "/115/Anime"
    });
    if (!sub) return;

    const feed = upsertFeedItem(sub, {
      guid: "paused-1",
      title: "[G] Paused Show - 01 [1080p][CHS].mkv",
      downloadUrl: "magnet:?xt=urn:btih:paused",
      metadata: {
        releaseGroup: "G",
        parsedTitle: "Paused Show",
        episodeNumber: 1,
        episodeText: "01",
        releaseRevision: 1,
        resolution: "1080p",
        subtitleLanguage: "CHS",
        container: "mkv",
        tags: [],
        parseConfidence: 80,
        needsReview: false
      }
    });
    const job = createOrUpdateJob({
      subscriptionId: sub.id,
      feedItemId: feed.id,
      status: "failed",
      sourceUrl: "magnet:?xt=urn:btih:paused",
      errorMessage: "timeout"
    });
    if (!job) return;
    getSqlite()
      .prepare(
        `UPDATE download_jobs SET attempts = 1,
         updated_at = datetime('now', '-15 minutes') WHERE id = ?`
      )
      .run(job.id);

    expect(requeueFailedDownloadJobs()).toBe(0);
    expect(getJob(job.id)?.status).toBe("failed");
  });

  it("does not poll or submit new downloads while a subscription is disabled", async () => {
    const sub = createSubscription({
      name: "Disabled Show",
      rssUrl: "https://example.com/rss-disabled",
      enabled: false,
      seasonNumber: 1,
      destinationRoot: "/115/Anime"
    });
    if (!sub) return;

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    try {
      expect(await pollSubscription(sub.id)).toEqual({
        fetched: 0,
        discovered: 0,
        queued: 0,
        skipped: 0,
        failed: 0
      });

      const feed = upsertFeedItem(sub, {
        guid: "disabled-1",
        title: "[G] Disabled Show - 01 [1080p][CHS].mkv",
        downloadUrl: "magnet:?xt=urn:btih:disabled",
        metadata: {
          releaseGroup: "G",
          parsedTitle: "Disabled Show",
          episodeNumber: 1,
          episodeText: "01",
          releaseRevision: 1,
          resolution: "1080p",
          subtitleLanguage: "CHS",
          container: "mkv",
          tags: [],
          parseConfidence: 80,
          needsReview: false
        }
      });
      const job = createOrUpdateJob({
        subscriptionId: sub.id,
        feedItemId: feed.id,
        status: "queued",
        sourceUrl: "magnet:?xt=urn:btih:disabled"
      });
      if (!job) return;

      await submitJob(job);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(getJob(job.id)?.status).toBe("discovered");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("claims a queued job only once", () => {
    const sub = createSubscription({
      name: "Claim Show",
      rssUrl: "https://example.com/rss-claim",
      seasonNumber: 1,
      destinationRoot: "/115/Anime"
    });
    if (!sub) return;

    const feed = upsertFeedItem(sub, {
      guid: "claim-1",
      title: "[G] Claim Show - 01 [1080p][CHS].mkv",
      downloadUrl: "magnet:?xt=urn:btih:claim",
      metadata: {
        releaseGroup: "G",
        parsedTitle: "Claim Show",
        episodeNumber: 1,
        episodeText: "01",
        releaseRevision: 1,
        resolution: "1080p",
        subtitleLanguage: "CHS",
        container: "mkv",
        tags: [],
        parseConfidence: 80,
        needsReview: false
      }
    });

    const job = createOrUpdateJob({
      subscriptionId: sub.id,
      feedItemId: feed.id,
      status: "queued",
      sourceUrl: "magnet:?xt=urn:btih:claim"
    });
    if (!job) return;

    expect(claimQueuedJob(job.id)).toBe(true);
    expect(claimQueuedJob(job.id)).toBe(false);
    expect(getJob(job.id)?.status).toBe("downloading");
  });

  it("fails stale ready_to_rename jobs", () => {
    const sub = createSubscription({
      name: "Stale Rename",
      rssUrl: "https://example.com/rss-stale-rename",
      seasonNumber: 1,
      destinationRoot: "/115/Anime"
    });
    if (!sub) return;

    const feed = upsertFeedItem(sub, {
      guid: "stale-rename-1",
      title: "[G] Stale Rename - 01 [1080p][CHS].mkv",
      downloadUrl: "magnet:?xt=urn:btih:stale",
      metadata: {
        releaseGroup: "G",
        parsedTitle: "Stale Rename",
        episodeNumber: 1,
        episodeText: "01",
        releaseRevision: 1,
        resolution: "1080p",
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
      status: "ready_to_rename",
      sourceUrl: "magnet:?xt=urn:btih:stale",
      targetPath: "/115/Anime/_incoming"
    });
    getSqlite()
      .prepare(
        `UPDATE download_jobs SET updated_at = datetime('now', '-2 hours')
         WHERE feed_item_id = ?`
      )
      .run(feed.id);

    expect(failStaleDownloadingJobs(60)).toBe(1);
    const job = getJob(
      (
        getSqlite()
          .prepare("SELECT id FROM download_jobs WHERE feed_item_id = ?")
          .get(feed.id) as { id: number }
      ).id
    );
    expect(job?.status).toBe("failed");
    expect(job?.errorMessage).toMatch(/Rename timed out/i);
  });

  it("does not time out a download whose OpenList activity was just confirmed", async () => {
    const sub = createSubscription({
      name: "Active Download",
      rssUrl: "https://example.com/rss-active-download",
      seasonNumber: 1,
      destinationRoot: "/115/Anime"
    });
    if (!sub) return;

    const feed = upsertFeedItem(sub, {
      guid: "active-download-1",
      title: "[G] Active Download - 01 [1080p][CHS].mkv",
      downloadUrl: "magnet:?xt=urn:btih:active",
      metadata: {
        releaseGroup: "G",
        parsedTitle: "Active Download",
        episodeNumber: 1,
        episodeText: "01",
        releaseRevision: 1,
        resolution: "1080p",
        subtitleLanguage: "CHS",
        container: "mkv",
        tags: [],
        parseConfidence: 80,
        needsReview: false
      }
    });
    const job = createOrUpdateJob({
      subscriptionId: sub.id,
      feedItemId: feed.id,
      status: "downloading",
      sourceUrl: "magnet:?xt=urn:btih:active",
      openlistTaskId: "active-task"
    });
    if (!job) return;
    getSqlite()
      .prepare(
        "UPDATE download_jobs SET updated_at = datetime('now', '-2 hours') WHERE id = ?"
      )
      .run(job.id);

    saveSystemSettings({
      ...getSystemSettings(),
      openlistBaseUrl: "http://openlist.local",
      openlistToken: "token",
      downloadTimeoutMinutes: 1
    });
    const fetchMock = vi.fn(async (input: string | URL | Request) => ({
      ok: true,
      json: async () => ({
        code: 200,
        data: String(input).endsWith("/api/task/offline_download/undone")
          ? [
              {
                id: "active-task",
                name: "episode",
                state: 1,
                status: "running",
                progress: 50,
                error: ""
              }
            ]
          : []
      })
    }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      expect(await reconcileDownloadingJobs()).toEqual({ checked: 1, failed: 0 });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(getJob(job.id)?.status).toBe("downloading");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("refuses deleted-subscription cleanup outside the global incoming root", async () => {
    saveSystemSettings({
      ...getSystemSettings(),
      openlistBaseUrl: "http://openlist.local",
      openlistToken: "token",
      openlistIncomingPath: "/115/Anime/_incoming"
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(
        cleanupDeletedSubscriptionIncoming({
          subscriptionName: "Show",
          incomingPath: "/115/Anime",
          rules: []
        })
      ).rejects.toThrow(/outside the global incoming root/i);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
