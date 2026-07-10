const MIKAN_HOST = "mikanani.me";

export function isMikanRssUrl(value: string) {
  const url = parseMikanUrl(value);
  return Boolean(url && url.pathname.toLowerCase().startsWith("/rss/"));
}

export function isMikanDownloadUrl(value: string) {
  const url = parseMikanUrl(value);
  if (!url) return false;
  const pathname = url.pathname.toLowerCase();
  return pathname.includes("/download/") || pathname.endsWith(".torrent");
}

export function assertMikanRssUrl(value: string) {
  if (!isMikanRssUrl(value)) {
    throw new Error("Only Mikan RSS URLs under mikanani.me/RSS/ are allowed");
  }
  return new URL(value);
}

export function assertMikanDownloadUrl(value: string) {
  if (!isMikanDownloadUrl(value)) {
    throw new Error(
      "Only Mikan torrent URLs under mikanani.me/Download/ are allowed"
    );
  }
  return new URL(value);
}

function parseMikanUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    if (hostname !== MIKAN_HOST && !hostname.endsWith(`.${MIKAN_HOST}`)) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}
