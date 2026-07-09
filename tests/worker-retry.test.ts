import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const tempDir = mkdtempSync(join(tmpdir(), "aniflow-retry-"));
const dbPath = join(tempDir, "retry.sqlite");
process.env.DATABASE_PATH = dbPath;

const { getSqlite } = await import("@/lib/db/client");
const {
  enqueueWorkerTask,
  failWorkerTask,
  getWorkerTask,
  requeueFailedWorkerTasks
} = await import("@/lib/db/repositories");

describe("requeueFailedWorkerTasks", () => {
  beforeAll(() => {
    getSqlite();
  });

  beforeEach(() => {
    getSqlite().exec("DELETE FROM worker_tasks");
  });

  afterAll(() => {
    try {
      getSqlite().close();
    } catch {
      // ignore
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("requeues failed tasks under the attempt limit after cooldown", () => {
    const task = enqueueWorkerTask({ type: "scan_incoming" });
    expect(task).toBeTruthy();
    if (!task) return;

    // Simulate a claimed+failed task with attempts=1 and finished in the past.
    getSqlite()
      .prepare(
        `UPDATE worker_tasks SET
          status = 'failed',
          attempts = 1,
          error_message = 'boom',
          finished_at = datetime('now', '-2 minutes'),
          updated_at = datetime('now', '-2 minutes')
         WHERE id = ?`
      )
      .run(task.id);

    const changes = requeueFailedWorkerTasks(3, 60);
    expect(changes).toBe(1);
    const requeued = getWorkerTask(task.id);
    expect(requeued?.status).toBe("queued");
    expect(requeued?.errorMessage).toContain("auto-retry");
  });

  it("does not requeue when attempts exhausted", () => {
    const task = enqueueWorkerTask({ type: "submit_queued" });
    if (!task) return;

    getSqlite()
      .prepare(
        `UPDATE worker_tasks SET
          status = 'failed',
          attempts = 3,
          finished_at = datetime('now', '-2 minutes'),
          updated_at = datetime('now', '-2 minutes')
         WHERE id = ?`
      )
      .run(task.id);

    expect(requeueFailedWorkerTasks(3, 60)).toBe(0);
    expect(getWorkerTask(task.id)?.status).toBe("failed");
  });

  it("skips requeue when an active task of the same type exists", () => {
    const failed = enqueueWorkerTask({ type: "poll_all" });
    if (!failed) return;
    failWorkerTask(failed.id, "network");
    getSqlite()
      .prepare(
        `UPDATE worker_tasks SET
          attempts = 1,
          finished_at = datetime('now', '-2 minutes'),
          updated_at = datetime('now', '-2 minutes')
         WHERE id = ?`
      )
      .run(failed.id);

    // New active poll_all
    const active = enqueueWorkerTask({ type: "poll_all" });
    expect(active?.status).toBe("queued");

    expect(requeueFailedWorkerTasks(3, 60)).toBe(0);
    expect(getWorkerTask(failed.id)?.status).toBe("failed");
  });
});
