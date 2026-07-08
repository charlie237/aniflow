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

    await expect(fetchText("https://example.invalid/rss.xml")).rejects.toThrow(
      "direct fetch failed"
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(httpRequest).not.toHaveBeenCalled();
  });
});
