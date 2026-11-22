import { getSystemSettings } from "@/lib/db/repositories";
import { createT, getMessages, type TranslateFn } from "@/lib/i18n";
import { joinRemotePath } from "@/lib/utils/path";

export interface OpenListTask {
  id: string;
  name: string;
  state: number | string;
  status: string;
  progress: number;
  error: string;
}

export interface OpenListTaskListResult {
  tasks: OpenListTask[];
  available: boolean;
  error: string | null;
}

export interface OpenListFileEntry {
  path: string;
  name: string;
  isDirectory: boolean;
  size: number | null;
  modified: string | null;
}

export interface OpenList115CheckResult {
  ok: boolean;
  checks: Array<{
    label: string;
    ok: boolean;
    message: string;
  }>;
}

const DEFAULT_DELETE_POLICY = "delete_never";
const OPENLIST_REQUEST_TIMEOUT_MS = 30_000;
const OPENLIST_READ_MAX_RETRIES = 2;
const OPENLIST_RETRY_BASE_MS = process.env.VITEST ? 1 : 250;

export async function add115OfflineDownload(params: {
  urls: string[];
  path: string;
}) {
  const settings = getSystemSettings();

  const payload = await openListRequest<{ tasks?: OpenListTask[] }>(
    "/api/fs/add_offline_download",
    {
      urls: params.urls,
      path: params.path,
      tool: settings.openlist115Mode,
      delete_policy: DEFAULT_DELETE_POLICY
    }
  );

  return payload.tasks ?? [];
}

/** List unfinished OpenList offline-download tasks. */
export async function listOfflineDownloadUndone() {
  return listTaskEndpoint("/api/task/offline_download/undone");
}

/** List finished OpenList offline-download tasks (success or error). */
export async function listOfflineDownloadDone() {
  return listTaskEndpoint("/api/task/offline_download/done");
}

/** List unfinished offline-download transfer tasks (post-115 transfer). */
export async function listOfflineDownloadTransferUndone() {
  return listTaskEndpoint("/api/task/offline_download_transfer/undone");
}

export function isOfflineTaskFailed(task: OpenListTask) {
  if (task.error && String(task.error).trim()) return true;
  const state = normalizeTaskState(task.state);
  if (state === "failed" || state === "error" || state === "canceled" || state === "cancelled") {
    return true;
  }
  // Alist-style numeric states: 0 pending, 1 running, 2 success, others often failure.
  if (typeof task.state === "number" && task.state >= 3) return true;
  const status = String(task.status ?? "").toLowerCase();
  return /fail|error|cancel|abort/.test(status);
}

export function isOfflineTaskSucceeded(task: OpenListTask) {
  if (isOfflineTaskFailed(task)) return false;
  const state = normalizeTaskState(task.state);
  if (state === "succeeded" || state === "success" || state === "done" || state === "completed") {
    return true;
  }
  if (typeof task.state === "number" && task.state === 2) return true;
  const status = String(task.status ?? "").toLowerCase();
  return /success|succeeded|done|completed|finish/.test(status);
}

async function listTaskEndpoint(endpoint: string): Promise<OpenListTaskListResult> {
  try {
    const payload = await openListGet<OpenListTask[] | { content?: OpenListTask[]; tasks?: OpenListTask[] }>(
      endpoint
    );
    if (Array.isArray(payload)) {
      return { tasks: payload.map(normalizeTask), available: true, error: null };
    }
    if (payload && typeof payload === "object") {
      const list = payload.content ?? payload.tasks ?? [];
      return {
        tasks: Array.isArray(list) ? list.map(normalizeTask) : [],
        available: true,
        error: null
      };
    }
    return { tasks: [], available: true, error: null };
  } catch (error) {
    return {
      tasks: [],
      available: false,
      error: errorMessage(error)
    };
  }
}

function normalizeTask(task: OpenListTask): OpenListTask {
  return {
    id: String(task.id ?? ""),
    name: String(task.name ?? ""),
    state: task.state,
    status: String(task.status ?? ""),
    progress: Number(task.progress ?? 0),
    error: String(task.error ?? "")
  };
}

function normalizeTaskState(state: number | string | undefined) {
  return String(state ?? "").toLowerCase();
}

