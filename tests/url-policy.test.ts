import { describe, expect, it } from "vitest";
import {
  isMikanDownloadUrl,
  isMikanRssUrl
} from "@/lib/net/url-policy";

describe("Mikan URL policy", () => {
  it("accepts only HTTPS Mikan RSS paths", () => {
    expect(
      isMikanRssUrl("https://mikanani.me/RSS/Bangumi?bangumiId=3980")
    ).toBe(true);
    expect(isMikanRssUrl("https://www.mikanani.me/RSS/Bangumi?id=1")).toBe(
      true
    );
    expect(isMikanRssUrl("http://mikanani.me/RSS/Bangumi?id=1")).toBe(false);
    expect(isMikanRssUrl("https://mikanani.me/Home/Episode/1")).toBe(false);
    expect(isMikanRssUrl("https://example.com/RSS/Bangumi?id=1")).toBe(false);
  });

  it("accepts only HTTPS Mikan torrent download paths", () => {
    expect(isMikanDownloadUrl("https://mikanani.me/Download/episode.torrent")).toBe(
      true
    );
    expect(
      isMikanDownloadUrl("https://mikanani.me/RSS/Download/episode.torrent")
    ).toBe(true);
    expect(isMikanDownloadUrl("https://mikanime.tv/Download/episode.torrent")).toBe(
      true
    );
    expect(isMikanDownloadUrl("https://example.com/episode.torrent")).toBe(false);
    expect(isMikanDownloadUrl("https://mikanani.me/Home/Episode/1")).toBe(false);
  });

  it("supports mikanime.tv and MIKAN_ALLOWED_HOSTS mirrors", () => {
    expect(isMikanRssUrl("https://mikanime.tv/RSS/Bangumi?bangumiId=3980")).toBe(
      true
    );
    const previous = process.env.MIKAN_ALLOWED_HOSTS;
    process.env.MIKAN_ALLOWED_HOSTS = "mikan.mirror.example";
    try {
      expect(
        isMikanRssUrl("https://mikan.mirror.example/RSS/Bangumi?bangumiId=1")
      ).toBe(true);
      expect(
        isMikanDownloadUrl("https://mikan.mirror.example/Download/ep.torrent")
      ).toBe(true);
      expect(
        isMikanRssUrl("https://evil.example/RSS/Bangumi?bangumiId=1")
      ).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.MIKAN_ALLOWED_HOSTS;
      else process.env.MIKAN_ALLOWED_HOSTS = previous;
    }
  });
});
