import { describe, expect, it } from "vitest";
import type { FilterRule, Subscription } from "@/lib/db/types";
import { parseReleaseTitle } from "@/lib/rss/title-parser";
import {
  MIN_TRACKED_JOB_MATCH_SCORE,
  pickBestIncomingSubscriptionMatch,
  scoreIncomingSubscriptionMatch,
  scoreTrackedJobIdentity
} from "@/lib/worker/match";

function subscription(partial: Partial<Subscription> & { id: number; name: string }): Subscription {
  return {
    rssUrl: "https://example.com/rss",
    enabled: true,
    autoDownload: true,
    seasonNumber: 1,
    destinationRoot: "/115/Anime",
    incomingPath: null,
    tmdbSeriesId: null,
    lastPolledAt: null,
    createdAt: "",
    updatedAt: "",
    ...partial
  };
}

describe("scoreIncomingSubscriptionMatch", () => {
  it("matches when filename contains the subscription name", () => {
    const parsed = parseReleaseTitle(
      "[桜都字幕组] 葬送的芙莉莲 - 01 [1080p][简体内嵌].mkv"
    );
    const result = scoreIncomingSubscriptionMatch({
      subscription: subscription({ id: 1, name: "葬送的芙莉莲" }),
      filename: "[桜都字幕组] 葬送的芙莉莲 - 01 [1080p][简体内嵌].mkv",
      parsed,
      rules: []
    });

    expect(result.score).toBeGreaterThanOrEqual(100);
  });

  it("does not accept episode-number-only metadata matches", () => {
    const parsed = parseReleaseTitle("[Group] Completely Different Show - 05 [1080p][CHS].mkv");
    const result = scoreIncomingSubscriptionMatch({
      subscription: subscription({ id: 1, name: "Other Anime" }),
      filename: "[Group] Completely Different Show - 05 [1080p][CHS].mkv",
      parsed,
      rules: [],
      knownMetadata: [
        {
          episodeNumber: 5,
          releaseGroup: "OtherGroup",
          resolution: "720p",
          subtitleLanguage: "CHS",
          parsedTitle: "Other Anime"
        }
      ]
    });

    expect(result.score).toBe(0);
  });

  it("scores known release group + episode without relying on title alone", () => {
    const parsed = parseReleaseTitle("[桜都字幕组] Some Title - 05 [1080p][简体].mkv");
    const result = scoreIncomingSubscriptionMatch({
      subscription: subscription({ id: 1, name: "Some Title" }),
      filename: "[桜都字幕组] Some Title - 05 [1080p][简体].mkv",
      parsed,
      rules: [],
      knownMetadata: [
        {
          episodeNumber: 5,
          releaseGroup: "桜都字幕组",
          resolution: "1080p",
          subtitleLanguage: "简体",
          parsedTitle: "Some Title"
        }
      ]
    });

    expect(result.score).toBeGreaterThanOrEqual(50);
  });

  it("rejects when group_allow rules do not match", () => {
    const parsed = parseReleaseTitle("[WrongGroup] 葬送的芙莉莲 - 01 [1080p][CHS].mkv");
    const rules: FilterRule[] = [
      {
        id: 1,
        subscriptionId: 1,
        type: "group_allow",
        value: "桜都字幕组",
        enabled: true,
        createdAt: ""
      }
    ];
    const result = scoreIncomingSubscriptionMatch({
      subscription: subscription({ id: 1, name: "葬送的芙莉莲" }),
      filename: "[WrongGroup] 葬送的芙莉莲 - 01 [1080p][CHS].mkv",
      parsed,
      rules
    });

    expect(result.score).toBe(0);
    expect(result.reasons.length).toBeGreaterThan(0);
  });
});

describe("pickBestIncomingSubscriptionMatch", () => {
  it("returns null when only weak candidates exist", () => {
    const picked = pickBestIncomingSubscriptionMatch([
      {
        subscription: subscription({ id: 1, name: "A" }),
        score: 20,
        reasons: []
      }
    ]);
    expect(picked).toBeNull();
  });

  it("returns null when top scores are tied (ambiguous)", () => {
    const picked = pickBestIncomingSubscriptionMatch([
      {
        subscription: subscription({ id: 1, name: "A" }),
        score: 100,
        reasons: []
      },
      {
        subscription: subscription({ id: 2, name: "B" }),
        score: 100,
        reasons: []
      }
    ]);
    expect(picked).toBeNull();
  });

  it("returns the unique highest scorer", () => {
    const winner = subscription({ id: 2, name: "Winner" });
    const picked = pickBestIncomingSubscriptionMatch([
      {
        subscription: subscription({ id: 1, name: "Loser" }),
        score: 50,
        reasons: []
      },
      {
        subscription: winner,
        score: 100,
        reasons: []
      }
    ]);
    expect(picked?.id).toBe(2);
  });
});