export async function configure115TempDir(tempDir: string) {
  const settings = getSystemSettings();
  const endpoint =
    settings.openlist115Mode === "115 Open"
      ? "/api/admin/setting/set_115_open"
      : "/api/admin/setting/set_115";
  await openListRequest(endpoint, { temp_dir: tempDir });
}

export async function listOpenListFiles(path: string, options?: { refresh?: boolean }) {
  const payload = await openListRequest<{
    content?: Array<{
      name?: string;
      size?: number;
      is_dir?: boolean;
      modified?: string;
    }>;
  }>(
    "/api/fs/list",
    {
      path,
      page: 1,
      per_page: 0,
      refresh: options?.refresh ?? true
    },
    { retryable: true }
  );

  return (payload.content ?? []).map((entry): OpenListFileEntry => {
    const name = String(entry.name ?? "");
    return {
      path: joinRemotePath(path, name),
      name,
      isDirectory: Boolean(entry.is_dir),
      size: typeof entry.size === "number" ? entry.size : null,
      modified: entry.modified ?? null
    };
  });
}

export async function check115Connectivity(
  translate?: TranslateFn
): Promise<OpenList115CheckResult> {
  const t = translate ?? createT(getMessages("zh-CN"));
  const settings = getSystemSettings();
  const checks: OpenList115CheckResult["checks"] = [];
  let tools: string[] | null = null;

  try {
    const me = await openListGet<{ username?: string; role?: number }>("/api/me");
    checks.push({
      label: "OpenList API",
      ok: true,
      message: me.username
        ? t("check.tokenOkUser", { user: me.username })
        : t("check.tokenOk")
    });
  } catch (error) {
    checks.push({
      label: "OpenList API",
      ok: false,
      message: errorMessage(error)
    });
    return { ok: false, checks };
  }

  try {
    tools = await openListGet<string[]>("/api/public/offline_download_tools");
  } catch (error) {
    checks.push({
      label: t("check.accessMode"),
      ok: false,
      message: errorMessage(error)
    });
  }

  try {
    const pathCheck = await checkOpenListSavePath(
      settings.openlistIncomingPath,
      settings.openlist115Mode,
      t
    );
    const hasMode = tools?.includes(settings.openlist115Mode) ?? false;

    if (tools) {
      checks.push({
        label: t("check.accessMode"),
        ok: hasMode || pathCheck.providerMatchesMode,
        message: accessModeCheckMessage({
          mode: settings.openlist115Mode,
          tools,
          provider: pathCheck.provider,
          providerMatchesMode: pathCheck.providerMatchesMode,
          t
        })
      });
    }

    checks.push({
      label: t("check.incomingDir"),
      ok: pathCheck.ok,
      message: pathCheck.message
    });
  } catch (error) {
    if (tools) {
      const hasMode = tools.includes(settings.openlist115Mode);
      checks.push({
        label: t("check.accessMode"),
        ok: hasMode,
        message: accessModeCheckMessage({
          mode: settings.openlist115Mode,
          tools,
          providerMatchesMode: false,
          t
        })
      });
    }
    checks.push({
      label: t("check.incomingDir"),
      ok: false,
      message: savePathErrorMessage(settings.openlistIncomingPath, error, t)
    });
  }

  return {
    ok: checks.every((check) => check.ok),
    checks
  };
}

export async function ensureOpenListDirectory(path: string) {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 1) return;

  let current = joinRemotePath(parts[0]);
  for (const part of parts.slice(1)) {
    current = joinRemotePath(current, part);
    try {
      await openListRequest("/api/fs/mkdir", { path: current });
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }
    }
  }
}

export async function moveOpenListFiles(params: {
  srcDir: string;
  dstDir: string;
  names: string[];
  overwrite?: boolean;
}) {
  await ensureOpenListDirectory(params.dstDir);
  await openListRequest("/api/fs/move", {
    src_dir: params.srcDir,
    dst_dir: params.dstDir,
    names: params.names,
    overwrite: params.overwrite ?? false
  });
}

export async function removeOpenListFiles(params: {
  dir: string;
  names: string[];
}) {
  if (params.names.length === 0) return;
  await openListRequest("/api/fs/remove", {
    dir: params.dir,
    names: params.names
  });
}

