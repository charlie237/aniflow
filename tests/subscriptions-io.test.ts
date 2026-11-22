import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const tempDir = mkdtempSync(join(tmpdir(), "aniflow-subs-io-"));
process.env.DATABASE_PATH = join(tempDir, "subs-io.sqlite");

const { getSqlite } = await import("@/lib/db/client");
const {
  addRule,
  createSubscription,
  listRules,
  listSubscriptions
} = await import("@/lib/db/repositories");
const {
  exportSubscriptionsPayload,
  importSubscriptionsPayload
} = await import("@/lib/subscriptions-io");

describe("subscriptions JSON export/import", () => {
  beforeAll(() => {
    getSqlite();
  });

  beforeEach(() => {
    getSqlite().exec(`
      DELETE FROM filter_rules;
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

  it("round-trips subscriptions, offset/startEpisode, and filter rules while skipping duplicates", () => {
    const sub = createSubscription({
      name: "Frieren",
      rssUrl: "https://mikanani.me/RSS/Bangumi?bangumiId=3980",
      seasonNumber: 2,
      episodeOffset: -24,
      startEpisode: 3,
      destinationRoot: "/115/Anime/Seasonal"
    });
    if (!sub) return;
    addRule(sub.id, "group_allow", "LoliHouse");
    addRule(sub.id, "keyword_exclude", "合集");

    const exported = exportSubscriptionsPayload();
    expect(exported.version).toBe(1);
    expect(exported.subscriptions).toHaveLength(1);
    expect(exported.subscriptions[0]).toMatchObject({
      name: "Frieren",
      seasonNumber: 2,
      episodeOffset: -24,
      startEpisode: 3,
      destinationRoot: "/115/Anime/Seasonal"
    });
    expect(exported.subscriptions[0]?.rules).toHaveLength(2);

    // Clear DB and re-import
    getSqlite().exec("DELETE FROM filter_rules; DELETE FROM subscriptions;");
    expect(importSubscriptionsPayload(exported)).toEqual({
      imported: 1,
      skipped: 0
    });
    // Importing again skips duplicate RSS URLs
    expect(importSubscriptionsPayload(exported)).toEqual({
      imported: 0,
      skipped: 1
    });

    const restored = listSubscriptions();
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({
      name: "Frieren",
      episodeOffset: -24,
      startEpisode: 3,
      destinationRoot: "/115/Anime/Seasonal"
    });
    expect(listRules(restored[0]!.id)).toHaveLength(2);
  });

  it("rejects backups containing non-Mikan RSS URLs", () => {
    expect(() =>
      importSubscriptionsPayload({
        version: 1,
        subscriptions: [
          {
            name: "Invalid",
            rssUrl: "http://127.0.0.1/internal.xml",
            rules: []
          }
        ]
      })
    ).toThrow(/Only mikanani\.me\/RSS\//i);
  });
});
