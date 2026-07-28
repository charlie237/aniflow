import { describe, expect, it } from "vitest";
import type { OpenListTask } from "@/lib/openlist/client";
import {
  findOfflineTaskForSource,
  offlineSourceKeys
} from "@/lib/openlist/offline-match";
import {
  extractBtih,
  extractMagnetDisplayName
} from "@/lib/torrent/magnet";

function task(partial: Partial<OpenListTask> & { id: string; name: string }): OpenListTask {
  return {
    state: 1,
    status: "running",
    progress: 10,
    error: "",
    ...partial
  };
}

describe("extractBtih / extractMagnetDisplayName", () => {
  it("parses hex btih from magnet", () => {
    const hash = "a".repeat(40);
    expect(extractBtih(`magnet:?xt=urn:btih:${hash}&dn=show`)).toBe(hash);
    expect(extractMagnetDisplayName(`magnet:?xt=urn:btih:${hash}&dn=My%20Show`)).toBe(
      "My Show"
    );
  });
});

describe("offlineSourceKeys", () => {
  it("includes btih and path forms", () => {
    const hash = "b".repeat(40);
    const keys = offlineSourceKeys(
      `magnet:?xt=urn:btih:${hash}&dn=episode`
    );
    expect(keys).toContain(hash);
    expect(keys.some((key) => key.includes("btih:"))).toBe(true);
  });
});

describe("findOfflineTaskForSource", () => {
  it("matches task name containing info hash", () => {
    const hash = "c".repeat(40);
    const tasks = [
      task({ id: "t1", name: `other-${"d".repeat(40)}` }),
      task({ id: "t2", name: `offline ${hash} done` })
    ];
    const found = findOfflineTaskForSource(
      tasks,
      `magnet:?xt=urn:btih:${hash}&dn=ep`
    );
    expect(found?.id).toBe("t2");
  });

  it("matches mikan download URL path in task name", () => {
    const url =
      "https://mikanani.me/Download/20260701/abcdef1234567890abcdef1234567890abcdef12.torrent";
    const tasks = [
      task({
        id: "t9",
        name: "https://mikanani.me/Download/20260701/abcdef1234567890abcdef1234567890abcdef12.torrent"
      })
    ];
    expect(findOfflineTaskForSource(tasks, url)?.id).toBe("t9");
  });

  it("returns null when nothing matches", () => {
    const tasks = [task({ id: "t1", name: "unrelated task" })];
    expect(
      findOfflineTaskForSource(tasks, `magnet:?xt=urn:btih:${"e".repeat(40)}`)
    ).toBeNull();
  });

  it("refuses to bind when two tasks share the same top score", () => {
    const hash = "f".repeat(40);
    const tasks = [
      task({ id: "t-old", name: `magnet:?xt=urn:btih:${hash}` }),
      task({ id: "t-10008", name: `magnet:?xt=urn:btih:${hash}` })
    ];
    expect(
      findOfflineTaskForSource(tasks, `magnet:?xt=urn:btih:${hash}&dn=ep`)
    ).toBeNull();
  });
});

