import { getSystemSettings } from "@/lib/db/repositories";

export interface MediaServerRefreshResult {
  triggered: boolean;
  provider: string;
  error?: string;
}

const REFRESH_TIMEOUT_MS = 10_000;

export async function triggerMediaServerRefresh(): Promise<MediaServerRefreshResult> {
  const settings = getSystemSettings();
  const type = settings.mediaServerType;
  if (type === "none" || !settings.mediaServerUrl || !settings.mediaServerToken) {
    return { triggered: false, provider: type };
  }

  try {
    const baseUrl = parseHttpBaseUrl(settings.mediaServerUrl);
    const token = settings.mediaServerToken;
    const libraryId = settings.mediaServerLibraryId.trim();

    if (type === "jellyfin" || type === "emby") {
      const endpoint = libraryId
        ? `${baseUrl}/Items/${encodeURIComponent(libraryId)}/Refresh?Recursive=true&MetadataRefreshMode=Default&ImageRefreshMode=Default`
        : `${baseUrl}/Library/Refresh`;
      const response = await fetch(endpoint, {
        method: "POST",
        signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
        headers: {
          "X-Emby-Token": token
        }
      });
      if (!response.ok) {
        throw new Error(`${type} refresh failed (${response.status})`);
      }
      return { triggered: true, provider: type };
    }

    if (type === "plex") {
      const section = libraryId ? encodeURIComponent(libraryId) : "all";
      const response = await fetch(
        `${baseUrl}/library/sections/${section}/refresh`,
        {
          method: "GET",
          signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
          headers: {
            "X-Plex-Token": token
          }
        }
      );
      if (!response.ok) {
        throw new Error(`plex refresh failed (${response.status})`);
      }
      return { triggered: true, provider: type };
    }

    return { triggered: false, provider: type };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[media-server] refresh failed (${type}): ${message}`);
    return { triggered: false, provider: type, error: message };
  }
}

function parseHttpBaseUrl(raw: string) {
  const parsed = new URL(raw);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Media server URL must use http:// or https://");
  }
  return raw.replace(/\/+$/, "");
}