export async function renameOpenListFile(params: {
  path: string;
  name: string;
  overwrite?: boolean;
}) {
  await openListRequest("/api/fs/rename", {
    path: params.path,
    name: params.name,
    overwrite: params.overwrite ?? false
  });
}

async function openListRequest<TData = unknown>(
  endpoint: string,
  body: Record<string, unknown>,
  options?: { retryable?: boolean }
): Promise<TData> {
  return openListFetch(
    endpoint,
    {
      method: "POST",
      body: JSON.stringify(body)
    },
    options
  );
}

async function openListGet<TData = unknown>(endpoint: string): Promise<TData> {
  return openListFetch(endpoint, { method: "GET" }, { retryable: true });
}

async function openListFetch<TData = unknown>(
  endpoint: string,
  init: RequestInit,
  options?: { retryable?: boolean }
): Promise<TData> {
  const settings = getSystemSettings();
  if (!settings.openlistBaseUrl) {
    throw new Error("OpenList base URL is not configured");
  }
  if (!settings.openlistToken) {
    throw new Error("OpenList token is not configured");
  }
  const baseUrl = parseOpenListBaseUrl(settings.openlistBaseUrl);

  const maxAttempts = options?.retryable ? OPENLIST_READ_MAX_RETRIES + 1 : 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        ...init,
        signal: AbortSignal.timeout(OPENLIST_REQUEST_TIMEOUT_MS),
        headers: {
          "Content-Type": "application/json",
          Authorization: settings.openlistToken,
          ...init.headers
        }
      });

      if (
        attempt < maxAttempts &&
        (response.status === 429 || response.status >= 500)
      ) {
        await sleep(OPENLIST_RETRY_BASE_MS * attempt);
        continue;
      }

      const payload = (await response.json().catch(() => null)) as
        | {
            code?: number;
            message?: string;
            data?: TData;
          }
        | null;

      if (!response.ok || payload?.code !== 200) {
        throw new Error(
          payload?.message ||
            `OpenList request ${endpoint} failed (${response.status})`
        );
      }

      return (payload.data ?? null) as TData;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts && isRetryableNetworkError(error)) {
        await sleep(OPENLIST_RETRY_BASE_MS * attempt);
        continue;
      }
      throw error;
    }
  }

  throw lastError;
}

function parseOpenListBaseUrl(raw: string) {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("OpenList base URL must be a valid http(s) URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("OpenList base URL must use http:// or https://");
  }
  return raw.replace(/\/+$/, "");
}

