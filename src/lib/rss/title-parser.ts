export interface ParsedReleaseTitle {
  releaseGroup: string | null;
  parsedTitle: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  episodeText: string | null;
  releaseRevision: number;
  resolution: string | null;
  subtitleLanguage: string | null;
  container: string | null;
  tags: string[];
  parseConfidence: number;
  needsReview: boolean;
}

const RESOLUTION_RE =
  /(?:^|[^A-Za-z0-9])(2160p|1440p|1080p|720p|480p|4k|8k|3840x2160|2560x1440|1920x1080|1280x720|720x480)(?=$|[^A-Za-z0-9])/i;
const CODEC_RE =
  /(?:^|[^A-Za-z0-9])(hevc|h\.?265|x265|av1|avc|h\.?264|x264)(?=$|[^A-Za-z0-9])/i;
const BIT_DEPTH_RE =
  /(?:^|[^A-Za-z0-9])(8bit|10bit|12bit|hi10p)(?=$|[^A-Za-z0-9])/i;
const SOURCE_RE =
  /(?:^|[^A-Za-z0-9])(web-?dl|webrip|b-?global|baha|cr|crunchyroll|netflix|nf|bilibili|at-?x|abema|amzn|u-?next|tv|bd|bdrip|bluray)(?=$|[^A-Za-z0-9])/i;
const AUDIO_RE =
  /(?:^|[^A-Za-z0-9])(flac|aac|opus|mp3|ddp|e-?ac-?3|ac3|2\.0|5\.1|7\.1)(?=$|[^A-Za-z0-9])/i;
// Short Latin codes need boundaries so "tc" in CATCHPLAY is not a subtitle hit.
const SUBTITLE_RE =
  /(?:^|[^A-Za-z0-9])(chs[+&/_-]?(?:cht|tc|jpn|jp)?|sc[+&/_-]?tc|cht[+&/_-]?(?:jpn|jp)?|ch[st]|big5|gb|jpsc|jpn|jp|eng|multi)(?=$|[^A-Za-z0-9])|(简繁(?:日内封|内封|外挂|内嵌)?(?:字幕)?|简日(?:双语|雙語|内嵌|内封|外挂|字幕)?|繁日(?:双语|雙語|内嵌|内封|外挂|字幕)?|中日(?:双语|雙語)?|日简(?:双语|雙語)?|日繁(?:双语|雙語)?|简体(?:中文|内嵌|内封|外挂|字幕)?|繁体(?:中文|内嵌|内封|外挂|字幕)?|繁體(?:中文|內嵌|內封|外掛|字幕)?|简中|繁中|中文字幕|简繁日内封字幕|简繁内封字幕)/i;
const SEASON_PATTERNS = [
  /\bS(?<season>\d{1,2})E\d{1,3}(?:\b|v\d)/i,
  /\bS(?<season>\d{1,2})\s*[-_. ]+\s*\d{1,3}\b/i,
  /\bSeason\s*(?<season>\d{1,2})\b/i,
  /\b(?<season>\d{1,2})(?:st|nd|rd|th)\s+Season\b/i,
  /第\s*(?<season>\d{1,2}|[一二三四五六七八九十两]+)\s*(?:季|期|部)/,
  /(?<!\d)(?<season>\d{1,2})\s*(?:季|期|部)/,
  /(?:^|[\s/：:~～-])(?<season>ⅰ|ⅱ|ⅲ|ⅳ|ⅴ|Ⅰ|Ⅱ|Ⅲ|Ⅳ|Ⅴ|I|II|III|IV|V)(?=$|[\s/：:~～-])/i
];
const EPISODE_PATTERNS = [
  // Allow S01E04, S01E04v2, S01E04.v2, S01E04_v2
  /\bS\d{1,2}E(?<ep>\d{1,3})(?:\s*[._\-]?\s*v\d{1,2}\b|(?=$|[^A-Za-z0-9]))/i,
  // 第04话 / 第04话v2 / 第04话 v2
  /第\s*(?<ep>\d{1,3})\s*(?:话|話|集|夜|回)(?:\s*v\d{1,2}\b)?/i,
  /[\[【(（]\s*(?<ep>\d{1,3})(?:\s*v\d{1,2})?\s*[\]】)）]/i,
  /(?:^|[\s_\-\[【(（])(?<ep>\d{1,3})(?:\s*(?:v\d{1,2}|END|完)?)(?:[\s_\-\]】)）]|$)/i,
  /(?:EP|E)\s*(?<ep>\d{1,3})(?:\s*[._\-]?\s*v\d{1,2}\b|(?=$|[^A-Za-z0-9]))/i
];