describe("scoreTrackedJobIdentity", () => {
  it("rejects hard release-group mismatch without title evidence", () => {
    const score = scoreTrackedJobIdentity({
      subscriptionName: "Frieren",
      feedTitle: "[GroupA] Frieren - 05 [1080p]",
      metadata: {
        releaseGroup: "GroupA",
        parsedTitle: "Frieren",
        resolution: "1080p",
        subtitleLanguage: "CHS",
        releaseRevision: 1
      },
      filename: "[GroupB] Completely Unrelated Anime - 05 [1080p].mkv",
      parsed: {
        releaseGroup: "GroupB",
        parsedTitle: "Completely Unrelated Anime",
        resolution: "1080p",
        subtitleLanguage: "CHS",
        releaseRevision: 1
      }
    });
    expect(score).toBe(0);
  });


  it("allows RSS Chinese group vs file romaji group when multi-token title matches", () => {
    const filename =
      "[smzase] LV999 no Murabito - S01E04 - [CHS_JPN][WebRip H264 8bit 1080P].mp4";
    const parsed = parseReleaseTitle(filename);
    const score = scoreTrackedJobIdentity({
      subscriptionName: "LV999的村民",
      feedTitle:
        "[三明治摆烂组] LV999的村民 / Lv999 no Murabito / LV999の村人 - 04 - [简日内嵌][AVC 8bit 1080P]",
      metadata: {
        releaseGroup: "三明治摆烂组",
        parsedTitle: "LV999的村民 / Lv999 no Murabito / LV999の村人",
        resolution: "1080P",
        subtitleLanguage: "简日内嵌",
        releaseRevision: 1
      },
      filename,
      parsed
    });
    expect(score).toBeGreaterThanOrEqual(MIN_TRACKED_JOB_MATCH_SCORE);
  });

  it("rejects group mismatch when only a weak shared token matches", () => {
    // Codex P1: "anime" alone must not archive Other Anime under The Anime / GroupA.
    const score = scoreTrackedJobIdentity({
      subscriptionName: "The Anime",
      feedTitle: "[GroupA] The Anime - 05 [1080p]",
      metadata: {
        releaseGroup: "GroupA",
        parsedTitle: "The Anime",
        resolution: "1080p",
        subtitleLanguage: "CHS",
        releaseRevision: 1
      },
      filename: "[GroupB] Other Anime - 05 [1080p].mkv",
      parsed: {
        releaseGroup: "GroupB",
        parsedTitle: "Other Anime",
        resolution: "1080p",
        subtitleLanguage: "CHS",
        releaseRevision: 1
      }
    });
    expect(score).toBe(0);
  });


  it("scores strongly when group and subscription name match", () => {
    const score = scoreTrackedJobIdentity({
      subscriptionName: "Show A",
      feedTitle: "[GroupA] Show A - 05 [1080p][CHS]",
      metadata: {
        releaseGroup: "GroupA",
        parsedTitle: "Show A",
        resolution: "1080p",
        subtitleLanguage: "CHS",
        releaseRevision: 1
      },
      filename: "[GroupA] Show A - 05 [1080p][CHS].mkv",
      parsed: {
        releaseGroup: "GroupA",
        parsedTitle: "Show A",
        resolution: "1080p",
        subtitleLanguage: "CHS",
        releaseRevision: 1
      }
    });
    expect(score).toBeGreaterThanOrEqual(MIN_TRACKED_JOB_MATCH_SCORE);
  });

  it("does not accept episode-only identity under the threshold", () => {
    const score = scoreTrackedJobIdentity({
      subscriptionName: "Completely Different",
      feedTitle: "[Other] Other Show - 05",
      metadata: {
        releaseGroup: "Other",
        parsedTitle: "Other Show",
        resolution: "720p",
        subtitleLanguage: "JPN",
        releaseRevision: 1
      },
      filename: "random-file-05.mkv",
      parsed: {
        releaseGroup: null,
        parsedTitle: null,
        resolution: null,
        subtitleLanguage: null,
        releaseRevision: 1
      }
    });
    expect(score).toBeLessThan(MIN_TRACKED_JOB_MATCH_SCORE);
  });

  it("disambiguates same-group same-episode jobs via English feed title tokens", () => {
    const filename =
      "[LoliHouse] Mushoku Tensei S3 - 03 [WebRip 1080p HEVC-10bit AAC SRTx2].mkv";
    const parsed = parseReleaseTitle(filename);
    const mushoku = scoreTrackedJobIdentity({
      subscriptionName: "无职转生",
      feedTitle:
        "[LoliHouse] 无职转生 3期 / Mushoku Tensei S3 - 03 [WebRip 1080p HEVC-10bit AAC][简繁内封字幕]",
      metadata: {
        releaseGroup: "LoliHouse",
        parsedTitle: "无职转生",
        resolution: "1080p",
        subtitleLanguage: "简繁内封字幕",
        releaseRevision: 1
      },
      filename,
      parsed
    });
    const magi = scoreTrackedJobIdentity({
      subscriptionName: "魔法光源股份有限公司",
      feedTitle:
        "[LoliHouse] 柔光魔女股份有限公司 第二季 / Kabushikigaisha Magi-Lumière 2nd Season - 03 [WebRip 1080p]",
      metadata: {
        releaseGroup: "LoliHouse",
        parsedTitle: "柔光魔女股份有限公司",
        resolution: "1080p",
        subtitleLanguage: "简繁内封字幕",
        releaseRevision: 1
      },
      filename,
      parsed
    });

    expect(mushoku).toBeGreaterThan(magi);
    expect(mushoku).toBeGreaterThanOrEqual(MIN_TRACKED_JOB_MATCH_SCORE);
  });
});

