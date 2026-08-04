import { describe, expect, it } from "vitest";
import type { WorkerTask } from "@/lib/db/types";
import {
  classifyWorkerTask,
  groupWorkerTasks
} from "@/lib/worker/task-presentation";

function task(
  id: number,
  result: Record<string, number> | null,
  overrides: Partial<WorkerTask> = {}
): WorkerTask {
  return {
    id,
    type: "poll_all",
    subscriptionId: null,
    status: "completed",
    phase: null,
    phaseDetail: null,
    progressCurrent: null,
    progressTotal: null,
    payloadJson: JSON.stringify(result ? { result } : {}),
    errorMessage: null,
    attempts: 1,
    createdAt: `2026-08-04 09:${id}:00`,
    startedAt: `2026-08-04 09:${id}:01`,
    finishedAt: `2026-08-04 09:${id}:02`,
    updatedAt: `2026-08-04 09:${id}:02`,
    ...overrides
  };
}

const quiet = {
  fetched: 451,
  discovered: 25,
  queued: 0,
  skipped: 451,
  failed: 0
};

describe("worker task presentation", () => {
  it("classifies only complete no-action poll results as routine", () => {
    expect(classifyWorkerTask(task(1, quiet))).toBe("routine");
    expect(classifyWorkerTask(task(2, { queued: 0, failed: 0 }))).toBe("other");
    expect(classifyWorkerTask(task(3, { ...quiet, queued: 1 }))).toBe("action");
    expect(classifyWorkerTask(task(4, { ...quiet, failed: 1 }))).toBe(
      "attention"
    );
  });

  it("folds only adjacent routine polls with the same target and result", () => {
    const items = groupWorkerTasks([
      task(6, quiet),
      task(5, quiet),
      task(4, { ...quiet, fetched: 486, discovered: 28, skipped: 486 }),
      task(3, quiet, { status: "failed" }),
      task(2, quiet),
      task(1, quiet)
    ]);

    expect(items).toHaveLength(4);
    expect(items[0]).toMatchObject({
      kind: "routine-group",
      category: "routine",
      tasks: [{ id: 6 }, { id: 5 }]
    });
    expect(items[1]).toMatchObject({ kind: "task", task: { id: 4 } });
    expect(items[2]).toMatchObject({
      kind: "task",
      category: "attention",
      task: { id: 3 }
    });
    expect(items[3]).toMatchObject({
      kind: "routine-group",
      tasks: [{ id: 2 }, { id: 1 }]
    });
  });

  it("keeps subscription targets in separate groups", () => {
    const items = groupWorkerTasks([
      task(3, quiet, { type: "poll_subscription", subscriptionId: 1 }),
      task(2, quiet, { type: "poll_subscription", subscriptionId: 2 }),
      task(1, quiet, { type: "poll_subscription", subscriptionId: 2 })
    ]);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: "task", task: { id: 3 } });
    expect(items[1]).toMatchObject({
      kind: "routine-group",
      tasks: [{ id: 2 }, { id: 1 }]
    });
  });

  it("does not fold separate SQL groups after server-side filtering", () => {
    const items = groupWorkerTasks([
      task(3, quiet, { displayGroupId: 1 }),
      task(1, quiet, { displayGroupId: 3 })
    ]);

    expect(items).toHaveLength(2);
    expect(items.every((item) => item.kind === "task")).toBe(true);
  });

  it("folds adjacent records even when deleted history left id gaps", () => {
    const items = groupWorkerTasks([
      task(33, quiet, { displayGroupId: 7 }),
      task(30, quiet, { displayGroupId: 7 }),
      task(28, quiet, { displayGroupId: 7 })
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "routine-group",
      tasks: [{ id: 33 }, { id: 30 }, { id: 28 }]
    });
  });

  it("folds an entire continuous run instead of stopping after two tasks", () => {
    const items = groupWorkerTasks([
      task(5, quiet),
      task(4, quiet),
      task(3, quiet),
      task(2, quiet),
      task(1, quiet)
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "routine-group",
      tasks: [{ id: 5 }, { id: 4 }, { id: 3 }, { id: 2 }, { id: 1 }]
    });
  });
});
