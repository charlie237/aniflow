import { describe, expect, it } from "vitest";
import { formatDateTime, formatFileSize } from "@/lib/utils";

describe("formatFileSize", () => {
  it("formats byte counts as file sizes", () => {
    expect(formatFileSize(1434723356)).toBe("1.34 GiB");
    expect(formatFileSize(1536)).toBe("1.5 KiB");
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(null)).toBe("-");
  });
});

describe("formatDateTime", () => {
  it("formats SQLite UTC timestamps in Asia/Shanghai time", () => {
    expect(formatDateTime("2026-07-08 10:21:56")).toBe("07/08 18:21");
    expect(formatDateTime(null)).toBe("从未");
  });
});
