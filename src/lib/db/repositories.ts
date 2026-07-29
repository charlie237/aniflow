/**
 * Stable public entry point for database repositories.
 *
 * Implementations live in domain-specific modules so callers do not depend on
 * the database layer's internal file layout.
 */
export type { DashboardQueryInput } from "@/lib/db/repositories/dashboard-repository";
export {
  getDashboardData,
  getDashboardEpisodePage
} from "@/lib/db/repositories/dashboard-repository";

export {
  claimQueuedJob,
  createOrUpdateJob,
  failStaleDownloadingJobs,
  getJob,
  getJobForFeedItem,
  listJobs,
  listJobsByStatus,
  markJobAttempt,
  migrateLegacyDownloadJobsToFailed,
  updateJobStatus
} from "@/lib/db/repositories/download-job-repository";

export {
  getEpisodeFileForFeedItem,
  listEpisodeFiles,
  upsertEpisodeFile
} from "@/lib/db/repositories/episode-file-repository";

export { resetRuntimeData } from "@/lib/db/repositories/maintenance-repository";

export type {
  LibraryInventoryFile,
  ParsedFeedInput
} from "@/lib/db/repositories/release-repository";
export {
  findFeedItemsForSubscription,
  findMetadataBySubscription,
  getFeedItem,
  getHighestReleaseRevisionForVariant,
  getLibraryEpisodeState,
  getLibraryFileRevisionAtPath,
  getMetadataForFeedItem,
  getPreferredFeedItemIdForRelease,
  libraryFileExistsAtPath,
  listVariantFeedItemIds,
  syncLibraryEpisodeInventory,
  upsertFeedItem
} from "@/lib/db/repositories/release-repository";

export type { SubscriptionInput } from "@/lib/db/repositories/subscription-repository";
export {
  addRule,
  archiveSubscription,
  createSubscription,
  deleteRule,
  deleteSubscription,
  getSubscription,
  listEnabledSubscriptions,
  listRules,
  listSubscriptionIdsWithInFlightJobs,
  listSubscriptions,
  replaceSubscriptionAllowRules,
  restoreSubscription,
  touchSubscriptionPolled,
  updateSubscription
} from "@/lib/db/repositories/subscription-repository";

export {
  acquireWorkerLease,
  getSystemSettings,
  getWorkerHealth,
  refreshWorkerLease,
  releaseWorkerLease,
  saveSystemSettings,
  touchWorkerHeartbeat
} from "@/lib/db/repositories/system-settings-repository";

export {
  claimNextWorkerTask,
  completeWorkerTask,
  enqueueWorkerTask,
  failStaleWorkerTasks,
  failWorkerTask,
  getWorkerTask,
  listWorkerTasks,
  listWorkerTasksByStatus
} from "@/lib/db/repositories/worker-task-repository";
