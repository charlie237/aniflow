import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  extractBtih,
  extractMagnetDisplayName,
  torrentBufferToMagnet
} from "@/lib/torrent/magnet";

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

  it("extracts btih and display name from magnet URIs", () => {
    const hash = "a".repeat(40);
    expect(extractBtih(`magnet:?xt=urn:btih:${hash}&dn=show`)).toBe(hash);
    expect(
      extractMagnetDisplayName(`magnet:?xt=urn:btih:${hash}&dn=My%20Show`)
    ).toBe("My Show");
  });
});
