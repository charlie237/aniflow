import { describe, expect, it } from "vitest";
import { parseRss } from "@/lib/rss/parser";

describe("parseRss", () => {
  it("extracts torrent enclosure URLs", () => {
    const xml = `<?xml version="1.0"?>
      <rss version="2.0">
        <channel>
          <item>
            <title>[Group] Test Anime - 02 [1080p][CHS].mkv</title>
            <guid>episode-2</guid>
            <link>https://mikanani.me/Home/Episode/abc</link>
            <enclosure url="https://mikanani.me/Download/episode.torrent" type="application/x-bittorrent" />
            <pubDate>Tue, 07 Jul 2026 12:00:00 GMT</pubDate>
          </item>
        </channel>
      </rss>`;

    const items = parseRss(xml);

    expect(items).toHaveLength(1);
    expect(items[0]?.guid).toBe("episode-2");
    expect(items[0]?.rssGuid).toBe("episode-2");
    expect(items[0]?.downloadUrl).toBe("https://mikanani.me/Download/episode.torrent");
    expect(items[0]?.metadata.episodeNumber).toBe(2);
  });

  it("keeps RSS guid separate from the internal fallback key", () => {
    const xml = `<?xml version="1.0"?>
      <rss version="2.0">
        <channel>
          <item>
            <title>[Group] Test Anime - 03 [1080p][CHS].mkv</title>
            <link>https://mikanani.me/Home/Episode/def</link>
            <enclosure url="https://mikanani.me/Download/episode-3.torrent" type="application/x-bittorrent" />
          </item>
        </channel>
      </rss>`;

    const items = parseRss(xml);

    expect(items[0]?.rssGuid).toBeNull();
    expect(items[0]?.guid).toBe("https://mikanani.me/Download/episode-3.torrent");
  });
});
