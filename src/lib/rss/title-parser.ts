export interface ParsedReleaseTitle {
  releaseGroup: string | null;
  parsedTitle: string | null;
  episodeNumber: number | null;
  episodeText: string | null;
  resolution: string | null;
  subtitleLanguage: string | null;
  source: string | null;
  codec: string | null;
  audio: string | null;
  container: string | null;
  tags: string[];
  parseConfidence: number;
  needsReview: boolean;
}

const RESOLUTION_RE =
  /\b(2160p|1440p|1080p|720p|480p|4k|8k|3840x2160|2560x1440|1920x1080|1280x720|720x480)\b/i;
const CODEC_RE = /\b(hevc|h\.?265|x265|av1|avc|h\.?264|x264|10bit|hi10p)\b/i;
const SOURCE_RE =
  /\b(web-?dl|webrip|b-?global|baha|cr|crunchyroll|netflix|nf|bilibili|at-?x|abema|amzn|u-?next|tv|bd|bdrip|bluray)\b/i;
const AUDIO_RE = /\b(flac|aac|opus|mp3|ddp|e-?ac-?3|ac3|2\.0|5\.1|7\.1)\b/i;
const SUBTITLE_RE =
  /(chs[+&-]?cht|sc[+&-]?tc|chs|cht|ch[st]|gb|big5|sc|tc|简繁内封字幕|简繁外挂字幕|简繁内封|简繁|简日|繁日|简中|繁中|简体中文|繁體中文|简体内嵌|繁体内嵌|简体|繁体|中文字幕|内封|外挂|jpsc|jpn|eng|multi)/i;
const EPISODE_PATTERNS = [
  /\bS\d{1,2}E(?<ep>\d{1,3})(?:\b|v\d)/i,
  /第\s*(?<ep>\d{1,3})\s*(?:话|話|集|夜|回)/,
  /[\[【(（]\s*(?<ep>\d{1,3})(?:\s*v\d)?\s*[\]】)）]/i,
  /(?:^|[\s_\-\[【(（])(?<ep>\d{1,3})(?:\s*(?:v\d|END|完)?)(?:[\s_\-\]】)）]|$)/i,
  /(?:EP|E)\s*(?<ep>\d{1,3})(?:\b|v\d)/i
];

export function parseReleaseTitle(title: string): ParsedReleaseTitle {
  const normalized = normalizeTitle(title);
  const bracketTags = extractBracketTags(normalized);
  const extension = normalized.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase() ?? null;
  const releaseGroup = inferReleaseGroup(normalized, bracketTags);
  const resolution = findMatch(normalized, RESOLUTION_RE, normalizeResolution);
  const subtitleLanguage = findMatch(normalized, SUBTITLE_RE, normalizeSubtitle);
  const source = findMatch(normalized, SOURCE_RE, normalizeSource);
  const codec = findMatch(normalized, CODEC_RE, normalizeCodec);
  const audio = findMatch(normalized, AUDIO_RE, (value) => value.toUpperCase());
  const episode = inferEpisode(normalized);
  const parsedTitle = inferSeriesTitle(normalized, releaseGroup, episode.episodeText);
  const titleSegments = parsedTitle ? titleSegmentSet(parsedTitle) : new Set<string>();
  const tags = uniqueTags([
    ...bracketTags.filter(
      (tag) =>
        tag !== releaseGroup &&
        tag !== parsedTitle &&
        !titleSegments.has(tag.toLowerCase()) &&
        looksLikeTechnicalTag(tag)
    ),
    releaseGroup,
    resolution,
    subtitleLanguage,
    source,
    codec,
    audio,
    extension
  ]);
  const parseConfidence =
    (episode.episodeNumber == null ? 0 : 45) +
    (parsedTitle ? 20 : 0) +
    (resolution ? 10 : 0) +
    (releaseGroup ? 10 : 0) +
    (subtitleLanguage ? 5 : 0) +
    (source ? 5 : 0) +
    (codec ? 5 : 0);

  return {
    releaseGroup,
    parsedTitle,
    episodeNumber: episode.episodeNumber,
    episodeText: episode.episodeText,
    resolution,
    subtitleLanguage,
    source,
    codec,
    audio,
    container: extension,
    tags,
    parseConfidence,
    needsReview: episode.episodeNumber == null || parseConfidence < 45
  };
}

function normalizeTitle(title: string) {
  return title
    .replace(/\u3000/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractBracketTags(title: string) {
  const tags: string[] = [];
  const regex = /[\[【(（]([^\]】)）]{1,80})[\]】)）]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(title))) {
    const value = match[1]?.trim();
    if (value && !looksLikeEpisode(value)) tags.push(value);
  }
  return tags;
}

function inferReleaseGroup(title: string, tags: string[]) {
  const leading = title.match(/^[\[【(（]([^\]】)）]{1,60})[\]】)）]/);
  if (leading?.[1]) return leading[1].trim();
  return tags[0] ?? null;
}

