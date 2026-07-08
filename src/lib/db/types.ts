export type JobStatus =
  | "discovered"
  | "skipped"
  | "queued"
  | "downloading"
  | "needs_review"
  | "ready_to_rename"
  | "completed"
  | "failed";

export type RuleType =
  | "group_allow"
  | "group_block"
  | "resolution_allow"
  | "language_allow"
  | "keyword_include"
  | "keyword_exclude";

export type WorkerTaskType =
  | "poll_all"
  | "poll_subscription"
  | "cleanup_subscription_incoming"
  | "scan_incoming"
  | "submit_queued";

export type WorkerTaskStatus = "queued" | "running" | "completed" | "failed";

export type EpisodeStatusFilter =
  | "all"
  | "active"
  | "completed"
  | "failed"
  | "waiting";

export interface Subscription {
  id: number;
  name: string;
  rssUrl: string;
  enabled: boolean;
  autoDownload: boolean;
  seasonNumber: number;
  destinationRoot: string;
  incomingPath: string | null;
  tmdbSeriesId: number | null;
  lastPolledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FilterRule {
  id: number;
  subscriptionId: number;
  type: RuleType;
  value: string;
  enabled: boolean;
  createdAt: string;
}

export interface FeedItem {
  id: number;
  subscriptionId: number;
  guid: string;
  rssGuid: string | null;
  title: string;
  link: string | null;
  downloadUrl: string | null;
  publishedAt: string | null;
  rawXmlJson: string | null;
  firstSeenAt: string;
}

export interface ReleaseMetadata {
  id: number;
  feedItemId: number;
  releaseGroup: string | null;
  parsedTitle: string | null;
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

export interface DownloadJob {
  id: number;
  subscriptionId: number;
  feedItemId: number;
  status: JobStatus;
  openlistTaskId: string | null;
  sourceUrl: string | null;
  targetPath: string | null;
  errorMessage: string | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
}

export interface EpisodeFile {
  id: number;
  subscriptionId: number;
  feedItemId: number | null;
  episodeNumber: number | null;
  originalPath: string;
  finalPath: string | null;
  sizeBytes: number | null;
  status: "detected" | "renamed" | "failed";
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkerTask {
  id: number;
  type: WorkerTaskType;
  subscriptionId: number | null;
  status: WorkerTaskStatus;
  payloadJson: string;
  errorMessage: string | null;
  attempts: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

export interface WorkerHealth {
  lastSeenAt: string | null;
  secondsSinceLastSeen: number | null;
  staleAfterSeconds: number;
  ok: boolean;
}

export interface DashboardEpisodeRow {
  id: string;
  subscriptionId: number;
  subscriptionName: string;
  title: string;
  item: FeedItem | null;
  job: DownloadJob | null;
  metadata: ReleaseMetadata | null;
  files: EpisodeFile[];
  seasonNumber: number | null;
  episodeNumber: number | null;
  episodeText: string | null;
  updatedAt: string | null;
}

export interface DashboardEpisodePage {
  rows: DashboardEpisodeRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  filters: {
    subscriptionId: number | null;
    season: number | null;
    status: EpisodeStatusFilter;
  };
  counts: Record<EpisodeStatusFilter, number>;
  subscriptionOptions: Array<{
    id: number;
    name: string;
    seasonNumber: number;
  }>;
  manualSubscriptionOptions: Array<{
    id: number;
    name: string;
    seasonNumber: number;
  }>;
  seasonOptions: number[];
}

export interface SystemSettings {
  openlistBaseUrl: string;
  openlistToken: string;
  openlist115Mode: "115 Cloud" | "115 Open";
  openlistIncomingPath: string;
  mediaLibraryRoot: string;
  seasonPathTemplate: string;
  episodeFileTemplate: string;
  replaceExistingOnRevision: boolean;
  proxyEnabled: boolean;
  proxyUrl: string;
  tmdbBearerToken: string;
  workerIntervalSeconds: number;
}

export interface DashboardData {
  subscriptions: Subscription[];
  rules: FilterRule[];
  rssItems: Array<
    FeedItem & {
      subscriptionName: string;
      metadata: ReleaseMetadata | null;
      job: DownloadJob | null;
      ruleAllowed: boolean;
      ruleReasons: string[];
    }
  >;
  feedItems: Array<
    FeedItem & {
      subscriptionName: string;
      metadata: ReleaseMetadata | null;
      job: DownloadJob | null;
    }
  >;
  jobs: Array<
    DownloadJob & {
      subscriptionName: string;
      feedTitle: string;
      metadata: ReleaseMetadata | null;
    }
  >;
  workerTasks: WorkerTask[];
  episodeFiles: EpisodeFile[];
  episodePage: DashboardEpisodePage;
  workerHealth: WorkerHealth;
  stats: {
    activeSubscriptions: number;
    queuedJobs: number;
    workerTasks: number;
    needsReview: number;
    completedJobs: number;
  };
}
