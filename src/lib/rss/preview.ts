import { fetchText } from "@/lib/net/fetch";
import { parseRssFeed, type ParsedRssItem } from "@/lib/rss/parser";
import { parseReleaseTitle, type ParsedReleaseTitle } from "@/lib/rss/title-parser";

export interface RssPreview {
  url: string;
  title: string | null;
  items: ParsedRssItem[];
  seasons: number[];
  groups: string[];
  resolutions: string[];
  languages: string[];
}

export async function fetchRssPreview(url: string): Promise<RssPreview> {
  const response = await fetchText(url, {
    headers: {
      "User-Agent": "Aniflow/0.1 RSS preview"
    }
  });

  if (!response.ok) {
    throw new Error(`RSS fetch failed: ${response.status}`);
  }

  const xml = response.body;
  const feed = parseRssFeed(xml);
  const items = feed.items;
  const feedMetadata = feed.title
    ? parseReleaseTitle(normalizeFeedTitle(feed.title))
    : null;

  return {
    url,
    title: inferFeedTitle(feed.title, feedMetadata),
    items,
    seasons: uniqueNumbers([feedMetadata?.seasonNumber]),
    groups: unique(items.map((item) => item.metadata.releaseGroup)),
    resolutions: unique(items.map((item) => item.metadata.resolution)),
    languages: unique(items.map((item) => item.metadata.subtitleLanguage))
  };
}

function inferFeedTitle(
  feedTitle: string | null,
  feedMetadata: ParsedReleaseTitle | null
) {
  const normalized = feedTitle ? normalizeFeedTitle(feedTitle) : null;
  return feedMetadata?.parsedTitle ?? normalized;
}

function unique(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.filter((value): value is string => Boolean(value)))
  ).sort(compareStable);
}

function uniqueNumbers(values: Array<number | null | undefined>) {
  return Array.from(
    new Set(values.filter((value): value is number => Number.isFinite(value)))
  ).sort((a, b) => a - b);
}

function normalizeFeedTitle(title: string) {
  return title.replace(/^Mikan Project\s*-\s*/i, "").trim();
}

function compareStable(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}
