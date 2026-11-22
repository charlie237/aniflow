import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const tempDir = mkdtempSync(join(tmpdir(), "aniflow-integrations-"));
process.env.DATABASE_PATH = join(tempDir, "integrations.sqlite");

const { getSqlite } = await import("@/lib/db/client");
const { getSystemSettings, saveSystemSettings } = await import(
  "@/lib/db/repositories"
);
const { sendNotification } = await import("@/lib/notifications/notifier");
const { triggerMediaServerRefresh } = await import(
  "@/lib/media-server/refresh"
);

describe("notifications and media server integrations", () => {
  beforeAll(() => {
    getSqlite();
  });

  beforeEach(() => {
    getSqlite().exec("DELETE FROM settings");
  });

  afterAll(() => {
    try {
      getSqlite().close();
    } catch {
      // ignore
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("dispatches notifications to enabled Webhook, Telegram, and Bark channels", async () => {
    saveSystemSettings({
      ...getSystemSettings(),
      webhookEnabled: true,
      webhookUrl: "https://hooks.example.com/aniflow",
      telegramEnabled: true,
      telegramBotToken: "123:bot-token",
      telegramChatId: "-10042",
      barkEnabled: true,
      barkServerUrl: "https://api.day.app",
      barkDeviceKey: "bark-key-xyz",
      notifyOnCompleted: true
    });

    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        calls.push({
          url: String(input),
          method: init?.method,
          body: init?.body ? String(init.body) : undefined
        });
        return new Response("ok", { status: 200 });
      })
    );

    try {
      const result = await sendNotification({
        type: "episode_completed",
        title: "Aniflow · Frieren S02E01",
        body: "/115/Anime/Frieren/Season 02/Frieren - S02E01.mkv"
      });
      expect(result.sent.sort()).toEqual(["bark", "telegram", "webhook"]);
      expect(result.failed).toEqual([]);
      expect(calls.map((call) => call.url).sort()).toEqual([
        "https://api.day.app/push",
        "https://api.telegram.org/bot123%3Abot-token/sendMessage",
        "https://hooks.example.com/aniflow"
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("skips notifications when event toggle is disabled and isolates channel failures", async () => {
    saveSystemSettings({
      ...getSystemSettings(),
      webhookEnabled: true,
      webhookUrl: "https://hooks.example.com/aniflow",
      notifyOnCompleted: false,
      notifyOnFailed: true
    });

    const fetchMock = vi.fn().mockResolvedValue(new Response("err", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const skipped = await sendNotification({
        type: "episode_completed",
        title: "Done",
        body: "ok"
      });
      expect(skipped).toEqual({ sent: [], failed: [] });
      expect(fetchMock).not.toHaveBeenCalled();

      const failed = await sendNotification({
        type: "job_failed",
        title: "Failed",
        body: "boom"
      });
      expect(failed.sent).toEqual([]);
      expect(failed.failed).toEqual([{ channel: "webhook", error: "HTTP 500" }]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("triggers Jellyfin, Emby, and Plex library refreshes", async () => {
    const calls: Array<{ url: string; method?: string; headers?: Record<string, string> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        calls.push({
          url: String(input),
          method: init?.method,
          headers: init?.headers as Record<string, string> | undefined
        });
        return new Response(null, { status: 204 });
      })
    );

    try {
      saveSystemSettings({
        ...getSystemSettings(),
        mediaServerType: "jellyfin",
        mediaServerUrl: "http://jellyfin.local:8096",
        mediaServerToken: "jf-key",
        mediaServerLibraryId: ""
      });
      expect(await triggerMediaServerRefresh()).toEqual({
        triggered: true,
        provider: "jellyfin"
      });
      expect(calls[0]).toMatchObject({
        url: "http://jellyfin.local:8096/Library/Refresh",
        method: "POST",
        headers: { "X-Emby-Token": "jf-key" }
      });

      saveSystemSettings({
        ...getSystemSettings(),
        mediaServerType: "plex",
        mediaServerUrl: "http://plex.local:32400",
        mediaServerToken: "plex-tok",
        mediaServerLibraryId: "2"
      });
      expect(await triggerMediaServerRefresh()).toEqual({
        triggered: true,
        provider: "plex"
      });
      expect(calls[1]).toMatchObject({
        url: "http://plex.local:32400/library/sections/2/refresh",
        method: "GET",
        headers: { "X-Plex-Token": "plex-tok" }
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
