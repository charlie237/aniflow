import { afterEach, describe, expect, it, vi } from "vitest";
import {
  add115OfflineDownload,
  configure115TempDir,
  isAlreadyExistsErrorMessage,
  isAlreadyInOfflineListErrorMessage,
  isOfflineTaskFailed,
  isOfflineTaskSucceeded,
  moveOpenListFiles,
  removeOpenListFiles
} from "@/lib/openlist/client";

const settingsMock = vi.hoisted(() => ({
  value: {
    openlistBaseUrl: "http://openlist.local",
    openlistToken: "token-1",
    openlist115Mode: "115 Cloud" as "115 Cloud" | "115 Open",
    openlistIncomingPath: "/115/Anime/_incoming",
    mediaLibraryRoot: "/115/Anime",
    seasonPathTemplate: "{title}/Season {season_pad}",
    episodeFileTemplate: "{title} - S{season_pad}E{episode_pad}.{ext}",
    replaceExistingOnRevision: true,
    proxyEnabled: false,
    proxyUrl: "http://127.0.0.1:7890",
    tmdbBearerToken: "",
    workerIntervalSeconds: 300,
    downloadTimeoutMinutes: 30,
    downloadAutoRetryEnabled: true,
    downloadAutoRetryMaxAttempts: 3,
    downloadAutoRetryCooldownMinutes: 10
  }
}));

vi.mock("@/lib/db/repositories", () => ({
  getSystemSettings: () => settingsMock.value
}));

describe("OpenList client", () => {
  afterEach(() => {
    settingsMock.value.openlist115Mode = "115 Cloud";
    vi.restoreAllMocks();
  });

  it("does not treat does-not-exist as already-exists", () => {
    expect(isAlreadyExistsErrorMessage("path does not exist")).toBe(false);
    expect(isAlreadyExistsErrorMessage("directory does not exist")).toBe(false);
    expect(isAlreadyExistsErrorMessage("object already exists")).toBe(true);
    expect(isAlreadyExistsErrorMessage("file already exists")).toBe(true);
  });

  it("does not treat path errors as already-in-offline-list", () => {
    expect(isAlreadyInOfflineListErrorMessage("path does not exist")).toBe(false);
    expect(isAlreadyInOfflineListErrorMessage("directory does not exist")).toBe(
      false
    );
    expect(isAlreadyInOfflineListErrorMessage("URL already in the offline list")).toBe(
      true
    );
    expect(isAlreadyInOfflineListErrorMessage("task url already exists")).toBe(true);
    expect(isAlreadyInOfflineListErrorMessage("离线任务已存在")).toBe(true);
  });

  it("submits RSS URLs through OpenList 115 offline download", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 200,
        data: {
          tasks: [{ id: "task-1", name: "episode", state: 0, status: "", progress: 0, error: "" }]
        }
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    const tasks = await add115OfflineDownload({
      urls: ["magnet:?xt=urn:btih:abc"],
      path: "/115/Anime/_incoming"
    });

    expect(tasks[0]?.id).toBe("task-1");
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://openlist.local/api/fs/add_offline_download",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          urls: ["magnet:?xt=urn:btih:abc"],
          path: "/115/Anime/_incoming",
          tool: "115 Cloud",
          delete_policy: "delete_never"
        })
      })
    );
  });

  it("configures 115 Open temp dir through OpenList admin settings", async () => {
    settingsMock.value.openlist115Mode = "115 Open";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 200, data: "ok" })
    });
    vi.stubGlobal("fetch", fetchMock);

    await configure115TempDir("/115/Anime/_incoming");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://openlist.local/api/admin/setting/set_115_open",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ temp_dir: "/115/Anime/_incoming" })
      })
    );
  });

  it("moves files with OpenList fs move", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 200, data: {} })
    });
    vi.stubGlobal("fetch", fetchMock);

    await moveOpenListFiles({
      srcDir: "/115/Anime/_incoming",
      dstDir: "/Anime/Show/Season 01",
      names: ["Show - S01E01.mkv"]
    });

    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://openlist.local/api/fs/move",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          src_dir: "/115/Anime/_incoming",
          dst_dir: "/Anime/Show/Season 01",
          names: ["Show - S01E01.mkv"],
          overwrite: false
        })
      })
    );
  });

  it("removes files with OpenList fs remove", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 200, data: {} })
    });
    vi.stubGlobal("fetch", fetchMock);

    await removeOpenListFiles({
      dir: "/115/Anime/_incoming",
      names: ["empty-folder"]
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://openlist.local/api/fs/remove",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          dir: "/115/Anime/_incoming",
          names: ["empty-folder"]
        })
      })
    );
  });

  it("classifies offline task failure and success states", () => {
    expect(
      isOfflineTaskFailed({
        id: "1",
        name: "a",
        state: 0,
        status: "",
        progress: 0,
        error: "quota exceeded"
      })
    ).toBe(true);
    expect(
      isOfflineTaskFailed({
        id: "2",
        name: "b",
        state: "failed",
        status: "",
        progress: 0,
        error: ""
      })
    ).toBe(true);
    expect(
      isOfflineTaskSucceeded({
        id: "3",
        name: "c",
        state: 2,
        status: "",
        progress: 100,
        error: ""
      })
    ).toBe(true);
    expect(
      isOfflineTaskSucceeded({
        id: "4",
        name: "d",
        state: 0,
        status: "running",
        progress: 10,
        error: ""
      })
    ).toBe(false);
  });
});
