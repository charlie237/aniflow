import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const tempDir = mkdtempSync(join(tmpdir(), "aniflow-dl-retry-"));
const dbPath = join(tempDir, "dl-retry.sqlite");
process.env.DATABASE_PATH = dbPath;

const { getSqlite } = await import("@/lib/db/client");
const {
  archiveSubscription,
  claimQueuedJob,
  createOrUpdateJob,
  createSubscription,
  deleteSubscription,
  failStaleDownloadingJobs,
  getEpisodeFileForFeedItem,
  getJob,
  getJobForFeedItem,
  getLibraryEpisodeState,
  getSubscription,
  listSubscriptionIdsWithInFlightJobs,
  restoreSubscription,
  saveSystemSettings,
  getSystemSettings,
  upsertEpisodeFile,
  upsertFeedItem
} = await import("@/lib/db/repositories");
const {
  incomingPathForJob,
  pollAllSubscriptions,
  pollSubscription,
  reconcileDownloadingJobs,
  retryJob,
  scanAndRenameIncoming,
  submitJob,
  submitQueuedJobs,
  syncSubscriptionLibrary
} = await import("@/lib/worker/pipeline");
const { POST: retryJobApi } = await import("@/app/api/jobs/[id]/retry/route");
const { POST: confirmJobApi } = await import("@/app/api/jobs/[id]/confirm/route");
const { POST: createSubscriptionApi } = await import("@/app/api/subscriptions/route");

function seedDownloadJob(options: {
  name: string;
  sourceUrl: string;
  status: "discovered" | "needs_review" | "queued" | "downloading" | "failed";
  episodeNumber?: number;
  releaseGroup?: string;
  targetPath?: string;
  openlistTaskId?: string;
}) {
  const episodeNumber = options.episodeNumber ?? 1;
  const subscription = createSubscription({
    name: options.name,
    rssUrl: `https://example.com/${encodeURIComponent(options.name)}`,
    seasonNumber: 1,
    destinationRoot: "/115/Anime"
  });
  if (!subscription) throw new Error("Failed to seed subscription");
  const feed = upsertFeedItem(subscription, {
    guid: `${options.name}-${episodeNumber}`,
    title: `[${options.releaseGroup ?? "G"}] ${options.name} - ${String(episodeNumber).padStart(2, "0")} [1080p][CHS].mkv`,
    downloadUrl: options.sourceUrl,
    metadata: {
      releaseGroup: options.releaseGroup ?? "G",
      parsedTitle: options.name,
      episodeNumber,
      episodeText: String(episodeNumber).padStart(2, "0"),
      releaseRevision: 1,
      resolution: "1080p",
      subtitleLanguage: "CHS",
      container: "mkv",
      tags: [],
      parseConfidence: 100,
      needsReview: false
    }
  });
  const job = createOrUpdateJob({
    subscriptionId: subscription.id,
    feedItemId: feed.id,
    status: options.status,
    sourceUrl: options.sourceUrl,
    targetPath: options.targetPath,
    openlistTaskId: options.openlistTaskId
  });
  if (!job) throw new Error("Failed to seed download job");
  return { subscription, feed, job };
}