export function parseReleaseTitle(title: string): ParsedReleaseTitle {
  const normalized = normalizeTitle(title);
  const bracketTags = extractBracketTags(normalized);
  const extension = normalized.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase() ?? null;
  const releaseGroup = inferReleaseGroup(normalized, bracketTags);
  const resolution = findMatch(normalized, RESOLUTION_RE, keepOriginal);
  const subtitleLanguage = inferSubtitleLanguage(normalized, bracketTags);
  const seasonNumber = inferSeason(normalized);
  const episode = inferEpisode(normalized);
  const searchTitle = extractSearchTitle(normalized);
  const parsedTitle = searchTitle
    ? cleanSeriesTitle(searchTitle, seasonNumber)
    : inferSeriesTitle(
        normalized,
        releaseGroup,
        episode.episodeText,
        seasonNumber
      );
  const titleSegments = parsedTitle ? titleSegmentSet(parsedTitle) : new Set<string>();
  const tags = uniqueTags([
    ...bracketTags.filter(
      (tag) =>
        tag !== releaseGroup &&
        tag !== parsedTitle &&
        !titleSegments.has(tag.toLowerCase()) &&
        looksLikeTechnicalTag(tag) &&
        !isRedundantTechnicalTag(tag, {
          resolution,
          subtitleLanguage
        })
    ),
    releaseGroup,
    resolution,
    subtitleLanguage,
    extension
  ]);
  const parseConfidence =
    (episode.episodeNumber == null ? 0 : 45) +
    (parsedTitle ? 20 : 0) +
    (resolution ? 10 : 0) +
    (releaseGroup ? 10 : 0) +
    (subtitleLanguage ? 5 : 0);

  return {
    releaseGroup,
    parsedTitle,
    seasonNumber,
    episodeNumber: episode.episodeNumber,
    episodeText: episode.episodeText,
    releaseRevision: episode.releaseRevision,
    resolution,
    subtitleLanguage,
    container: extension,
    tags,
    parseConfidence,
    needsReview: episode.episodeNumber == null
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
  const leading = extractLeadingWrappedValue(title);
  if (leading && !looksLikeEpisode(leading) && !looksLikeTechnicalTag(leading)) {
    return leading;
  }

  const prefix = title.match(/^(?<group>[A-Za-z0-9][A-Za-z0-9._&+-]{1,40})\s+-\s+/);
  if (prefix?.groups?.group) {
    return prefix.groups.group.trim();
  }

  return tags[0] && !looksLikeTechnicalTag(tags[0]) ? tags[0] : null;
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
        episodeText: value.padStart(2, "0"),
        releaseRevision: inferReleaseRevisionFromTitle(title, {
          episodeNumber: number,
          episodeMatch: match?.[0] ?? ""
        })
      };
    }
  }
  return { episodeNumber: null, episodeText: null, releaseRevision: 1 };
}

/**
 * Resolve release revision (v2/v3/…) from a full title.
 * Accepts markers attached to the episode, standalone tags like [v2], and dotted forms (S01E04.v2).
 */
