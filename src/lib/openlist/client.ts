import { getSystemSettings } from "@/lib/db/repositories";
import { joinRemotePath } from "@/lib/utils/path";

export interface OpenListTask {
  id: string;
  name: string;
  state: number | string;
  status: string;
  progress: number;
  error: string;
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
  }>("/api/fs/list", {
    path,
    page: 1,
    per_page: 0,
    refresh: options?.refresh ?? true
  });

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

export async function check115Connectivity(): Promise<OpenList115CheckResult> {
  const settings = getSystemSettings();
  const checks: OpenList115CheckResult["checks"] = [];
  let tools: string[] | null = null;

  try {
    const me = await openListGet<{ username?: string; role?: number }>("/api/me");
    checks.push({
      label: "OpenList API",
      ok: true,
      message: me.username ? `Token 可用：${me.username}` : "Token 可用"
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
      label: "115 接入方式",
      ok: false,
      message: errorMessage(error)
    });
  }

  try {
    const pathCheck = await checkOpenListSavePath(
      settings.openlistIncomingPath,
      settings.openlist115Mode
    );
    const hasMode = tools?.includes(settings.openlist115Mode) ?? false;

    if (tools) {
      checks.push({
        label: "115 接入方式",
        ok: hasMode || pathCheck.providerMatchesMode,
        message: accessModeCheckMessage({
          mode: settings.openlist115Mode,
          tools,
          provider: pathCheck.provider,
          providerMatchesMode: pathCheck.providerMatchesMode
        })
      });
    }

    checks.push({
      label: "下载目录",
      ok: pathCheck.ok,
      message: pathCheck.message
    });
  } catch (error) {
    if (tools) {
      const hasMode = tools.includes(settings.openlist115Mode);
      checks.push({
        label: "115 接入方式",
        ok: hasMode,
        message: accessModeCheckMessage({
          mode: settings.openlist115Mode,
          tools,
          providerMatchesMode: false
        })
      });
    }
    checks.push({
      label: "下载目录",
      ok: false,
      message: savePathErrorMessage(settings.openlistIncomingPath, error)
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
  body: Record<string, unknown>
): Promise<TData> {
  return openListFetch(endpoint, {
    method: "POST",
    body: JSON.stringify(body)
  });
}

async function openListGet<TData = unknown>(endpoint: string): Promise<TData> {
  return openListFetch(endpoint, { method: "GET" });
}

async function openListFetch<TData = unknown>(
  endpoint: string,
  init: RequestInit
): Promise<TData> {
  const settings = getSystemSettings();
  if (!settings.openlistBaseUrl) {
    throw new Error("OpenList base URL is not configured");
  }
  if (!settings.openlistToken) {
    throw new Error("OpenList token is not configured");
  }

  const response = await fetch(`${settings.openlistBaseUrl}${endpoint}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: settings.openlistToken,
      ...init.headers
    }
  });

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
}

async function checkOpenListSavePath(
  path: string,
  mode: "115 Cloud" | "115 Open"
) {
  const candidates = ancestorPaths(path);
  let lastError: unknown = null;

  for (const candidate of candidates) {
    try {
      const listResult = await openListRequest<{
        write?: boolean;
        provider?: string;
        content?: unknown[];
      }>("/api/fs/list", {
        path: candidate,
        page: 1,
        per_page: 1,
        refresh: true
      });
      const getResult = await openListRequest<{
        provider?: string;
        is_dir?: boolean;
        mount_details?: { driver?: string; name?: string; type?: string };
      }>("/api/fs/get", {
        path: candidate
      });
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
          providerMatchesMode
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
}) {
  if (params.providerMatchesMode) {
    const readyText = params.tools.includes(params.mode)
      ? "OpenList ready 工具列表也包含该接入方式"
      : `ready 工具列表只返回：${params.tools.join(", ") || "无"}`;
    return `下载目录属于 ${params.provider} 挂载，可按 ${params.mode} 直接提交；${readyText}`;
  }
  return `OpenList ready 工具未包含 ${params.mode}，当前 ready 工具：${params.tools.join(", ") || "无"}；请确认下载目录属于对应 115 挂载，或点击检测同步 OpenList 后台配置`;
}

function openListPathCheckMessage(params: {
  path: string;
  checkedPath: string;
  canWrite: boolean;
  provider?: string;
  mode: "115 Cloud" | "115 Open";
  providerMatchesMode: boolean;
}) {
  const providerText = params.provider ? `，Provider: ${params.provider}` : "";
  if (!params.canWrite) {
    return `${params.checkedPath} 可访问，但当前用户没有写权限${providerText}`;
  }
  if (!params.providerMatchesMode) {
    return `${params.checkedPath} 可访问且可写${providerText}，但当前选择的是 ${params.mode}；下载目录必须位于对应的 115 挂载下`;
  }
  if (params.checkedPath !== params.path) {
    return `${params.path} 还不存在；父目录 ${params.checkedPath} 可访问且可写${providerText}，离线任务会尝试创建下载目录`;
  }
  return `${params.path} 可访问且可写${providerText}`;
}

function savePathErrorMessage(path: string, error: unknown) {
  const message = errorMessage(error);
  if (isNotFoundError(error)) {
    return `${path} 及其父目录在 OpenList 中不可访问：${message}。请确认第一段挂载名存在，例如 /115/Anime/_incoming 里的 /115 必须是 OpenList 里的 115 挂载`;
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

function isAlreadyExistsError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /already exists|exist|file exists|object exists/i.test(message);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