describe("download fail-stop lifecycle", () => {
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
      openlistToken: ""
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

  it("archives a subscription, pauses queued jobs, and preserves in-flight work", () => {
    const sub = createSubscription({
      name: "Finished Show",
      rssUrl: "https://example.com/rss-archive",
      seasonNumber: 1,
      destinationRoot: "/115/Anime"
    });
    if (!sub) return;

    const queuedFeed = upsertFeedItem(sub, {
      guid: "archive-queued",
      title: "[G] Finished Show - 01 [1080p][CHS].mkv",
      downloadUrl: "magnet:?xt=urn:btih:archive-queued",
      metadata: {
        releaseGroup: "G",
        parsedTitle: "Finished Show",
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
    const downloadingFeed = upsertFeedItem(sub, {
      guid: "archive-downloading",
      title: "[G] Finished Show - 02 [1080p][CHS].mkv",
      downloadUrl: "magnet:?xt=urn:btih:archive-downloading",
      metadata: {
        releaseGroup: "G",
        parsedTitle: "Finished Show",
        episodeNumber: 2,
        episodeText: "02",
        releaseRevision: 1,
        resolution: "1080p",
        subtitleLanguage: "CHS",
        container: "mkv",
        tags: [],
        parseConfidence: 80,
        needsReview: false
      }
    });
    const queued = createOrUpdateJob({
      subscriptionId: sub.id,
      feedItemId: queuedFeed.id,
      status: "queued",
      sourceUrl: "magnet:?xt=urn:btih:archive-queued"
    });
    const downloading = createOrUpdateJob({
      subscriptionId: sub.id,
      feedItemId: downloadingFeed.id,
      status: "downloading",
      sourceUrl: "magnet:?xt=urn:btih:archive-downloading"
    });
    if (!queued || !downloading) return;

    const archived = archiveSubscription(sub.id);
    expect(archived.subscription?.enabled).toBe(false);
    expect(archived.pausedJobs).toBe(1);
    expect(getJob(queued.id)?.status).toBe("discovered");
    expect(getJob(downloading.id)?.status).toBe("downloading");

    expect(restoreSubscription(sub.id)?.enabled).toBe(true);
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
    expect(getJob(job.id)?.attempts).toBe(1);

    getSqlite()
      .prepare(
        "UPDATE download_jobs SET updated_at = datetime('now', '-2 hours') WHERE id = ?"
      )
      .run(job.id);
    expect(failStaleDownloadingJobs(60)).toBe(1);
    expect(getJob(job.id)?.status).toBe("failed");
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

  it("fails a stale download without extending the timeout from task polling", async () => {
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
      expect(await reconcileDownloadingJobs()).toEqual({ checked: 1, failed: 1 });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(getJob(job.id)?.status).toBe("failed");
      expect(getJob(job.id)?.openlistTaskId).toBe("active-task");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("fails a tracked download when OpenList task lists are unavailable", async () => {
    const sub = createSubscription({
      name: "Unavailable Task State",
      rssUrl: "https://mikanani.me/RSS/Bangumi?bangumiId=8101",
      destinationRoot: "/115/Anime"
    });
    if (!sub) return;
    const feed = upsertFeedItem(sub, {
      guid: "unavailable-task-1",
      title: "[G] Unavailable Task State - 01 [1080p][CHS].mkv",
      downloadUrl: "magnet:?xt=urn:btih:unavailable",
      metadata: {
        releaseGroup: "G",
        parsedTitle: "Unavailable Task State",
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
      sourceUrl: "magnet:?xt=urn:btih:unavailable",
      openlistTaskId: "remote-task"
    });
    if (!job) return;
    getSqlite()
      .prepare(
        "UPDATE download_jobs SET attempts = 1, updated_at = datetime('now', '-2 hours') WHERE id = ?"
      )
      .run(job.id);
    saveSystemSettings({
      ...getSystemSettings(),
      openlistBaseUrl: "http://openlist.local",
      openlistToken: "token",
      downloadTimeoutMinutes: 1
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("OpenList offline")));
    try {
      expect(await reconcileDownloadingJobs()).toEqual({ checked: 1, failed: 1 });
      expect(getJob(job.id)?.status).toBe("failed");
      expect(getJob(job.id)?.errorMessage).toContain("OpenList offline");
      expect(getJob(job.id)?.openlistTaskId).toBe("remote-task");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("continues polling later subscriptions when one RSS feed fails", async () => {
    createSubscription({
      name: "A Broken Feed",
      rssUrl: "https://mikanani.me/RSS/Bangumi?bangumiId=8201",
      destinationRoot: "/115/Anime"
    });
    const healthy = createSubscription({
      name: "B Healthy Feed",
      rssUrl: "https://mikanani.me/RSS/Bangumi?bangumiId=8202",
      destinationRoot: "/115/Anime"
    });
    if (!healthy) return;

    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes("8201")) {
        return new Response("bad gateway", { status: 502 });
      }
      return new Response("<rss><channel><title>Healthy</title></channel></rss>", {
        status: 200,
        headers: { "Content-Type": "application/xml" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(pollAllSubscriptions()).rejects.toThrow(
        /Subscription poll failed: RSS fetch failed \(502\) for A Broken Feed/
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(getSubscription(healthy.id)?.lastPolledAt).not.toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("fails an active older revision instead of orphaning its remote task", async () => {
    const sub = createSubscription({
      name: "Revision Lifecycle",
      rssUrl: "https://mikanani.me/RSS/Bangumi?bangumiId=8301",
      autoDownload: false,
      seasonNumber: 1,
      destinationRoot: "/115/Anime"
    });
    if (!sub) return;

    const v1 = upsertFeedItem(sub, {
      guid: "revision-lifecycle-v1",
      title: "[G] Revision Lifecycle - 01 [1080p][CHS].mkv",
      downloadUrl: "https://mikanani.me/Download/revision-lifecycle-v1.torrent",
      metadata: {
        releaseGroup: "G",
        parsedTitle: "Revision Lifecycle",
        episodeNumber: 1,
        episodeText: "01",
        releaseRevision: 1,
        resolution: "1080p",
        subtitleLanguage: "CHS",
        container: "mkv",
        tags: [],
        parseConfidence: 100,
        needsReview: false
      }
    });
    const oldJob = createOrUpdateJob({
      subscriptionId: sub.id,
      feedItemId: v1.id,
      status: "downloading",
      sourceUrl: "https://mikanani.me/Download/revision-lifecycle-v1.torrent",
      openlistTaskId: "remote-v1"
    });
    if (!oldJob) return;
    const oldTargetPath = incomingPathForJob(oldJob.id);
    getSqlite()
      .prepare("UPDATE download_jobs SET target_path = ? WHERE id = ?")
      .run(oldTargetPath, oldJob.id);

    const xml = `<rss version="2.0"><channel>
      <item>
        <guid>revision-lifecycle-v1</guid>
        <title>[G] Revision Lifecycle - 01 [1080p][CHS].mkv</title>
        <enclosure url="https://mikanani.me/Download/revision-lifecycle-v1.torrent" type="application/x-bittorrent" />
      </item>
      <item>
        <guid>revision-lifecycle-v2</guid>
        <title>[G] Revision Lifecycle - 01v2 [1080p][CHS].mkv</title>
        <enclosure url="https://mikanani.me/Download/revision-lifecycle-v2.torrent" type="application/x-bittorrent" />
      </item>
    </channel></rss>`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(xml, { status: 200 })));
    try {
      await pollSubscription(sub.id);

      expect(getJob(oldJob.id)).toMatchObject({
        status: "failed",
        openlistTaskId: "remote-v1",
        targetPath: oldTargetPath
      });
      expect(getJob(oldJob.id)?.errorMessage).toContain(
        "remote work may still be active"
      );
      expect(getJob(oldJob.id)?.errorMessage).toContain("do not retry");

      const v2Feed = getSqlite()
        .prepare("SELECT id FROM feed_items WHERE guid = ?")
        .get("revision-lifecycle-v2") as { id: number } | undefined;
      expect(v2Feed).toBeTruthy();
      expect(v2Feed ? getJobForFeedItem(v2Feed.id)?.status : null).toBe(
        "discovered"
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not auto-complete active or failed jobs from the library index", async () => {
    const sub = createSubscription({
      name: "Library State Guard",
      rssUrl: "https://mikanani.me/RSS/Bangumi?bangumiId=8302",
      seasonNumber: 1,
      destinationRoot: "/115/Anime"
    });
    if (!sub) return;

    const statuses = [
      { episode: 1, status: "downloading" as const, errorMessage: null },
      { episode: 2, status: "failed" as const, errorMessage: "manual cleanup required" },
      { episode: 3, status: "queued" as const, errorMessage: null }
    ];
    const jobs: NonNullable<ReturnType<typeof createOrUpdateJob>>[] = [];
    for (const entry of statuses) {
      const feed = upsertFeedItem(sub, {
        guid: `library-state-${entry.episode}`,
        title: `[G] Library State Guard - ${String(entry.episode).padStart(2, "0")} [1080p][CHS].mkv`,
        downloadUrl: `https://mikanani.me/Download/library-state-${entry.episode}.torrent`,
        metadata: {
          releaseGroup: "G",
          parsedTitle: "Library State Guard",
          episodeNumber: entry.episode,
          episodeText: String(entry.episode).padStart(2, "0"),
          releaseRevision: 1,
          resolution: "1080p",
          subtitleLanguage: "CHS",
          container: "mkv",
          tags: [],
          parseConfidence: 100,
          needsReview: false
        }
      });
      const job = createOrUpdateJob({
        subscriptionId: sub.id,
        feedItemId: feed.id,
        status: entry.status,
        sourceUrl: `https://mikanani.me/Download/library-state-${entry.episode}.torrent`,
        errorMessage: entry.errorMessage
      });
      if (!job) throw new Error("Failed to seed library-state job");
      jobs.push(job);
      const finalPath = `/115/Anime/Library State Guard/Season 01/Library State Guard - S01E${String(entry.episode).padStart(2, "0")}.mkv`;
      upsertEpisodeFile({
        subscriptionId: sub.id,
        feedItemId: feed.id,
        episodeNumber: entry.episode,
        originalPath: finalPath,
        finalPath,
        status: "renamed"
      });
    }
    const activeTargetPath = incomingPathForJob(jobs[0].id);
    getSqlite()
      .prepare("UPDATE download_jobs SET target_path = ? WHERE id = ?")
      .run(activeTargetPath, jobs[0].id);

    const items = statuses
      .map(
        ({ episode }) => `<item>
          <guid>library-state-${episode}</guid>
          <title>[G] Library State Guard - ${String(episode).padStart(2, "0")} [1080p][CHS].mkv</title>
          <enclosure url="https://mikanani.me/Download/library-state-${episode}.torrent" type="application/x-bittorrent" />
        </item>`
      )
      .join("");
    const xml = `<rss version="2.0"><channel>${items}</channel></rss>`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(xml, { status: 200 })));
    try {
      await pollSubscription(sub.id);

      expect(getJob(jobs[0].id)?.status).toBe("downloading");
      expect(getJob(jobs[1].id)).toMatchObject({
        status: "failed",
        errorMessage: "manual cleanup required"
      });
      expect(getJob(jobs[2].id)).toMatchObject({
        status: "skipped",
        errorMessage: "Library episode already exists; download was not submitted"
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("indexes an existing subscription season from OpenList", async () => {
    const sub = createSubscription({
      name: "Frieren",
      rssUrl: "https://mikanani.me/RSS/Bangumi?bangumiId=8250",
      seasonNumber: 2,
      destinationRoot: "/115/Anime"
    });
    if (!sub) return;
    saveSystemSettings({
      ...getSystemSettings(),
      openlistBaseUrl: "http://openlist.local",
      openlistToken: "token"
    });

    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { path?: string };
      expect(body.path).toBe("/115/Anime/Frieren/Season 02");
      return Response.json({
        code: 200,
        data: {
          content: [1, 2, 3, 4].map((episode) => ({
            name: `Frieren - S02E${String(episode).padStart(2, "0")}.mkv`,
            size: episode * 100,
            is_dir: false
          }))
        }
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const result = await syncSubscriptionLibrary(sub.id);
      expect(result).toMatchObject({
        available: true,
        scanned: 4,
        recognized: 4,
        imported: 4
      });
      expect(getLibraryEpisodeState(sub.id, 4)).toMatchObject({
        knownRevision: null,
        fileCount: 1
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("queues only the missing episode after rebuilding a library index", async () => {
    const sub = createSubscription({
      name: "Frieren",
      rssUrl: "https://mikanani.me/RSS/Bangumi?bangumiId=8251",
      seasonNumber: 2,
      destinationRoot: "/115/Anime"
    });
    if (!sub) return;
    for (let episode = 1; episode <= 4; episode += 1) {
      const path = `/115/Anime/Frieren/Season 02/Frieren - S02E${String(episode).padStart(2, "0")}.mkv`;
      upsertEpisodeFile({
        subscriptionId: sub.id,
        episodeNumber: episode,
        originalPath: path,
        finalPath: path,
        sizeBytes: episode * 100,
        status: "renamed"
      });
    }

    const items = [1, 2, 3, 4, 5]
      .map(
        (episode) => `<item>
          <guid>frieren-s2-e${episode}</guid>
          <title>[Group] Frieren S2 - ${String(episode).padStart(2, "0")} [1080p][CHS].mkv</title>
          <enclosure url="https://mikanani.me/Download/frieren-s2-e${episode}.torrent" type="application/x-bittorrent" />
        </item>`
      )
      .join("");
    const xml = `<rss version="2.0"><channel><title>Frieren</title>${items}</channel></rss>`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(xml, {
          status: 200,
          headers: { "Content-Type": "application/xml" }
        })
      )
    );
    try {
      const result = await pollSubscription(sub.id);
      const feedRows = getSqlite()
        .prepare("SELECT id, guid FROM feed_items WHERE subscription_id = ?")
        .all(sub.id) as Array<{ id: number; guid: string }>;
      expect(result.queued).toBe(1);
      expect(feedRows).toHaveLength(5);
      for (const feedRow of feedRows) {
        const job = getJobForFeedItem(feedRow.id);
        if (feedRow.guid === "frieren-s2-e5") {
          expect(job).not.toBeNull();
        } else {
          expect(job).toBeNull();
        }
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("submits each job into its own jobs/{job-id} directory", async () => {
    const { job } = seedDownloadJob({
      name: "Owned Target",
      sourceUrl: "magnet:?xt=urn:btih:owned-target",
      status: "queued"
    });
    saveSystemSettings({
      ...getSystemSettings(),
      openlistBaseUrl: "http://openlist.local",
      openlistToken: "token",
      openlistIncomingPath: "/115/Anime/_incoming"
    });
    const targetPath = `/115/Anime/_incoming/jobs/${job.id}`;
    const requestBodies: Array<{ endpoint: string; body: Record<string, unknown> }> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const endpoint = String(input);
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      requestBodies.push({ endpoint, body });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          code: 200,
          data: endpoint.endsWith("/api/fs/list")
            ? { content: [] }
            : endpoint.endsWith("/api/fs/add_offline_download")
              ? { tasks: [{ id: "openlist-owned", error: "" }] }
              : null
        })
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      await submitJob(job);
      const submission = requestBodies.find(({ endpoint }) =>
        endpoint.endsWith("/api/fs/add_offline_download")
      );
      expect(incomingPathForJob(job.id)).toBe(targetPath);
      expect(submission?.body.path).toBe(targetPath);
      expect(getJob(job.id)).toMatchObject({
        status: "downloading",
        targetPath,
        openlistTaskId: "openlist-owned",
        attempts: 1
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps a duplicate OpenList submission failed until the user retries", async () => {
    const { job } = seedDownloadJob({
      name: "Duplicate Target",
      sourceUrl: "magnet:?xt=urn:btih:duplicate-target",
      status: "queued"
    });
    saveSystemSettings({
      ...getSystemSettings(),
      openlistBaseUrl: "http://openlist.local",
      openlistToken: "token",
      openlistIncomingPath: "/115/Anime/_incoming"
    });
    let addCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const endpoint = String(input);
      if (endpoint.endsWith("/api/fs/add_offline_download")) addCalls += 1;
      return {
        ok: true,
        status: 200,
        json: async () =>
          endpoint.endsWith("/api/fs/list")
            ? { code: 200, data: { content: [] } }
            : endpoint.endsWith("/api/fs/add_offline_download")
              ? {
                  code: 200,
                  data: {
                    tasks: [{
                      id: "duplicate-task",
                      error: "code: 10008, message: 任务已存在，请勿输入重复的链接地址"
                    }]
                  }
                }
              : { code: 200, data: null }
      };
    }));
    try {
      await submitJob(job);
      expect(getJob(job.id)?.status).toBe("failed");
      expect(getJob(job.id)?.errorMessage).toContain("10008");
      expect(getJob(job.id)?.errorMessage).toContain(incomingPathForJob(job.id));
      expect(getJob(job.id)?.openlistTaskId).toBe("duplicate-task");

      await submitQueuedJobs();
      expect(addCalls).toBe(1);
      expect(getJob(job.id)?.status).toBe("failed");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("organizes a renamed release group from the job-owned directory", async () => {
    const seeded = seedDownloadJob({
      name: "Alias Show",
      sourceUrl: "magnet:?xt=urn:btih:alias-show",
      status: "downloading",
      releaseGroup: "樱花字幕组"
    });
    const targetPath = incomingPathForJob(seeded.job.id);
    getSqlite()
      .prepare("UPDATE download_jobs SET target_path = ? WHERE id = ?")
      .run(targetPath, seeded.job.id);
    saveSystemSettings({
      ...getSystemSettings(),
      openlistBaseUrl: "http://openlist.local",
      openlistToken: "token",
      openlistIncomingPath: "/115/Anime/_incoming",
      mediaLibraryRoot: "/115/Anime",
      seasonPathTemplate: "{title}/Season {season_pad}",
      episodeFileTemplate: "{title} - S{season_pad}E{episode_pad}.{ext}"
    });
    const downloadedName = "[sakura] Alias Show - 01 [1080p][CHS].mkv";
    const requests: Array<{ endpoint: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const endpoint = String(input);
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      requests.push({ endpoint, body });
      const isJobList =
        endpoint.endsWith("/api/fs/list") && body.path === targetPath;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          code: 200,
          data: isJobList
            ? { content: [{ name: downloadedName, size: 123, is_dir: false }] }
            : { content: [] }
        })
      };
    }));
    try {
      await scanAndRenameIncoming();
      const finalPath = "/115/Anime/Alias Show/Season 01/Alias Show - S01E01.mkv";
      expect(getJob(seeded.job.id)).toMatchObject({
        status: "completed",
        targetPath: finalPath,
        errorMessage: null
      });
      expect(getEpisodeFileForFeedItem(seeded.feed.id)?.status).toBe("renamed");
      expect(
        requests.some(
          ({ endpoint, body }) =>
            endpoint.endsWith("/api/fs/move") &&
            body.src_dir === targetPath &&
            body.dst_dir === "/115/Anime/Alias Show/Season 01"
        )
      ).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("fails instead of selecting from multiple media files", async () => {
    const seeded = seedDownloadJob({
      name: "Ambiguous Show",
      sourceUrl: "magnet:?xt=urn:btih:ambiguous-show",
      status: "downloading"
    });
    const targetPath = incomingPathForJob(seeded.job.id);
    getSqlite()
      .prepare("UPDATE download_jobs SET target_path = ? WHERE id = ?")
      .run(targetPath, seeded.job.id);
    saveSystemSettings({
      ...getSystemSettings(),
      openlistBaseUrl: "http://openlist.local",
      openlistToken: "token",
      openlistIncomingPath: "/115/Anime/_incoming"
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        code: 200,
        data: {
          content: [
            { name: "Ambiguous.Show.S01E01.1080p.mkv", size: 1, is_dir: false },
            { name: "Ambiguous.Show.S01E02.1080p.mp4", size: 2, is_dir: false }
          ]
        }
      })
    })));
    try {
      await scanAndRenameIncoming();
      expect(getJob(seeded.job.id)?.status).toBe("failed");
      expect(getJob(seeded.job.id)?.errorMessage).toContain("Multiple media files");
      expect(getJob(seeded.job.id)?.errorMessage).toContain(targetPath);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("fails when the only media file is for a different episode", async () => {
    const seeded = seedDownloadJob({
      name: "Wrong Episode",
      sourceUrl: "magnet:?xt=urn:btih:wrong-episode",
      status: "downloading"
    });
    const targetPath = incomingPathForJob(seeded.job.id);
    getSqlite()
      .prepare("UPDATE download_jobs SET target_path = ? WHERE id = ?")
      .run(targetPath, seeded.job.id);
    saveSystemSettings({
      ...getSystemSettings(),
      openlistBaseUrl: "http://openlist.local",
      openlistToken: "token",
      openlistIncomingPath: "/115/Anime/_incoming"
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        code: 200,
        data: {
          content: [
            { name: "Wrong.Episode.S01E02.1080p.mkv", size: 1, is_dir: false }
          ]
        }
      })
    })));
    try {
      await scanAndRenameIncoming();
      expect(getJob(seeded.job.id)?.status).toBe("failed");
      expect(getJob(seeded.job.id)?.errorMessage).toContain(
        "does not match expected episode 1"
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects retry and confirm API calls from invalid job states", async () => {
    const seeded = seedDownloadJob({
      name: "Invalid Action State",
      sourceUrl: "magnet:?xt=urn:btih:invalid-action-state",
      status: "downloading"
    });

    const retryResponse = await retryJobApi(new Request("http://localhost"), {
      params: Promise.resolve({ id: String(seeded.job.id) })
    });
    expect(retryResponse.status).toBe(409);
    expect(await retryResponse.json()).toMatchObject({
      error: expect.stringContaining("Only failed jobs")
    });

    const confirmResponse = await confirmJobApi(new Request("http://localhost"), {
      params: Promise.resolve({ id: String(seeded.job.id) })
    });
    expect(confirmResponse.status).toBe(409);
    expect(await confirmResponse.json()).toMatchObject({
      error: expect.stringContaining("Only discovered or needs_review")
    });
    await expect(retryJob(seeded.job.id)).rejects.toThrow(/cannot be retried/i);
    expect(getJob(seeded.job.id)?.status).toBe("downloading");
  });

  it("blocks subscription deletion while a download is in flight", () => {
    const seeded = seedDownloadJob({
      name: "Deletion Guard",
      sourceUrl: "magnet:?xt=urn:btih:deletion-guard",
      status: "downloading"
    });

    expect(listSubscriptionIdsWithInFlightJobs()).toContain(
      seeded.subscription.id
    );
    expect(() => deleteSubscription(seeded.subscription.id)).toThrow(
      /download jobs are in flight/i
    );
    expect(getSubscription(seeded.subscription.id)).not.toBeNull();

    getSqlite()
      .prepare("UPDATE download_jobs SET status = 'failed' WHERE id = ?")
      .run(seeded.job.id);
    expect(listSubscriptionIdsWithInFlightJobs()).not.toContain(
      seeded.subscription.id
    );
    deleteSubscription(seeded.subscription.id);
    expect(getSubscription(seeded.subscription.id)).toBeNull();
  });

  it("rejects the removed subscription incomingPath API field", async () => {
    const response = await createSubscriptionApi(
      new Request("http://localhost/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Legacy Incoming API",
          rssUrl: "https://mikanani.me/RSS/Bangumi?bangumiId=9999",
          incomingPath: "/115/Anime/_incoming/legacy"
        })
      })
    );

    expect(response.status).toBe(400);
    expect(
      (
        getSqlite()
          .prepare("SELECT COUNT(*) AS count FROM subscriptions")
          .get() as { count: number }
      ).count
    ).toBe(0);
  });

  it("returns an API error when manual retry finds an uncleared directory", async () => {
    const seeded = seedDownloadJob({
      name: "Dirty Retry",
      sourceUrl: "magnet:?xt=urn:btih:dirty-retry",
      status: "failed",
      openlistTaskId: "old-openlist-task"
    });
    const targetPath = incomingPathForJob(seeded.job.id);
    saveSystemSettings({
      ...getSystemSettings(),
      openlistBaseUrl: "http://openlist.local",
      openlistToken: "token",
      openlistIncomingPath: "/115/Anime/_incoming"
    });
    let addCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const endpoint = String(input);
      if (endpoint.endsWith("/api/fs/add_offline_download")) addCalls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          code: 200,
          data: endpoint.endsWith("/api/fs/list")
            ? { content: [{ name: "leftover.mkv", size: 1, is_dir: false }] }
            : null
        })
      };
    }));
    try {
      const response = await retryJobApi(new Request("http://localhost"), {
        params: Promise.resolve({ id: String(seeded.job.id) })
      });
      const payload = await response.json() as { error?: string };
      expect(response.status).toBe(409);
      expect(payload.error).toContain("not empty");
      expect(addCalls).toBe(0);
      expect(getJob(seeded.job.id)).toMatchObject({
        status: "failed",
        targetPath,
        openlistTaskId: "old-openlist-task"
      });
      expect(getJob(seeded.job.id)?.errorMessage).toContain("not empty");
    } finally {
      vi.unstubAllGlobals();
    }
  });

});
