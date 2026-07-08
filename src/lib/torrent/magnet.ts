import { createHash } from "node:crypto";
import { fetchBytes } from "@/lib/net/fetch";

type BencodeValue = Buffer | number | BencodeList | BencodeDict;

interface BencodeList extends Array<BencodeValue> {}

interface BencodeDict {
  [key: string]: BencodeValue;
}

export async function resolveOfflineDownloadUrl(url: string) {
  if (url.startsWith("magnet:?")) return url;
  if (!looksLikeTorrentUrl(url)) return url;

  const response = await fetchBytes(url, {
    headers: {
      Accept: "application/x-bittorrent,*/*",
      "User-Agent": "Aniflow/0.1 torrent resolver"
    },
    timeoutMs: 30000
  });

  if (!response.ok) {
    throw new Error(`Torrent fetch failed (${response.status}) for ${url}`);
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