function isRetryableNetworkError(error: unknown) {
  if (!(error instanceof Error)) return false;
  if (error.name === "TimeoutError" || error.name === "AbortError") return true;
  if (error instanceof TypeError) return true;
  return /fetch failed|network|socket|econnreset|econnrefused|etimedout|offline/i.test(
    error.message
  );
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function checkOpenListSavePath(
  path: string,
  mode: "115 Cloud" | "115 Open",
  t: TranslateFn
) {
  const candidates = ancestorPaths(path);
  let lastError: unknown = null;

  for (const candidate of candidates) {
    try {
      const listResult = await openListRequest<{
        write?: boolean;
        provider?: string;
        content?: unknown[];
      }>(
        "/api/fs/list",
        {
          path: candidate,
          page: 1,
          per_page: 1,
          refresh: true
        },
        { retryable: true }
      );
      const getResult = await openListRequest<{
        provider?: string;
        is_dir?: boolean;
        mount_details?: { driver?: string; name?: string; type?: string };
      }>(
        "/api/fs/get",
        {
          path: candidate
        },
        { retryable: true }
      );
      const provider =
        getResult.mount_details?.driver ??
        getResult.mount_details?.type ??
        getResult.provider ??
        listResult.provider;
      const canWrite = Boolean(listResult.write);
      const providerMatchesMode = provider === mode;

      return {
        ok: canWrite && providerMatchesMode,
        provider,
        providerMatchesMode,
        message: openListPathCheckMessage({
          path,
          checkedPath: candidate,
          canWrite,
          provider,
          mode,
          providerMatchesMode,
          t
        })
      };
    } catch (error) {
      lastError = error;
      if (!isNotFoundError(error)) throw error;
    }
  }

  throw lastError ?? new Error("path is not under an accessible OpenList mount");
}

function accessModeCheckMessage(params: {
  mode: "115 Cloud" | "115 Open";
  tools: string[];
  provider?: string;
  providerMatchesMode: boolean;
  t: TranslateFn;
}) {
  const toolsText = params.tools.join(", ") || params.t("common.none");
  if (params.providerMatchesMode) {
    if (params.tools.includes(params.mode)) {
      return params.t("check.modeProviderReady", {
        provider: params.provider ?? params.mode,
        mode: params.mode
      });
    }
    return params.t("check.modeProviderPartial", {
      provider: params.provider ?? params.mode,
      mode: params.mode,
      tools: toolsText
    });
  }
  return params.t("check.modeMissing", {
    mode: params.mode,
    tools: toolsText
  });
}

function openListPathCheckMessage(params: {
  path: string;
  checkedPath: string;
  canWrite: boolean;
  provider?: string;
  mode: "115 Cloud" | "115 Open";
  providerMatchesMode: boolean;
  t: TranslateFn;
}) {
  const providerText = params.provider ? ` (Provider: ${params.provider})` : "";
  if (!params.canWrite) {
    return params.t("check.pathNoWrite", {
      checkedPath: params.checkedPath,
      provider: providerText
    });
  }
  if (!params.providerMatchesMode) {
    return params.t("check.pathModeMismatch", {
      checkedPath: params.checkedPath,
      provider: providerText,
      mode: params.mode
    });
  }
  if (params.checkedPath !== params.path) {
    return params.t("check.pathParentReady", {
      path: params.path,
      checkedPath: params.checkedPath,
      provider: providerText
    });
  }
  return params.t("check.pathReady", {
    path: params.path,
    provider: providerText
  });
}

function savePathErrorMessage(
  path: string,
  error: unknown,
  t: TranslateFn
) {
  const message = errorMessage(error);
  if (isNotFoundError(error)) {
    return t("check.pathNotFound", { path, message });
  }
  return message;
}

export function isOpenListNotFoundError(error: unknown) {
  return isNotFoundError(error);
}

function ancestorPaths(path: string) {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return ["/"];
  const paths: string[] = [];
  for (let index = parts.length; index > 0; index -= 1) {
    paths.push(`/${parts.slice(0, index).join("/")}`);
  }
  return paths;
}

function isNotFoundError(error: unknown) {
  return /not found|does not exist|object not found|failed get obj/i.test(
    errorMessage(error)
  );
}

/**
 * True only for positive "already exists" errors.
 * Must not match "does not exist" / "not found" (bare "exist" is unsafe).
 */
export function isAlreadyExistsErrorMessage(message: string) {
  if (/does\s+not\s+exist|not\s+found|找不到|不存在/i.test(message)) {
    return false;
  }
  return /already\s+exists|file\s+exists|object\s+exists|已存在|已经存在/i.test(
    message
  );
}

/**
 * True only for "URL already in offline list" style errors.
 * Must not match "does not exist" (bare "exist" / "already" are unsafe).
 *
 * OpenList / 115 common forms:
 * - code 10008 + "任务已存在，请勿输入重复的链接地址"
 * - "URL already in the offline list"
 */
export function isAlreadyInOfflineListErrorMessage(message: string) {
  if (/does\s+not\s+exist|not\s+found|找不到|不存在/i.test(message)) {
    return false;
  }
  return (
    /code\s*[:：]?\s*10008\b/i.test(message) ||
    /already\s+in\s+(the\s+)?offline/i.test(message) ||
    /in\s+the\s+offline\s+list/i.test(message) ||
    /duplicate\s+(url|task|download|link)/i.test(message) ||
    /task\s+url\s+already/i.test(message) ||
    /url\s+already\s+(exist|in)/i.test(message) ||
    /重复的链接/i.test(message) ||
    /任务已存在/i.test(message) ||
    /离线.*(已存在|重复|已在)/i.test(message) ||
    /(已存在|重复).*离线/i.test(message) ||
    /任务.*重复|重复.*任务/i.test(message)
  );
}

function isAlreadyExistsError(error: unknown) {
  return isAlreadyExistsErrorMessage(errorMessage(error));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
