import { describe, expect, it } from "vitest";
import { parseReleaseTitle } from "@/lib/rss/title-parser";
import { buildEpisodePath } from "@/lib/utils/path";

describe("parseReleaseTitle", () => {
  it("extracts group, episode and release tags from Mikan-style titles", () => {
    const parsed = parseReleaseTitle(
      "[桜都字幕组] 葬送的芙莉莲 / Sousou no Frieren - 01 [1080p][简体内嵌][HEVC].mkv"
    );

    expect(parsed.releaseGroup).toBe("桜都字幕组");
    expect(parsed.seasonNumber).toBeNull();
    expect(parsed.episodeNumber).toBe(1);
    expect(parsed.resolution).toBe("1080p");
    expect(parsed.subtitleLanguage).toBe("简体内嵌");
    expect(parsed.tags).toContain("桜都字幕组");
    expect(parsed.tags).toContain("1080p");
    expect(parsed.needsReview).toBe(false);
  });

  it("marks unknown episode titles for review", () => {
    const parsed = parseReleaseTitle("[Group] Some Anime PV [1080p].mkv");

    expect(parsed.episodeNumber).toBeNull();
    expect(parsed.needsReview).toBe(true);
  });

  it("extracts season numbers from SxxExx releases", () => {
    const parsed = parseReleaseTitle(
      "[Group] Some Anime S02E03 [1080p][CHS].mkv"
    );

    expect(parsed.parsedTitle).toBe("Some Anime");
    expect(parsed.seasonNumber).toBe(2);
    expect(parsed.episodeNumber).toBe(3);
  });

  it("extracts season numbers from Chinese and ordinal season markers", () => {
    const secondSeason = parseReleaseTitle(
      "[Group] 某某动画 第二季 - 01 [1080p][简体].mkv"
    );
    const secondCour = parseReleaseTitle(
      "[Group] 某某动画 第2期 - 02 [1080p][繁体].mkv"
    );
    const ordinalSeason = parseReleaseTitle(
      "[Group] Some Anime 3rd Season - 04 [1080p][CHS].mkv"
    );

    expect(secondSeason.parsedTitle).toBe("某某动画");
    expect(secondSeason.seasonNumber).toBe(2);
    expect(secondCour.seasonNumber).toBe(2);
    expect(ordinalSeason.parsedTitle).toBe("Some Anime");
    expect(ordinalSeason.seasonNumber).toBe(3);
  });

  it("extracts compact cour markers and roman season markers", () => {
    const compactCour = parseReleaseTitle(
      "[LoliHouse] 无职转生 3期 / Mushoku Tensei S3 - 02 [WebRip 1080p HEVC-10bit AAC][简繁内封字幕]"
    );
    const romanSeason = parseReleaseTitle(
      "[黒ネズミたち] 无职转生 Ⅲ ～到了异世界就拿出真本事～ / Mushoku Tensei III: Isekai Ittara Honki Dasu - 02 (B-Global 1920x1080 HEVC AAC MKV)"
    );

    expect(compactCour.parsedTitle).toBe("无职转生");
    expect(compactCour.seasonNumber).toBe(3);
    expect(compactCour.episodeNumber).toBe(2);
    expect(romanSeason.parsedTitle).toBe("无职转生");
    expect(romanSeason.seasonNumber).toBe(3);
    expect(romanSeason.episodeNumber).toBe(2);
  });

  it("keeps bracketed series names when they are not technical tags", () => {
    const parsed = parseReleaseTitle(
      "[ANi] [BanG Dream! Ave Mujica] [01] [1080P][Baha][WEB-DL][AAC AVC][CHT].mp4"
    );

    expect(parsed.releaseGroup).toBe("ANi");
    expect(parsed.parsedTitle).toBe("BanG Dream! Ave Mujica");
    expect(parsed.episodeNumber).toBe(1);
    expect(parsed.resolution).toBe("1080P");
    expect(parsed.subtitleLanguage).toBe("CHT");
    expect(parsed.tags).not.toContain("BanG Dream! Ave Mujica");
  });

  it("keeps common simplified and traditional subtitle labels as released", () => {
    const parsed = parseReleaseTitle(
      "[喵萌奶茶屋&LoliHouse] 某科学的超电磁炮T - 02 [WebRip 1080p HEVC-10bit AAC][简繁内封字幕].mkv"
    );

    expect(parsed.episodeNumber).toBe(2);
    expect(parsed.subtitleLanguage).toBe("简繁内封字幕");
  });

  it("extracts release revisions from episode markers", () => {
    const parsed = parseReleaseTitle(
      "[桜都字幕组] 葬送的芙莉莲 第二季 / Sousou no Frieren S2 [04v2][1080p][简体内嵌]"
    );

    expect(parsed.episodeNumber).toBe(4);
    expect(parsed.episodeText).toBe("04");
    expect(parsed.releaseRevision).toBe(2);
  });

  it("does not keep redundant technical bundles as extra tags", () => {
    const parsed = parseReleaseTitle(
      "[LoliHouse] 无职转生 3期 / Mushoku Tensei S3 - 02 [WebRip 1080p HEVC-10bit AAC][简繁内封字幕]"
    );

    expect(parsed.tags).toContain("1080p");
    expect(parsed.tags).not.toContain("WebRip 1080p HEVC-10bit AAC");
  });

  it("keeps only resolution from bundled technical tags", () => {
    const parsed = parseReleaseTitle(
      "[Group] Some Anime - 02 [WebRip 1080p HEVC-10bit AAC][CHS]"
    );

    expect(parsed.resolution).toBe("1080p");
    expect(parsed.subtitleLanguage).toBe("CHS");
  });

  it("filters by resolution and subtitle without parsing video details", () => {
    const parsed = parseReleaseTitle(
      "[三明治摆烂组] LV999的村民 / Lv999 no Murabito / LV999の村人 - 02 - [繁日内嵌][AVC 8bit 1080P]"
    );

    expect(parsed.releaseGroup).toBe("三明治摆烂组");
    expect(parsed.resolution).toBe("1080P");
    expect(parsed.subtitleLanguage).toBe("繁日内嵌");
  });

  it("keeps width by height release resolutions as released", () => {
    const parsed = parseReleaseTitle(
      "[黒ネズミたち] 女主角？圣女？都不对，我是杂役女仆（自豪）！ / Heroine? Seijo? Iie, All Works Maid desu (Hokori)! - 02 (CR 1920x1080 AVC AAC MKV)"
    );

    expect(parsed.parsedTitle).toBe(
      "女主角？圣女？都不对，我是杂役女仆 ！ / Heroine? Seijo? Iie, All Works Maid desu"
    );
    expect(parsed.episodeNumber).toBe(2);
    expect(parsed.resolution).toBe("1920x1080");
    expect(parsed.tags).toContain("1920x1080");
    expect(parsed.tags).not.toContain("自豪");
    expect(parsed.tags).not.toContain("Hokori");
  });

  it("extracts technical tags separated by underscores", () => {
    const parsed = parseReleaseTitle(
      "[千夏字幕组][葬送的芙莉莲_Sousou no Frieren][第29-38话][1080p_AVC][繁体][合集]"
    );

    expect(parsed.releaseGroup).toBe("千夏字幕组");
    expect(parsed.resolution).toBe("1080p");
    expect(parsed.subtitleLanguage).toBe("繁体");
    expect(parsed.episodeNumber).toBeNull();
    expect(parsed.needsReview).toBe(true);
  });

  it("uses the first leading wrapped token as the release group", () => {
    const parsed = parseReleaseTitle(
      "[喵萌奶茶屋][LoliHouse] 某科学的超电磁炮T - 02 [WebRip 1080p HEVC-10bit AAC][简繁内封字幕].mkv"
    );

    expect(parsed.releaseGroup).toBe("喵萌奶茶屋");
    expect(parsed.parsedTitle).toBe("某科学的超电磁炮T");
    expect(parsed.subtitleLanguage).toBe("简繁内封字幕");
  });

  it("does not merge bracketed series titles into release groups", () => {
    const parsed = parseReleaseTitle(
      "[ANi][AveMujica][01][1080P][Baha][WEB-DL][AAC AVC][CHT].mp4"
    );

    expect(parsed.releaseGroup).toBe("ANi");
    expect(parsed.parsedTitle).toBe("AveMujica");
  });

  it("splits fancy release groups and search-title hints", () => {
    const parsed = parseReleaseTitle(
      "[❀拨雪寻春❀] 送葬者芙莉莲 第二季 / 葬送のフリーレン 第二期 / Sousou no Frieren 2nd Season - 37 [WebRip][HEVC-10bit 1080p][繁日内嵌]（检索用：葬送的芙莉莲 第二季）"
    );

    expect(parsed.releaseGroup).toBe("❀拨雪寻春❀");
    expect(parsed.parsedTitle).toBe("葬送的芙莉莲");
    expect(parsed.seasonNumber).toBe(2);
    expect(parsed.episodeNumber).toBe(37);
    expect(parsed.resolution).toBe("1080p");
    expect(parsed.subtitleLanguage).toBe("繁日内嵌");
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
