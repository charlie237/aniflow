import type { OpenListTask } from "@/lib/openlist/client";
import {
  extractBtih,
  extractMagnetDisplayName
} from "@/lib/torrent/magnet";

/**
 * Build lookup keys for matching an offline job source URL to an OpenList task.
 * Prefers info-hash (magnet/torrent identity) over raw URL strings.
 */
export function offlineSourceKeys(
  sourceUrl: string,
  infoHash?: string | null
): string[] {
  const raw = sourceUrl.trim();
  const keys = new Set<string>();
  if (raw) keys.add(raw.toLowerCase());

  const btih = (infoHash?.trim() || extractBtih(raw) || "").toLowerCase();
  if (btih) {
    keys.add(btih);
    keys.add(`urn:btih:${btih}`);
    keys.add(`btih:${btih}`);
  }

  // Mikan download paths sometimes appear in task names without query string.
  try {
    if (/^https?:\/\//i.test(raw)) {
      const url = new URL(raw);
      keys.add(`${url.origin}${url.pathname}`.toLowerCase());
      keys.add(url.pathname.toLowerCase());
    }
  } catch {
    // ignore invalid URLs
  }

  return [...keys].filter((key) => key.length >= 8);
}

/**
 * Find an OpenList offline task that corresponds to this source URL / magnet.
 * OpenList usually puts the URL or torrent name into `task.name`.
 * Prefer passing a stored `infoHash` so rebind does not need to re-fetch torrents.
 */
export function findOfflineTaskForSource(
  tasks: OpenListTask[],
  sourceUrl: string,
  options?: { infoHash?: string | null; offlineName?: string | null }
): OpenListTask | null {
  const keys = offlineSourceKeys(sourceUrl, options?.infoHash);
  if ((keys.length === 0 && !options?.offlineName) || tasks.length === 0) {
    return null;
  }

  let best: { task: OpenListTask; score: number } | null = null;
  let tied = false;

  for (const task of tasks) {
    if (!task.id) continue;
    const haystack = offlineTaskHaystack(task);
    let score = 0;
    for (const key of keys) {
      if (!haystack.includes(key)) continue;
      // Prefer info-hash hits over long magnet/url string noise.
      if (/^[a-f0-9]{40}$/.test(key) || key.includes("btih:")) {
        score = Math.max(score, 100);
      } else if (key.startsWith("magnet:")) {
        score = Math.max(score, 80);
      } else if (key.startsWith("http")) {
        score = Math.max(score, 70);
      } else {
        score = Math.max(score, 50);
      }
    }

    // Secondary: torrent display name from magnet dn= / stored offline name.
    for (const name of [
      options?.offlineName,
      extractMagnetDisplayName(sourceUrl)
    ]) {
      if (!name || name.length < 4) continue;
      const dnKey = name.toLowerCase();
      if (haystack.includes(dnKey) || task.name.toLowerCase().includes(dnKey)) {
        score = Math.max(score, 40);
      }
    }

    if (score <= 0) continue;
    if (!best || score > best.score) {
      best = { task, score };
      tied = false;
    } else if (score === best.score && task.id !== best.task.id) {
      // Same score for distinct tasks (e.g. original + 10008 residue) — refuse.
      tied = true;
    }
  }

  if (!best || tied) return null;
  return best.task;
}

function offlineTaskHaystack(task: OpenListTask) {
  return [task.id, task.name, task.status, task.error]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}
