import { request as httpRequest } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchText } from "@/lib/net/fetch";

vi.mock("node:http", () => ({
  request: vi.fn()
}));

vi.mock("@/lib/db/repositories", () => ({
  getSystemSettings: () => ({
    proxyEnabled: false,
    proxyUrl: "http://127.0.0.1:7890"
  })
}));

describe("fetchText", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("does not retry through the default local proxy when proxy is disabled", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("direct fetch failed"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchText("https://mikanani.me/RSS/Bangumi?bangumiId=1")
    ).rejects.toThrow(
      "direct fetch failed"
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(httpRequest).not.toHaveBeenCalled();
  });

  it("rejects non-Mikan RSS URLs before making a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchText("http://127.0.0.1/internal.xml")).rejects.toThrow(
      /Only Mikan RSS URLs/i
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(httpRequest).not.toHaveBeenCalled();
  });

  it("follows redirects within allowed Mikan hosts and blocks redirects to internal hosts", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://mikanime.tv/RSS/Bangumi?bangumiId=1" }
        })
      )
      .mockResolvedValueOnce(new Response("<rss />", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await fetchText("https://mikanani.me/RSS/Bangumi?bangumiId=1");
    expect(res).toEqual({ ok: true, status: 200, body: "<rss />" });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const evilRedirectMock = vi.fn().mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1:8080/secret" }
      })
    );
    vi.stubGlobal("fetch", evilRedirectMock);

    await expect(
      fetchText("https://mikanani.me/RSS/Bangumi?bangumiId=2")
    ).rejects.toThrow(/Only Mikan RSS URLs/i);
  });
});