function inferEpisode(title: string) {
  for (const pattern of EPISODE_PATTERNS) {
    const match = title.match(pattern);
    const value = match?.groups?.ep ?? match?.[1];
    if (!value) continue;
    const number = Number.parseInt(value, 10);
    if (Number.isFinite(number) && number >= 0 && number < 1000) {
      return {
        episodeNumber: number,
        episodeText: value.padStart(2, "0")
      };
    }
  }
  return { episodeNumber: null, episodeText: null };
}

function inferSeriesTitle(title: string, releaseGroup: string | null, episodeText: string | null) {
  let working = title;
  if (releaseGroup) {
    working = working.replace(/^[\[【(（][^\]】)）]+[\]】)）]\s*/, "");
  }
  const bracketTitle = extractBracketTags(working).find(
    (tag) => !looksLikeEpisode(tag) && !looksLikeTechnicalTag(tag)
  );
  working = working
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/【[^】]+】/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/（[^）]*）/g, " ")
    .replace(/\.(mkv|mp4|avi|mov|ts|m2ts)$/i, " ")
    .replace(/\b(2160p|1440p|1080p|720p|480p|4k|8k|3840x2160|2560x1440|1920x1080|1280x720|720x480)\b/gi, " ")
    .replace(/\b(hevc|h\.?265|x265|av1|avc|h\.?264|x264|10bit|hi10p)\b/gi, " ")
    .replace(/\b(web-?dl|webrip|b-?global|baha|cr|crunchyroll|netflix|nf|bilibili|at-?x|abema|amzn|u-?next|tv|bd|bdrip|bluray)\b/gi, " ");

  if (episodeText) {
    working = working
      .replace(new RegExp(`\\bS\\d{1,2}E${episodeText}\\b`, "i"), " ")
      .replace(new RegExp(`第\\s*0?${Number(episodeText)}\\s*(话|話|集|夜|回)`, "i"), " ")
      .replace(new RegExp(`(^|[\\s_\\-])0?${Number(episodeText)}([\\s_\\-]|$)`, "i"), " ");
  }

  const parts = working
    .split(/\s+-\s+|\s{2,}|[_|]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !looksLikeTechnicalTag(part));
  return parts[0] ?? bracketTitle ?? null;
}

function findMatch(
  title: string,
  regex: RegExp,
  normalize: (value: string) => string
) {
  const value = title.match(regex)?.[1];
  return value ? normalize(value) : null;
}

function normalizeResolution(value: string) {
  const lower = value.toLowerCase();
  if (lower === "4k" || lower === "3840x2160") return "2160p";
  if (lower === "2560x1440") return "1440p";
  if (lower === "1920x1080") return "1080p";
  if (lower === "1280x720") return "720p";
  if (lower === "720x480") return "480p";
  return lower;
}

function normalizeSubtitle(value: string) {
  const lower = value.toLowerCase();
  if (
    ["chs", "gb", "sc", "简中", "简体", "简体中文", "简体内嵌"].includes(lower)
  ) {
    return "CHS";
  }
  if (
    ["cht", "big5", "tc", "繁中", "繁体", "繁體中文", "繁体内嵌"].includes(lower)
  ) {
    return "CHT";
  }
  if (
    [
      "chst",
      "chs&cht",
      "chs+cht",
      "chs-cht",
      "sc&tc",
      "sc+tc",
      "sc-tc",
      "简繁",
      "简繁内封",
      "简繁内封字幕",
      "简繁外挂字幕"
    ].includes(lower)
  ) {
    return "CHS+CHT";
  }
  if (lower === "multi") return "MULTI";
  return value.toUpperCase();
}

function normalizeSource(value: string) {
  return value.replace(/-/g, "").toUpperCase();
}

function normalizeCodec(value: string) {
  const lower = value.toLowerCase();
  if (["h.265", "h265", "x265", "hevc"].includes(lower)) return "HEVC";
  if (["h.264", "h264", "x264", "avc"].includes(lower)) return "AVC";
  if (lower === "av1") return "AV1";
  return value.toUpperCase();
}

function looksLikeEpisode(value: string) {
  return /^\d{1,3}(?:v\d)?$/i.test(value) || /^S\d{1,2}E\d{1,3}$/i.test(value);
}

function looksLikeTechnicalTag(value: string) {
  return (
    RESOLUTION_RE.test(value) ||
    CODEC_RE.test(value) ||
    SOURCE_RE.test(value) ||
    AUDIO_RE.test(value) ||
    SUBTITLE_RE.test(value)
  );
}

function uniqueTags(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .filter((value): value is string => Boolean(value))
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
}

function titleSegmentSet(title: string) {
  return new Set(
    title
      .split(/[\/|]/)
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean)
  );
}
