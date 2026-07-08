"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function TablePagination({
  page,
  pageCount,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange
}: {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const safePageCount = Math.max(pageCount, 1);

  return (
    <div className="flex flex-col gap-2 border-t border-[var(--line)] pt-3 text-xs text-[var(--muted)] sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2">
        <span>
          共 <span className="data-digits text-[var(--foreground)]">{total}</span> 条
        </span>
        <select
          value={pageSize}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
          className="h-8 rounded-[var(--radius)] border border-[var(--line)] bg-white px-2 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--signal)]"
        >
          {[10, 20, 50].map((size) => (
            <option key={size} value={size}>
              {size} / 页
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <span className="data-digits">
          {Math.min(page + 1, safePageCount)} / {safePageCount}
        </span>
        <Button
          type="button"
          size="icon"
          variant="outline"
          disabled={page <= 0}
          onClick={() => onPageChange(Math.max(page - 1, 0))}
          aria-label="上一页"
        >
          <ChevronLeft className="size-4" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="outline"
          disabled={page >= safePageCount - 1}
          onClick={() => onPageChange(Math.min(page + 1, safePageCount - 1))}
          aria-label="下一页"
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
