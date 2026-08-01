const en = {
  meta: {
    description: "RSS anime release tracker for OpenList downloads"
  },
  common: {
    never: "Never",
    unknown: "Unknown",
    cancel: "Cancel",
    save: "Save",
    delete: "Delete",
    edit: "Edit",
    collapse: "Collapse",
    none: "None",
    prevPage: "Previous page",
    nextPage: "Next page",
    totalItems: "{total} total",
    perPage: "{size} / page",
    noTags: "No tags",
    viewDetails: "View details",
    subscriptionFallback: "Subscription {id}",
    allSubscriptions: "All subscriptions"
  },
  nav: {
    overview: "Overview",
    subscriptions: "Subscriptions",
    settings: "Settings",
    logout: "Log out"
  },
  theme: {
    system: "System",
    light: "Light",
    dark: "Dark",
    aria: "Theme: {current}. Click to switch to {next}",
    title: "Theme: {current} (click for {next})"
  },
  locale: {
    label: "Language",
    switchTo: "Switch to {label}",
    aria: "Language {current}. Click to switch to {next}"
  },
  login: {
    title: "Sign in to Aniflow",
    descriptionPrefix: "AUTH_PASSWORD is enabled. Enter the access password.",
    password: "Access password",
    invalid: "Incorrect password",
    failed: "Sign-in failed. Try again.",
    submit: "Open console"
  },
  overview: {
    badge: "RSS / OpenList / 115 media flow",
    title: "Overview",
    description:
      "Track jobs, releases, and file organization. Manage subscriptions and connection settings on their own pages.",
    poll: "Sync & poll",
    scan: "Scan & organize",
    statActive: "Active subs",
    statQueued: "In progress",
    statWorker: "Worker tasks",
    statReview: "Needs review",
    statCompleted: "Completed",
    lastPoll: "Last poll:",
    workerHeartbeat: "Worker heartbeat:",
    workerOfflineTitle: "Background worker has no recent heartbeat",
    workerOfflineBody:
      "Persistent polling requires a separate npm run worker process.",
    noHeartbeatSince: "No heartbeat for {age}",
    neverHeartbeat: "Never seen"
  },
  subscriptionsPage: {
    title: "Subscriptions",
    description:
      "Parse an RSS feed first, then pick the title, subtitle group, resolution, and subtitle language."
  },
  settingsPage: {
    title: "Settings",
    description:
      "Configure OpenList 115 offline download, TMDB display token, and worker poll interval."
  },
  status: {
    job: {
      discovered: "Discovered",
      skipped: "Skipped",
      queued: "Queued",
      downloading: "Downloading",
      waiting_file: "Waiting for file",
      needs_review: "Needs review",
      ready_to_rename: "Ready to rename",
      completed: "Completed",
      failed: "Failed"
    },
    episode: {
      organizeFailed: "Organize failed",
      organized: "Organized",
      fileRecord: "File record",
      pendingQueue: "Pending queue"
    },
    filter: {
      all: "All",
      active: "Active",
      waiting: "Waiting",
      failed: "Failed",
      completed: "Completed"
    }
  },
  workerTask: {
    title: "Worker queue",
    description:
      "Library sync, RSS polling, and file organization are queued first.",
    empty: "No worker tasks.",
    colStatus: "Status",
    colTask: "Task",
    colAttempts: "Attempts",
    colUpdated: "Updated",
    colDetails: "Details",
    viewDetails: "View worker task details",
    taskTitle: "Worker task #{id}",
    labelStatus: "Status",
    labelAttempts: "Attempts",
    labelCreated: "Created",
    labelStarted: "Started",
    labelFinished: "Finished",
    labelUpdated: "Updated",
    labelError: "Error",
    types: {
      poll_all: "Sync & poll all",
      poll_subscription: "Sync & poll subscription",
      cleanup_subscription_incoming: "Legacy auto-cleanup (disabled)",
      scan_incoming: "Scan & organize",
      submit_queued: "Submit download"
    },
    statuses: {
      queued: "Queued",
      running: "Running",
      completed: "Completed",
      failed: "Failed"
    }
  },
  episode: {
    title: "Episodes",
    description:
      "Shows rule-matched RSS releases with download jobs and file organization results.",
    tracking: "Tracking",
    archived: "Archived",
    allTracking: "All tracking episodes",
    allArchived: "All archived episodes",
    clearFilters: "Clear filters",
    colStatus: "Status",
    colRelease: "Release",
    colFile: "File",
    colPublished: "Published",
    colActions: "Actions",
    empty: "No rule-matched episodes yet.",
    retryDownload: "Retry download",
    retryDownloadTitle: "Clean the OpenList task and its job directory before resubmitting",
    confirmDownload: "Confirm download",
    confirmDownloadTitle: "Confirm and submit download",
    forceDownload: "Force download",
    forceDownloadTitle: "This release is superseded; ignore the revision policy and download/organize anyway",
    noFile: "No file found",
    multiFiles: " / {count} files",
    unparsed: "Unparsed",
    noFilterTags: "No filter tags",
    manual: "Manual add",
    manualTitle: "Manually add episode",
    manualDescription:
      "Add one episode with an external magnet or torrent URL. It goes straight into the OpenList offline queue.",
    subscription: "Subscription",
    episodeNumber: "Episode",
    revision: "Revision",
    revisionPlaceholder: "Use 2 for v2",
    sourceUrl: "Download URL",
    sourcePlaceholder: "magnet:?xt=urn:btih:... or https://...torrent",
    releaseTitle: "Release title",
    titlePlaceholder:
      "Leave blank to generate from subscription name, episode, and filter rules",
    enqueue: "Enqueue",
    detailRss: "RSS",
    detailTitle: "Title",
    detailGuid: "GUID",
    detailLink: "Release page",
    detailDownload: "Download URL",
    detailPublished: "Published",
    detailFirstSeen: "First seen",
    detailParsed: "Parsed",
    detailEpisode: "Episode",
    detailGroup: "Group",
    detailResolution: "Resolution",
    detailSubtitle: "Subtitles",
    detailJob: "Download job",
    detailJobId: "Job",
    detailOpenlist: "OpenList task",
    detailTarget: "Target path",
    detailAttempts: "Attempts",
    detailError: "Error",
    detailFiles: "Files",
    detailNoFiles: "No file records yet.",
    detailOriginalPath: "Original path",
    detailFinalPath: "Final path",
    detailSize: "Size",
    detailFileStatus: "Status"
  },
  rssPreview: {
    title: "RSS preview",
    description:
      "Enter an RSS URL to load releases. Subscription controls only use parsed candidates.",
    parse: "Parse",
    facetTitle: "RSS title",
    facetSeason: "Season",
    facetGroup: "Group",
    facetResolution: "Resolution",
    facetLanguage: "Subtitles",
    zeroItems: "0 items",
    rangeItems: "{from}-{to} / {total}",
    colTitle: "Release title",
    colParsed: "Parsed",
    colEpisode: "Episode",
    colDownload: "Download URL",
    unparsedTitle: "Title not recognized"
  },
  subscription: {
    cardTitle: "Subscriptions",
    cardDescription:
      "After parsing RSS, pick subtitle group, resolution, and language, then confirm the match preview.",
    needParse: "Parse an RSS feed above before creating a subscription.",
    name: "Name",
    season: "Season",
    group: "Group",
    resolution: "Resolution",
    language: "Subtitles",
    pickGroup: "No group selected",
    pickResolution: "No resolution selected",
    pickLanguage: "No language selected",
    clearFilters: "Clear filters",
    autoDownload: "Auto offline",
    create: "Create subscription",
    tracking: "Tracking",
    noTracking: "No active subscriptions.",
    archived: "Archived",
    archive: "Archive",
    restore: "Resume tracking",
    deleteTitle: "Delete subscription",
    deleteConfirm:
      "Delete “{name}”? This cannot be undone and will not remove OpenList tasks or files; confirm they were cleaned manually.",
    deleteBlocked:
      "This subscription still has an in-flight download and cannot be deleted. Archive it, then wait for completion or failure and handle it manually.",
    confirmDelete: "Confirm delete",
    discoverOnly: "Discover only",
    save: "Save subscription",
    noCandidates: "No candidates parsed",
    notSelected: "Not selected",
    previewTitle: "Match preview",
    previewMatch: "{matched}/{total} will auto-download",
    hit: "Match",
    reasonGroupMismatch: "Group mismatch",
    reasonGroupMissing: "No group selected",
    reasonResolutionMismatch: "Resolution mismatch",
    reasonResolutionMissing: "No resolution selected",
    reasonLanguageMismatch: "Language mismatch",
    reasonLanguageMissing: "No language selected",
    reasonNoUrl: "No download URL",
    reasonNoEpisode: "Episode not parsed"
  },
  settings: {
    openlistTitle: "OpenList 115",
    openlistDescription:
      "Each 115 offline task uses an exclusive job directory before validation, rename, and library move.",
    baseUrl: "OpenList URL",
    token: "OpenList token",
    incomingPath: "Download directory (global root)",
    incomingHelp:
      "Global offline-download root. Every task exclusively uses root/jobs/job-id; the system never guesses ownership by filename or automatically deletes failed leftovers. Connectivity check syncs this root into OpenList backend config.",
    check115: "Sync OpenList & check 115",
    proxyTitle: "Proxy",
    proxyDescription:
      "Used only when enabled for RSS preview and worker RSS fetches.",
    proxyEnabled: "Enable proxy",
    proxyUrl: "Proxy URL",
    proxyHelp: "Defaults to a local proxy; unused unless enabled.",
    namingTitle: "Naming rules",
    namingDescription:
      "Builds the final organized path — not the offline landing folder.",
    mediaRoot: "Media library root",
    mediaRootHelp:
      "Final root after organization. The worker moves renamed files here from the download directory.",
    seasonTemplate: "Season path template",
    seasonTemplateHelp:
      "Relative to the media library root; no /115 prefix needed.",
    episodeTemplate: "Filename template",
    episodeTemplateHelp:
      "Filename only. Full path is media root + season template + this template.",
    revisionTitle: "Revision overwrite (on by default)",
    revisionHelp:
      "When v2/v3 of the same variant appears, download the newest. Higher revisions may replace library files; lower ones cannot. Same-path redownloads and cross-group overwrites also follow this switch.",
    variables: "Available variables",
    example: "Example: /115/Anime/Show/Season 01/Show - S01E01.mkv",
    miscTitle: "Misc",
    miscDescription:
      "TMDB is display-only; worker interval and download timeout control background cadence.",
    tmdbToken: "TMDB Bearer Token",
    workerInterval: "Worker interval (seconds)",
    workerIntervalHelp:
      "RSS poll and task schedule interval. Minimum 30s. Takes effect next cycle.",
    downloadTimeout: "Download timeout (minutes)",
    downloadTimeoutHelp:
      "Jobs stuck in “Downloading” longer than this without finishing organize are marked failed. Default 30 minutes.",
    save: "Save settings",
    maintenanceTitle: "Maintenance",
    maintenanceDescription:
      "Clear RSS poll results, parsed metadata, download jobs, and file-scan records. Settings, subscriptions, and filter rules are kept.",
    resetConfirmError:
      "Confirmation phrase is wrong. Type “{phrase}” then submit.",
    resetSuccess:
      "Runtime data cleared. Settings, subscriptions, and filter rules were kept.",
    checkOk: "Connected",
    checkFail: "Check failed",
    modeLabel: "115 access mode",
    modeHelp:
      "Must match the driver mounted at `/115` in OpenList. Use 115 Open if that is your mount."
  },
  reset: {
    trigger: "Clear runtime data",
    title: "Clear runtime data",
    description:
      "Deletes RSS poll results, parsed metadata, download jobs, and file-scan records. Settings, subscriptions, and filter rules are kept. This cannot be undone.",
    typeToConfirm: "Type “{phrase}” to confirm",
    confirm: "Confirm clear"
  },
  check: {
    openlistSync: "OpenList backend sync",
    openlistSyncOk:
      "Synced download directory {path} to OpenList {mode} backend config",
    openlistDirs: "OpenList directory ensure",
    openlistDirsOk: "Confirmed {media} and {incoming}",
    tokenOk: "Token valid",
    tokenOkUser: "Token valid: {user}",
    accessMode: "115 access mode",
    incomingDir: "Download directory"
  }
} as const;

export default en;