export function inferReleaseRevisionFromTitle(
  title: string,
  context?: { episodeNumber?: number | null; episodeMatch?: string }
) {
  const candidates: number[] = [];

  /** Text that may contain a "vN" marker (e.g. episode match "04v2"). */
  const pushMarked = (value: string | undefined) => {
    const revision = parseRevisionNumber(value?.match(/v\s*(\d{1,2})/i)?.[1]);
    if (revision > 1) candidates.push(revision);
  };

  /** Capture group that is already just the revision digits. */
  const pushDigits = (value: string | undefined) => {
    const revision = parseRevisionNumber(value);
    if (revision > 1) candidates.push(revision);
  };

  pushMarked(context?.episodeMatch);
  pushDigits(title.match(/[\[【(（]\s*v\s*(\d{1,2})\s*[\]】)）]/i)?.[1]);
  pushDigits(title.match(/\bS\d{1,2}E\d{1,3}\s*[._\-]?\s*v\s*(\d{1,2})\b/i)?.[1]);
  pushDigits(
    title.match(/(?:^|[^A-Za-z0-9])(?:EP|E)\s*\d{1,3}\s*[._\-]?\s*v\s*(\d{1,2})\b/i)?.[1]
  );
  pushDigits(
    title.match(/第\s*\d{1,3}\s*(?:话|話|集|夜|回)\s*[._\-]?\s*v\s*(\d{1,2})\b/i)?.[1]
  );

  const episodeNumber = context?.episodeNumber;
  if (episodeNumber != null && Number.isFinite(episodeNumber)) {
    const ep = String(episodeNumber);
    const epPad = ep.padStart(2, "0");
    // 04v2 / 04.v2 / 04_v2 / 04 v2 — require non-alnum boundary before the number
    const adjacent = title.match(
      new RegExp(
        `(?:^|[^A-Za-z0-9])(?:0?${ep}|${epPad})\\s*[._\\-]?\\s*v\\s*(\\d{1,2})\\b`,
        "i"
      )
    );
    pushDigits(adjacent?.[1]);
  }

  // Loose " v2 " / trailing marker when nothing more specific matched.
  if (candidates.length === 0) {
    pushDigits(title.match(/(?:^|[\s_\-\[【(（])v\s*(\d{1,2})\b/i)?.[1]);
  }

  return candidates.length > 0 ? Math.max(...candidates) : 1;
}

function parseRevisionNumber(value: string | undefined) {
  if (!value) return 1;
  const revision = Number.parseInt(value.trim(), 10);
  return Number.isFinite(revision) && revision > 1 ? revision : 1;
}

function inferSeason(title: string) {
  for (const pattern of SEASON_PATTERNS) {
    const match = title.match(pattern);
    const value = match?.groups?.season ?? match?.[1];
    const number = parseSeasonNumber(value);
    if (number != null) return number;
  }
  return null;
}

function inferSeriesTitle(
  title: string,
  releaseGroup: string | null,
  episodeText: string | null,
  seasonNumber: number | null
) {
  let working = title;
  if (releaseGroup) {
    working = working.replace(/^[\[【(（][^\]】)）]+[\]】)）]\s*/, "");
  }
  const bracketTitle = extractBracketTags(working).find(
    (tag) => !looksLikeEpisode(tag) && !looksLikeTechnicalTag(tag)
  );
  working = stripSeasonMarkers(
    working
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/【[^】]+】/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/（[^）]*）/g, " ")
    .replace(/\.(mkv|mp4|avi|mov|ts|m2ts)$/i, " ")
    .replace(/\b(2160p|1440p|1080p|720p|480p|4k|8k|3840x2160|2560x1440|1920x1080|1280x720|720x480)\b/gi, " ")
    .replace(/\b(hevc|h\.?265|x265|av1|avc|h\.?264|x264|10bit|hi10p)\b/gi, " ")
    .replace(/\b(web-?dl|webrip|b-?global|baha|cr|crunchyroll|netflix|nf|bilibili|at-?x|abema|amzn|u-?next|tv|bd|bdrip|bluray)\b/gi, " "),
    seasonNumber
  );

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

function extractSearchTitle(title: string) {
  const match = title.match(
    /[（(]\s*(?:检索用|檢索用|搜索用|搜尋用|检索名|檢索名|搜索名|搜尋名)\s*[：:]\s*([^）)]+?)\s*[）)]/
  );
  return match?.[1]?.trim() ?? null;
}

function cleanSeriesTitle(title: string, seasonNumber: number | null) {
  const cleaned = stripSeasonMarkers(title, seasonNumber)
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || title.trim();
}

function stripSeasonMarkers(title: string, seasonNumber: number | null) {
  let working = title
    .replace(/\bSeason\s*\d{1,2}\b/gi, " ")
    .replace(/\b\d{1,2}(?:st|nd|rd|th)\s+Season\b/gi, " ")
    .replace(/第\s*(?:\d{1,2}|[一二三四五六七八九十两]+)\s*(?:季|期|部)/g, " ")
    .replace(/(?<!\d)\d{1,2}\s*(?:季|期|部)/g, " ")
    .replace(/\bS\d{1,2}\b/gi, " ");

  if (seasonNumber != null) {
    for (const marker of seasonMarkers(seasonNumber)) {
      working = working.replace(
        new RegExp(`(^|[\\s/：:~～-])${escapeRegExp(marker)}(?=$|[\\s/：:~～-])`, "gi"),
        " "
      );
    }
  }

  return working;
}

function parseSeasonNumber(value: string | undefined) {
  if (!value) return null;
  const numeric = Number.parseInt(value, 10);
  if (Number.isFinite(numeric) && numeric >= 0 && numeric <= 99) return numeric;
  const roman = parseRomanSeasonNumber(value);
  if (roman != null) return roman;
  const chinese = parseChineseNumber(value);
  return chinese != null && chinese >= 0 && chinese <= 99 ? chinese : null;
}

function parseRomanSeasonNumber(value: string) {
  const normalized = value.trim().toUpperCase();
  const roman: Record<string, number> = {
    I: 1,
    II: 2,
    III: 3,
    IV: 4,
    V: 5,
    "Ⅰ": 1,
    "Ⅱ": 2,
    "Ⅲ": 3,
    "Ⅳ": 4,
    "Ⅴ": 5
  };
  return roman[normalized] ?? null;
}

