import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { torrentBufferToMagnet } from "@/lib/torrent/magnet";

describe("torrentBufferToMagnet", () => {
  it("builds a magnet URI from torrent metadata", () => {
    const info = "d6:lengthi123e4:name11:episode.mkve";
    const torrent = Buffer.from(
      `d8:announce23:https://tracker.example13:announce-listll23:https://tracker.exampleel24:udp://tracker.example:80ee4:info${info}e`
    );

    const magnet = torrentBufferToMagnet(torrent);
    const infoHash = createHash("sha1").update(Buffer.from(info)).digest("hex");

    expect(magnet).toContain(`xt=urn:btih:${infoHash}`);
    expect(magnet).toContain("dn=episode.mkv");
    expect(magnet).toContain(`tr=${encodeURIComponent("https://tracker.example")}`);
    expect(magnet).toContain(
      `tr=${encodeURIComponent("udp://tracker.example:80")}`
    );
  });
});
