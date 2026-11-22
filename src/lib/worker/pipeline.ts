/**
 * Stable public entry point for the worker download & organization pipeline.
 *
 * Domain implementations live in sibling modules:
 * - `poll.ts` — RSS polling and job discovery
 * - `library-sync.ts` — OpenList season library indexing
 * - `download.ts` — offline download submission, reconciliation, retry/confirm
 * - `organize.ts` — incoming job directory scan, validation, rename, and move
 */
export type {
  PipelineResult,
  WorkerTaskProgress,
  WorkerTaskProgressReporter
} from "@/lib/worker/pipeline-shared";
export {
  incomingPathForJob,
  libraryRootForSubscription
} from "@/lib/worker/pipeline-shared";
export { syncSubscriptionLibrary } from "@/lib/worker/library-sync";
export { scanAndRenameIncoming } from "@/lib/worker/organize";
export {
  cleanAndRetryJob,
  confirmJob,
  reconcileDownloadingJobs,
  retryJob,
  runDownloadMaintenance,
  submitJob,
  submitQueuedJobs
} from "@/lib/worker/download";
export {
  pollAllSubscriptions,
  pollSubscription,
  refreshSubscriptionFeedCache
} from "@/lib/worker/poll";
