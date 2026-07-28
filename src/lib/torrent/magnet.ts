import { createHash } from "node:crypto";
import { fetchBytes } from "@/lib/net/fetch";
import { assertMikanDownloadUrl } from "@/lib/net/url-policy";

type BencodeValue = Buffer | number | BencodeList | BencodeDict;

interface BencodeList extends Array<BencodeValue> {}

interface BencodeDict {
  [key: string]: BencodeValue;
}

export async function resolveOfflineDownloadUrl(url: string) {
  if (url.startsWith("magnet:?")) return url;
  const targetUrl = assertMikanDownloadUrl(url).toString();
  if (!looksLikeTorrentUrl(targetUrl)) return targetUrl;

  const response = await fetchBytes(targetUrl, {
    headers: {
      Accept: "application/x-bittorrent,*/*",
      "User-Agent": "Aniflow/0.1 torrent resolver"
    },
    timeoutMs: 30000
  });

  if (!response.ok) {
    throw new Error(`Torrent fetch failed (${response.status}) for ${targetUrl}`);
  }

  return torrentBufferToMagnet(response.body);
}

export function torrentBufferToMagnet(buffer: Buffer) {
  const torrent = parseTorrent(buffer);
  const infoHash = createHash("sha1").update(torrent.infoBytes).digest("hex");
  const params = [`xt=urn:btih:${infoHash}`];

  if (torrent.name) {
    params.push(`dn=${encodeURIComponent(torrent.name)}`);
  }

  for (const tracker of torrent.trackers) {
    params.push(`tr=${encodeURIComponent(tracker)}`);
  }

  return `magnet:?${params.join("&")}`;
}

/** Hex info-hash from a magnet URI or any string containing urn:btih / bare 40-hex. */
export function extractBtih(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const text = value.trim();

  const urn = text.match(/urn:btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})\b/i);
  if (urn?.[1]) return normalizeBtih(urn[1]);

  const bareHex = text.match(/\b([a-fA-F0-9]{40})\b/);
  if (bareHex?.[1]) return bareHex[1].toLowerCase();

  return null;
}

/** Display name from magnet `dn=` parameter, if present. */
export function extractMagnetDisplayName(
  value: string | null | undefined
): string | null {
  if (!value?.trim()) return null;
  const match = value.match(/[?&]dn=([^&]+)/i);
  if (!match?.[1]) return null;
  try {
    const decoded = decodeURIComponent(match[1].replace(/\+/g, " ")).trim();
    return decoded || null;
  } catch {
    return match[1].trim() || null;
  }
}

function normalizeBtih(value: string) {
  const raw = value.trim();
  if (/^[a-fA-F0-9]{40}$/.test(raw)) return raw.toLowerCase();
  // Base32 info-hashes (v1 magnets) — keep lowercased form for substring match.
  if (/^[a-zA-Z2-7]{32}$/.test(raw)) return raw.toLowerCase();
  return raw.toLowerCase();
}

function looksLikeTorrentUrl(url: string) {
  return /\.torrent(?:[?#]|$)/i.test(url) || /mikanani\.me\/Download\//i.test(url);
}

function parseTorrent(buffer: Buffer) {
  const reader = new BencodeReader(buffer);
  const root = reader.readRootDict();
  const infoBytes = reader.infoBytes;
  if (!infoBytes) {
    throw new Error("Invalid torrent file: missing info dictionary");
  }

  const info = asDict(root.info);
  const name =
    bufferToString(info?.["name.utf-8"]) ??
    bufferToString(info?.name) ??
    null;
  const trackers = uniqueStrings([
    bufferToString(root.announce),
    ...flattenAnnounceList(root["announce-list"])
  ]);

  return {
    infoBytes,
    name,
    trackers
  };
}

class BencodeReader {
  offset = 0;
  infoBytes: Buffer | null = null;

  constructor(private readonly buffer: Buffer) {}

  readRootDict() {
    const value = this.readValue("root");
    const dict = asDict(value);
    if (!dict) throw new Error("Invalid torrent file: root is not a dictionary");
    if (this.offset !== this.buffer.length) {
      throw new Error("Invalid torrent file: trailing bytes");
    }
    return dict;
  }

  private readValue(parentKey?: string): BencodeValue {
    const byte = this.currentByte();
    if (byte === 0x64) return this.readDict(parentKey);
    if (byte === 0x6c) return this.readList();
    if (byte === 0x69) return this.readInteger();
    if (byte >= 0x30 && byte <= 0x39) return this.readBytes();
    throw new Error(`Invalid bencode value at offset ${this.offset}`);
  }

  private readDict(parentKey?: string) {
    this.expectByte(0x64);
    const dict: Record<string, BencodeValue> = {};

    while (this.currentByte() !== 0x65) {
      const key = this.readBytes().toString("utf8");
      const valueStart = this.offset;
      const value = this.readValue(key);
      if (parentKey === "root" && key === "info") {
        this.infoBytes = this.buffer.subarray(valueStart, this.offset);
      }
      dict[key] = value;
    }

    this.expectByte(0x65);
    return dict;
  }

  private readList() {
    this.expectByte(0x6c);
    const values: BencodeValue[] = [];
    while (this.currentByte() !== 0x65) {
      values.push(this.readValue());
    }
    this.expectByte(0x65);
    return values;
  }

  private readInteger() {
    this.expectByte(0x69);
    const end = this.buffer.indexOf(0x65, this.offset);
    if (end < 0) throw new Error("Invalid bencode integer: missing terminator");
    const raw = this.buffer.subarray(this.offset, end).toString("ascii");
    this.offset = end + 1;
    const value = Number(raw);
    if (!Number.isSafeInteger(value)) {
      throw new Error(`Invalid bencode integer: ${raw}`);
    }
    return value;
  }

  private readBytes() {
    const colon = this.buffer.indexOf(0x3a, this.offset);
    if (colon < 0) throw new Error("Invalid bencode string: missing colon");
    const rawLength = this.buffer.subarray(this.offset, colon).toString("ascii");
    const length = Number(rawLength);
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new Error(`Invalid bencode string length: ${rawLength}`);
    }

    const start = colon + 1;
    const end = start + length;
    if (end > this.buffer.length) {
      throw new Error("Invalid bencode string: length exceeds buffer");
    }
    this.offset = end;
    return this.buffer.subarray(start, end);
  }

  private currentByte() {
    if (this.offset >= this.buffer.length) {
      throw new Error("Unexpected end of bencode data");
    }
    return this.buffer[this.offset];
  }

  private expectByte(byte: number) {
    if (this.currentByte() !== byte) {
      throw new Error(`Invalid bencode data at offset ${this.offset}`);
    }
    this.offset += 1;
  }
}

function asDict(value: BencodeValue | undefined) {
  return value && !Buffer.isBuffer(value) && !Array.isArray(value) && typeof value === "object"
    ? value
    : null;
}

function bufferToString(value: BencodeValue | undefined) {
  return Buffer.isBuffer(value) ? value.toString("utf8").trim() || null : null;
}

function flattenAnnounceList(value: BencodeValue | undefined) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((tier) => {
    if (Buffer.isBuffer(tier)) return [tier.toString("utf8")];
    if (!Array.isArray(tier)) return [];
    return tier
      .filter((entry): entry is Buffer => Buffer.isBuffer(entry))
      .map((entry) => entry.toString("utf8"));
  });
}

function uniqueStrings(values: Array<string | null>) {
  return [...new Set(values.map((value) => value?.trim()).filter(Boolean))] as string[];
}
