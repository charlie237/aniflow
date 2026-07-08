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
  resolution: string | null;
  subtitleLanguage: string | null;
  source: string | null;
  codec: string | null;
  audio: string | null;
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

export interface SystemSettings {
  openlistBaseUrl: string;
  openlistToken: string;
  openlist115Mode: "115 Cloud" | "115 Open";
  openlist115TempDir: string;
  openlistIncomingPath: string;
  mediaLibraryRoot: string;
  seasonPathTemplate: string;
  episodeFileTemplate: string;
  proxyEnabled: boolean;
  proxyUrl: string;
  tmdbBearerToken: string;
  workerIntervalSeconds: number;
}

export interface DashboardData {
  subscriptions: Subscription[];
  rules: FilterRule[];
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
  episodeFiles: EpisodeFile[];
  stats: {
    activeSubscriptions: number;
    queuedJobs: number;
    needsReview: number;
    completedJobs: number;
  };
}
