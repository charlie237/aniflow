import { fetchText } from "@/lib/net/fetch";
import { parseRss, type ParsedRssItem } from "@/lib/rss/parser";

export interface RssPreview {
  url: string;
  title: string | null;
  items: ParsedRssItem[];
  groups: string[];
  resolutions: string[];
  languages: string[];
  codecs: string[];
  sources: string[];
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
  const items = parseRss(xml).slice(0, 40);

  return {
    url,
    title: inferFeedTitle(items),
    items,
    groups: unique(items.map((item) => item.metadata.releaseGroup)),
    resolutions: unique(items.map((item) => item.metadata.resolution)),
    languages: unique(items.map((item) => item.metadata.subtitleLanguage)),
    codecs: unique(items.map((item) => item.metadata.codec)),
    sources: unique(items.map((item) => item.metadata.source))
  };
}

function inferFeedTitle(items: ParsedRssItem[]) {
  const titles = items
    .map((item) => item.metadata.parsedTitle)
    .filter((value): value is string => Boolean(value));
  return titles[0] ?? null;
}

function unique(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.filter((value): value is string => Boolean(value)))
  ).sort((a, b) => a.localeCompare(b));
}
