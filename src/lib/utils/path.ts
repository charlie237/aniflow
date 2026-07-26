const ILLEGAL_PATH_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;
const MEDIA_EXTENSIONS = new Set([
  "mkv",
  "mp4",
  "avi",
  "mov",
  "m2ts",
  "ts",
  "webm"
]);

export function sanitizePathSegment(value: string) {
  const sanitized = value
    .replace(ILLEGAL_PATH_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  return sanitized === "." || sanitized === ".." ? "" : sanitized;
}

export function joinRemotePath(...parts: Array<string | null | undefined>) {
  const segments: string[] = [];
  const rawSegments = parts
    .filter((part): part is string => Boolean(part))
    .flatMap((part) => part.split("/"))
    .map((part) => part.trim())
    .filter(Boolean);

  for (const segment of rawSegments) {
    if (segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  return `/${segments.join("/")}`;
}

export function isRemotePathWithin(path: string, root: string) {
  const normalizedPath = joinRemotePath(path);
  const normalizedRoot = joinRemotePath(root);
  if (normalizedRoot === "/") return true;
  return (
    normalizedPath === normalizedRoot ||
    normalizedPath.startsWith(`${normalizedRoot}/`)
  );
}

/**
 * Per-subscription offline download directory under the global incoming root.
 * Example: root `/115/Anime/_incoming` + name `芙莉莲` → `/115/Anime/_incoming/芙莉莲`
 */
export function buildSubscriptionIncomingPath(
  incomingRoot: string,
  subscriptionName: string
) {
  const segment = sanitizePathSegment(subscriptionName) || "unnamed";
  return joinRemotePath(incomingRoot, segment);
}

/**
 * Resolve the offline download path for a subscription.
 * Explicit incomingPath wins; otherwise isolate under the global root by name.
 */
export function resolveSubscriptionIncomingPath(params: {
  incomingRoot: string;
  subscriptionName: string;
  incomingPath?: string | null;
}) {
  const root = joinRemotePath(params.incomingRoot);
  const explicit = params.incomingPath?.trim();
  if (explicit) {
    const normalized = joinRemotePath(explicit);
    if (!isRemotePathWithin(normalized, root)) {
      throw new Error(
        `Subscription incoming path must stay within the global incoming root: ${root}`
      );
    }
    return normalized;
  }
  return buildSubscriptionIncomingPath(root, params.subscriptionName);
}

export function getExtension(path: string) {
  const match = path.match(/\.([a-z0-9]{2,6})(?:$|\?)/i);
  return match?.[1]?.toLowerCase() ?? null;
}

export function getRemoteBaseName(path: string) {
  return path.split("/").filter(Boolean).at(-1) ?? "";
}

export function getRemoteDirName(path: string) {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts.length > 0 ? `/${parts.join("/")}` : "/";
}

export function isMediaFile(path: string) {
  const extension = getExtension(path);
  return extension != null && MEDIA_EXTENSIONS.has(extension);
}

export function buildEpisodePath(params: {
  destinationRoot: string;
  subscriptionName: string;
  seasonNumber: number;
  episodeNumber: number;
  extension: string;
  seasonPathTemplate?: string;
  episodeFileTemplate?: string;
}) {
  const context = episodeTemplateContext(params);
  const seasonPath = buildSeasonLibraryPath(params);
  const filename = renderTemplate(
    params.episodeFileTemplate ?? "{title} - S{season_pad}E{episode_pad}.{ext}",
    context
  );
  return joinRemotePath(seasonPath, filename);
}

/** Resolve the media-library directory that owns one subscription season. */
export function buildSeasonLibraryPath(params: {
  destinationRoot: string;
  subscriptionName: string;
  seasonNumber: number;
  seasonPathTemplate?: string;
}) {
  const context = episodeTemplateContext({
    ...params,
    episodeNumber: 0,
    extension: "mkv"
  });
  const seasonPath = renderTemplate(
    params.seasonPathTemplate ?? "{title}/Season {season_pad}",
    context
  );
  return joinRemotePath(params.destinationRoot, seasonPath);
}

export function extractEpisodeNumberFromFilename(params: {
  filename: string;
  seasonNumber: number;
  episodeFileTemplate?: string;
}) {
  const template = sanitizePathSegment(
    params.episodeFileTemplate ?? "{title} - S{season_pad}E{episode_pad}.{ext}"
  );
  const tokenPattern = /\{([a-z_]+)\}/gi;
  let pattern = "";
  let cursor = 0;
  let hasEpisodeToken = false;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(template))) {
    pattern += escapeRegExp(template.slice(cursor, match.index));
    const token = match[1]?.toLowerCase();
    if (token === "episode" || token === "episode_pad") {
      pattern += hasEpisodeToken ? "\\d{1,3}" : "(?<episode>\\d{1,3})";
      hasEpisodeToken = true;
    } else if (token === "season") {
      pattern += escapeRegExp(String(params.seasonNumber));
    } else if (token === "season_pad") {
      pattern += escapeRegExp(String(params.seasonNumber).padStart(2, "0"));
    } else if (token === "ext") {
      pattern += "[a-z0-9]{2,6}";
    } else {
      pattern += ".+?";
    }
    cursor = match.index + match[0].length;
  }

  if (!hasEpisodeToken) return null;
  pattern += escapeRegExp(template.slice(cursor));
  const filenameMatch = params.filename.match(new RegExp(`^${pattern}$`, "i"));
  const episode = Number(filenameMatch?.groups?.episode);
  return Number.isInteger(episode) && episode >= 0 && episode < 1000
    ? episode
    : null;
}

function episodeTemplateContext(params: {
  subscriptionName: string;
  seasonNumber: number;
  episodeNumber: number;
  extension: string;
}) {
  const title = sanitizePathSegment(params.subscriptionName);
  const season = String(params.seasonNumber);
  const episode = String(params.episodeNumber);
  return {
    title,
    season,
    season_pad: season.padStart(2, "0"),
    episode,
    episode_pad: episode.padStart(2, "0"),
    ext: sanitizePathSegment(params.extension.toLowerCase())
  };
}

function renderTemplate(template: string, context: Record<string, string>) {
  return template
    .replace(/\{([a-z_]+)\}/gi, (_, key: string) => context[key] ?? "")
    .split("/")
    .map((part) => sanitizePathSegment(part))
    .filter(Boolean)
    .join("/");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
