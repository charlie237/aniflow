import { describe, expect, it } from "vitest";
import { parseReleaseTitle } from "@/lib/rss/title-parser";
import { buildEpisodePath } from "@/lib/utils/path";

describe("parseReleaseTitle", () => {
  it("extracts group, episode and release tags from Mikan-style titles", () => {
    const parsed = parseReleaseTitle(
      "[桜都字幕组] 葬送的芙莉莲 / Sousou no Frieren - 01 [1080p][简体内嵌][HEVC].mkv"
    );

    expect(parsed.releaseGroup).toBe("桜都字幕组");
    expect(parsed.episodeNumber).toBe(1);
    expect(parsed.resolution).toBe("1080p");
    expect(parsed.subtitleLanguage).toBe("CHS");
    expect(parsed.codec).toBe("HEVC");
    expect(parsed.tags).toContain("桜都字幕组");
    expect(parsed.tags).toContain("1080p");
    expect(parsed.needsReview).toBe(false);
  });

  it("marks unknown episode titles for review", () => {
    const parsed = parseReleaseTitle("[Group] Some Anime PV [1080p].mkv");

    expect(parsed.episodeNumber).toBeNull();
    expect(parsed.needsReview).toBe(true);
  });

  it("keeps bracketed series names when they are not technical tags", () => {
    const parsed = parseReleaseTitle(
      "[ANi] [BanG Dream! Ave Mujica] [01] [1080P][Baha][WEB-DL][AAC AVC][CHT].mp4"
    );

    expect(parsed.releaseGroup).toBe("ANi");
    expect(parsed.parsedTitle).toBe("BanG Dream! Ave Mujica");
    expect(parsed.episodeNumber).toBe(1);
    expect(parsed.resolution).toBe("1080p");
    expect(parsed.subtitleLanguage).toBe("CHT");
    expect(parsed.tags).not.toContain("BanG Dream! Ave Mujica");
  });

  it("normalizes common simplified and traditional subtitle labels", () => {
    const parsed = parseReleaseTitle(
      "[喵萌奶茶屋&LoliHouse] 某科学的超电磁炮T - 02 [WebRip 1080p HEVC-10bit AAC][简繁内封字幕].mkv"
    );

    expect(parsed.episodeNumber).toBe(2);
    expect(parsed.source).toBe("WEBRIP");
    expect(parsed.codec).toBe("HEVC");
    expect(parsed.subtitleLanguage).toBe("CHS+CHT");
  });

  it("normalizes width by height release resolutions", () => {
    const parsed = parseReleaseTitle(
      "[黒ネズミたち] 女主角？圣女？都不对，我是杂役女仆（自豪）！ / Heroine? Seijo? Iie, All Works Maid desu (Hokori)! - 02 (CR 1920x1080 AVC AAC MKV)"
    );

    expect(parsed.parsedTitle).toBe(
      "女主角？圣女？都不对，我是杂役女仆 ！ / Heroine? Seijo? Iie, All Works Maid desu"
    );
    expect(parsed.episodeNumber).toBe(2);
    expect(parsed.resolution).toBe("1080p");
    expect(parsed.source).toBe("CR");
    expect(parsed.tags).toContain("1080p");
    expect(parsed.tags).not.toContain("自豪");
    expect(parsed.tags).not.toContain("Hokori");
  });
});

describe("buildEpisodePath", () => {
  it("builds Plex/Jellyfin style paths without release tags", () => {
    const path = buildEpisodePath({
      destinationRoot: "/Anime",
      subscriptionName: "葬送的芙莉莲",
      seasonNumber: 1,
      episodeNumber: 3,
      extension: "mkv"
    });

    expect(path).toBe("/Anime/葬送的芙莉莲/Season 01/葬送的芙莉莲 - S01E03.mkv");
  });

  it("builds paths from naming templates", () => {
    const path = buildEpisodePath({
      destinationRoot: "/Media",
      subscriptionName: "Show: Name",
      seasonNumber: 2,
      episodeNumber: 12,
      extension: "mkv",
      seasonPathTemplate: "{title}/S{season_pad}",
      episodeFileTemplate: "{title}.{season_pad}x{episode_pad}.{ext}"
    });

    expect(path).toBe("/Media/Show Name/S02/Show Name.02x12.mkv");
  });
});
