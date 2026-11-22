import {
  getSubscription,
  getSystemSettings,
  syncLibraryEpisodeInventory
} from "@/lib/db/repositories";
import {
  isOpenListNotFoundError,
  type OpenListFileEntry
} from "@/lib/openlist/client";
import { parseReleaseTitle } from "@/lib/rss/title-parser";
import {
  buildSeasonLibraryPath,
  extractEpisodeNumberFromFilename
} from "@/lib/utils/path";
import {
  libraryRootForSubscription,
  listOpenListMediaFiles
} from "@/lib/worker/pipeline-shared";

/** Rebuild one subscription season's file index before RSS jobs are created. */
export async function syncSubscriptionLibrary(subscriptionId: number) {
  const subscription = getSubscription(subscriptionId);
  if (!subscription) throw new Error(`Subscription ${subscriptionId} not found`);

  const settings = getSystemSettings();
  if (!settings.openlistBaseUrl || !settings.openlistToken) {
    return {
      root: null,
      scanned: 0,
      recognized: 0,
      unrecognized: 0,
      imported: 0,
      updated: 0,
      removed: 0,
      available: false
    };
  }

  const seasonRoot = buildSeasonLibraryPath({
    destinationRoot: libraryRootForSubscription(subscription),
    subscriptionName: subscription.name,
    seasonNumber: subscription.seasonNumber,
    seasonPathTemplate: settings.seasonPathTemplate
  });

  let files: OpenListFileEntry[];
  try {
    files = await listOpenListMediaFiles(seasonRoot);
  } catch (error) {
    if (!isOpenListNotFoundError(error)) throw error;
    files = [];
  }

  const inventory = files.map((file) => {
    const parsed = parseReleaseTitle(file.name);
    const templateEpisode = extractEpisodeNumberFromFilename({
      filename: file.name,
      seasonNumber: subscription.seasonNumber,
      episodeFileTemplate: settings.episodeFileTemplate
    });
    const parsedEpisode =
      parsed.seasonNumber == null || parsed.seasonNumber === subscription.seasonNumber
        ? parsed.episodeNumber
        : null;
    return {
      path: file.path,
      episodeNumber: templateEpisode ?? parsedEpisode,
      sizeBytes: file.size
    };
  });
  const synced = syncLibraryEpisodeInventory(
    subscription.id,
    seasonRoot,
    inventory
  );
  const recognized = inventory.filter((file) => file.episodeNumber != null).length;
  const result = {
    root: seasonRoot,
    scanned: inventory.length,
    recognized,
    unrecognized: inventory.length - recognized,
    ...synced,
    available: true
  };
  console.log(
    `[pipeline] library sync subscription#${subscription.id} ${JSON.stringify(result)}`
  );
  return result;
}
