import { getDb } from "@/lib/db/client";
import {
  downloadJobs,
  episodeFiles,
  feedItems,
  releaseMetadata,
  subscriptions,
  workerTasks
} from "@/lib/db/schema";

export function resetRuntimeData() {
  return getDb().transaction((tx) => {
    const workerTasksCount = tx.delete(workerTasks).run().changes;
    const downloadJobsCount = tx.delete(downloadJobs).run().changes;
    const episodeFilesCount = tx.delete(episodeFiles).run().changes;
    const releaseMetadataCount = tx.delete(releaseMetadata).run().changes;
    const feedItemsCount = tx.delete(feedItems).run().changes;
    const subscriptionsTouched = tx
      .update(subscriptions)
      .set({ lastPolledAt: null })
      .run().changes;

    return {
      downloadJobs: downloadJobsCount,
      episodeFiles: episodeFilesCount,
      releaseMetadata: releaseMetadataCount,
      feedItems: feedItemsCount,
      workerTasks: workerTasksCount,
      subscriptionsTouched
    };
  });
}
