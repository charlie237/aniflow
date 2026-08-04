import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const tempDir = mkdtempSync(join(tmpdir(), "aniflow-retry-"));
const dbPath = join(tempDir, "retry.sqlite");
process.env.DATABASE_PATH = dbPath;

const { getSqlite } = await import("@/lib/db/client");
const {
  acquireWorkerLease,
  enqueueWorkerTask,
  failStaleWorkerTasks,
  failWorkerTask,
  getWorkerTask,
  refreshWorkerLease,
  releaseWorkerLease,
  updateWorkerTaskProgress
} = await import("@/lib/db/repositories");
const { processWorkerTaskQueue } = await import("@/lib/worker/tasks");

describe("worker fail-stop and lease", () => {
  beforeAll(() => {
    getSqlite();
  });

  beforeEach(() => {
    getSqlite().exec("DELETE FROM worker_tasks");
    getSqlite().exec("DELETE FROM settings WHERE key LIKE 'workerLease:%'");
  });

  afterAll(() => {
    try {
      getSqlite().close();
    } catch {
      // ignore
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("leaves failed worker tasks stopped", async () => {
    const task = enqueueWorkerTask({ type: "scan_incoming" });
    expect(task).toBeTruthy();
    if (!task) return;

    failWorkerTask(task.id, "boom");
    await processWorkerTaskQueue(0);

    expect(getWorkerTask(task.id)).toMatchObject({
      status: "failed",
      errorMessage: "boom"
    });
  });

  it("fails stale running tasks instead of requeueing them", () => {
    const task = enqueueWorkerTask({ type: "submit_queued" });
    if (!task) return;
    getSqlite()
      .prepare(
        `UPDATE worker_tasks SET
          status = 'running',
          attempts = 1,
          updated_at = datetime('now', '-2 hours')
         WHERE id = ?`
      )
      .run(task.id);

    expect(failStaleWorkerTasks(60)).toBe(1);
    expect(getWorkerTask(task.id)).toMatchObject({
      status: "failed",
      errorMessage: "Worker task timed out; trigger it again manually"
    });
  });

  it("persists the running phase and refreshes task activity", () => {
    const task = enqueueWorkerTask({ type: "poll_all" });
    if (!task) return;
    getSqlite()
      .prepare("UPDATE worker_tasks SET status = 'running' WHERE id = ?")
      .run(task.id);

    updateWorkerTaskProgress(task.id, {
      phase: "fetching_rss",
      detail: "Example subscription",
      current: 2,
      total: 4
    });

    expect(getWorkerTask(task.id)).toMatchObject({
      status: "running",
      phase: "fetching_rss",
      phaseDetail: "Example subscription",
      progressCurrent: 2,
      progressTotal: 4
    });
  });

  it("allows only one process to hold an incoming mutation lease", () => {
    expect(acquireWorkerLease("incoming-mutation", "owner-a", 3600)).toBe(true);
    expect(acquireWorkerLease("incoming-mutation", "owner-b", 3600)).toBe(false);
    expect(refreshWorkerLease("incoming-mutation", "owner-b")).toBe(false);

    releaseWorkerLease("incoming-mutation", "owner-b");
    expect(acquireWorkerLease("incoming-mutation", "owner-b", 3600)).toBe(false);

    releaseWorkerLease("incoming-mutation", "owner-a");
    expect(acquireWorkerLease("incoming-mutation", "owner-b", 3600)).toBe(true);
  });
});
