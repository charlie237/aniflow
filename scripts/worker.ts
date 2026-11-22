import { closeSqlite } from "../src/lib/db/client";
import {
  enqueueWorkerTask,
  getSystemSettings,
  pruneOldWorkerTasks,
  touchWorkerHeartbeat
} from "../src/lib/db/repositories";
import { processWorkerTaskQueue } from "../src/lib/worker/tasks";

const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

let timer: ReturnType<typeof setTimeout> | null = null;
let activeTick: Promise<void> | null = null;
let shuttingDown = false;
let lastPrunedAt = 0;

async function tick() {
  if (activeTick || shuttingDown) return;
  const run = (async () => {
    touchWorkerHeartbeat();
    const startedAt = new Date();
    console.log(`[worker] tick ${startedAt.toISOString()}`);
    try {
      enqueueWorkerTask({ type: "poll_all" });
      const result = await processWorkerTaskQueue();
      maybePruneWorkerTasks();
      console.log(
        `[worker] tick done processed=${result.processed} duration_ms=${Date.now() - startedAt.getTime()}`
      );
    } catch (error) {
      console.error("[worker] tick failed", error);
    } finally {
      touchWorkerHeartbeat();
    }
  })();

  activeTick = run;
  try {
    await run;
  } finally {
    activeTick = null;
    if (!shuttingDown) {
      scheduleNext();
    }
  }
}

function maybePruneWorkerTasks() {
  const now = Date.now();
  if (now - lastPrunedAt < PRUNE_INTERVAL_MS) return;
  lastPrunedAt = now;
  try {
    const pruned = pruneOldWorkerTasks();
    if (pruned.totalDeleted > 0) {
      console.log(
        `[worker] pruned old worker_tasks routine=${pruned.routineDeleted} completed=${pruned.completedDeleted}`
      );
    }
  } catch (error) {
    console.error("[worker] prune old worker_tasks failed", error);
  }
}

function scheduleNext() {
  if (shuttingDown) return;
  if (timer) clearTimeout(timer);
  // Re-read settings each cycle so UI changes to workerIntervalSeconds take effect.
  const intervalMs = Math.max(getSystemSettings().workerIntervalSeconds, 30) * 1000;
  timer = setTimeout(() => {
    void tick();
  }, intervalMs);
}

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  console.log(`[worker] received ${signal}; shutting down gracefully`);
  if (activeTick) {
    console.log("[worker] waiting for active tick to finish");
    await activeTick;
  }
  closeSqlite();
  console.log("[worker] shutdown complete");
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

await tick();