function parseChineseNumber(value: string) {
  const digits: Record<string, number> = {
    零: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9
  };
  const text = value.trim();
  if (!text) return null;
  if (text === "十") return 10;
  const tenIndex = text.indexOf("十");
  if (tenIndex >= 0) {
    const before = text.slice(0, tenIndex);
    const after = text.slice(tenIndex + 1);
    const tens = before ? digits[before] : 1;
    const ones = after ? digits[after] : 0;
    return tens == null || ones == null ? null : tens * 10 + ones;
  }
  return digits[text] ?? null;
}

function seasonMarkers(seasonNumber: number) {
  const roman = [
    "",
    "I",
    "II",
    "III",
    "IV",
    "V"
  ][seasonNumber];
  const unicodeRoman = [
    "",
    "Ⅰ",
    "Ⅱ",
    "Ⅲ",
    "Ⅳ",
    "Ⅴ"
  ][seasonNumber];
  return [roman, unicodeRoman].filter((value): value is string => Boolean(value));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findMatch(
  title: string,
  regex: RegExp,
  normalize: (value: string) => string
) {
  const value = title.match(regex)?.[1];
  return value ? normalize(value) : null;
}

function inferSubtitleLanguage(title: string, bracketTags: string[]) {
  const bracketValue = bracketTags.find((tag) => looksLikeSubtitleTag(tag));
  if (bracketValue) return bracketValue.trim();
  // findMatch uses group 1; Chinese branch may be group 0-only — use first capture or full match
  const match = title.match(SUBTITLE_RE);
  if (!match) return null;
  const value = (match[1] ?? match[0]).trim();
  return value || null;
}

function keepOriginal(value: string) {
  return value.trim();
}

function looksLikeEpisode(value: string) {
  return /^\d{1,3}(?:v\d)?$/i.test(value) || /^S\d{1,2}E\d{1,3}$/i.test(value);
}

function extractLeadingWrappedValue(title: string) {
  const regex = /^\s*[\[【(（]([^\]】)）]{1,80})[\]】)）]/;
  return title.match(regex)?.[1]?.trim() ?? null;
}

function looksLikeSubtitleTag(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 48) return false;
  // "CATCHPLAY WEB-DL 1080p AVC AAC" must never count as a subtitle tag
  // (previously "tc" inside CATCHPLAY made SUBTITLE_RE.test true for the whole tag).
  if (looksLikeTechnicalBundle(trimmed)) return false;
  // "桜都字幕组" is a release group, not a language label.
  if (/字幕组|字幕組|字幕組/.test(trimmed)) return false;
  if (
    /^(chs|cht|sc|tc|jpsc|jpn|jp|eng|gb|big5|multi)([+&/_-][A-Za-z0-9]+)*$/i.test(
      trimmed
    )
  ) {
    return true;
  }
  // Chinese subtitle phrases: language words + optional 字幕/内封/…
  if (
    /简繁|繁简|简体|繁体|繁體|简中|繁中|简日|繁日|中日|日简|日繁|简|繁|體|内封|外挂|外掛|内嵌|內嵌|双语|雙語|中文字幕/.test(
      trimmed
    )
  ) {
    return true;
  }
  return false;
}

function looksLikeTechnicalBundle(value: string) {
  return (
    RESOLUTION_RE.test(value) ||
    CODEC_RE.test(value) ||
    BIT_DEPTH_RE.test(value) ||
    SOURCE_RE.test(value) ||
    AUDIO_RE.test(value) ||
    /web-?dl|webrip|hevc|x264|x265|avc|aac|flac|mkv|mp4|catchplay|bilibili|netflix/i.test(
      value
    )
  );
}

function looksLikeTechnicalTag(value: string) {
  return looksLikeTechnicalBundle(value) || looksLikeSubtitleTag(value);
}

function isRedundantTechnicalTag(
  tag: string,
  primary: {
    resolution: string | null;
    subtitleLanguage: string | null;
  }
) {
  const parsedValues = [
    [findMatch(tag, RESOLUTION_RE, keepOriginal), primary.resolution],
    [findMatch(tag, SUBTITLE_RE, keepOriginal), primary.subtitleLanguage]
  ].filter(
    (entry): entry is [string, string | null] => entry[0] != null
  );

  return (
    parsedValues.length > 0 &&
    parsedValues.every(([value, primaryValue]) => equalsLoose(value, primaryValue))
  );
}

function equalsLoose(left: string | null | undefined, right: string | null | undefined) {
  return (left ?? "").trim().toLowerCase() === (right ?? "").trim().toLowerCase();
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
