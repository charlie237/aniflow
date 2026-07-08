import { XMLParser } from "fast-xml-parser";
import { parseReleaseTitle, type ParsedReleaseTitle } from "@/lib/rss/title-parser";

export interface ParsedRssItem {
  guid: string;
  title: string;
  link: string | null;
  downloadUrl: string | null;
  publishedAt: string | null;
  rawXmlJson: string;
  metadata: ParsedReleaseTitle;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: true
});

export function parseRss(xml: string): ParsedRssItem[] {
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const channel = getObject(getObject(parsed.rss)?.channel);
  const rssItems = toArray(channel?.item);
  const atomItems = toArray(getObject(parsed.feed)?.entry);
  const items = rssItems.length > 0 ? rssItems : atomItems;

  return items
    .map((item) => normalizeItem(getObject(item)))
    .filter((item): item is ParsedRssItem => Boolean(item));
}

function normalizeItem(item: Record<string, unknown> | null): ParsedRssItem | null {
  if (!item) return null;
  const title = textOf(item.title) ?? "Untitled release";
  const link = extractLink(item);
  const downloadUrl = extractDownloadUrl(item, link);
  const guid = textOf(item.guid) ?? textOf(item.id) ?? downloadUrl ?? link ?? title;
  const publishedAt = normalizeDate(
    textOf(item.pubDate) ?? textOf(item.published) ?? textOf(item.updated)
  );

  return {
    guid,
    title,
    link,
    downloadUrl,
    publishedAt,
    rawXmlJson: JSON.stringify(item),
    metadata: parseReleaseTitle(title)
  };
}

function extractLink(item: Record<string, unknown>) {
  const link = item.link;
  if (typeof link === "string") return link;
  if (Array.isArray(link)) {
    const first = link
      .map((entry) => getObject(entry))
      .find((entry) => entry?.["@_href"]);
    return first?.["@_href"] ? String(first["@_href"]) : null;
  }
  const linkObj = getObject(link);
  if (linkObj?.["@_href"]) return String(linkObj["@_href"]);
  return null;
}

function extractDownloadUrl(item: Record<string, unknown>, link: string | null) {
  const enclosures = toArray(item.enclosure)
    .map((entry) => getObject(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));

  for (const enclosure of enclosures) {
    const url = stringValue(enclosure["@_url"]);
    if (url && looksLikeDownloadUrl(url)) return url;
  }

  const candidates = [
    link,
    textOf(item.link),
    textOf(item.comments),
    textOf(item.description),
    textOf(item["content:encoded"])
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const magnet = candidate.match(/magnet:\?xt=urn:[^\s"'<>]+/i)?.[0];
    if (magnet) return magnet;
    const torrent = candidate.match(/https?:\/\/[^\s"'<>]+\.torrent(?:\?[^\s"'<>]*)?/i)?.[0];
    if (torrent) return torrent;
    if (looksLikeDownloadUrl(candidate)) return candidate;
  }

  return null;
}

function looksLikeDownloadUrl(value: string) {
  return (
    value.startsWith("magnet:?") ||
    /\.torrent(?:\?|$)/i.test(value) ||
    /\/RSS\/Download\//i.test(value) ||
    /mikanani\.me\/Home\/Episode/i.test(value)
  );
}

function textOf(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number") {
    return String(value).trim() || null;
  }
  const obj = getObject(value);
  if (!obj) return null;
  if (obj["#text"] != null) return String(obj["#text"]).trim() || null;
  return null;
}

function stringValue(value: unknown) {
  return value == null ? null : String(value).trim() || null;
}

function getObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toArray(value: unknown): unknown[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}
