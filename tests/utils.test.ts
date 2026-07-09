import { describe, expect, it } from "vitest";
import { formatDateTime, formatFileSize } from "@/lib/utils";
import { parseToUtcDate, toStoredUtcIso } from "@/lib/time";

describe("formatFileSize", () => {
  it("formats byte counts as file sizes", () => {
    expect(formatFileSize(1434723356)).toBe("1.34 GiB");
    expect(formatFileSize(1536)).toBe("1.5 KiB");
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(null)).toBe("-");
  });
});

describe("formatDateTime / time helpers", () => {
  it("formats SQLite UTC timestamps in Asia/Shanghai time", () => {
    expect(formatDateTime("2026-07-08 10:21:56")).toBe("07/08 18:21");
    expect(formatDateTime(null)).toBe("从未");
  });

  it("treats Mikan naive ISO as Asia/Shanghai wall time", () => {
    // 10:01 China → 02:01 UTC → display 10:01 Shanghai
    expect(toStoredUtcIso("2026-07-09T10:01:02.806")).toBe(
      "2026-07-09T02:01:02.806Z"
    );
    expect(formatDateTime("2026-07-09T02:01:02.806Z")).toBe("07/09 10:01");
  });

  it("does not double-shift explicit UTC ISO", () => {
    expect(formatDateTime("2026-07-09T04:13:59.000Z")).toBe("07/09 12:13");
    expect(parseToUtcDate("2026-07-09T04:13:59.000Z").toISOString()).toBe(
      "2026-07-09T04:13:59.000Z"
    );
  });

  it("parses RFC 2822 GMT pubDate", () => {
    const iso = toStoredUtcIso("Tue, 07 Jul 2026 12:00:00 GMT");
    expect(iso).toBe("2026-07-07T12:00:00.000Z");
    expect(formatDateTime(iso)).toBe("07/07 20:00");
  });
});
