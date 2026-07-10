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
    expect(isMikanDownloadUrl("https://example.com/episode.torrent")).toBe(false);
    expect(isMikanDownloadUrl("https://mikanani.me/Home/Episode/1")).toBe(false);
  });
});
