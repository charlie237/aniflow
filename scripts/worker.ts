import {
  enqueueWorkerTask,
  getSystemSettings,
  touchWorkerHeartbeat
} from "../src/lib/db/repositories";
import { processWorkerTaskQueue } from "../src/lib/worker/tasks";

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;

async function tick() {
  if (running) return;
  running = true;
  touchWorkerHeartbeat();
  const startedAt = new Date();
  console.log(`[worker] tick ${startedAt.toISOString()}`);
  try {
    enqueueWorkerTask({ type: "poll_all" });
    const result = await processWorkerTaskQueue();
    console.log(
      `[worker] tick done processed=${result.processed} duration_ms=${Date.now() - startedAt.getTime()}`
    );
  } catch (error) {
    console.error("[worker] tick failed", error);
  } finally {
    touchWorkerHeartbeat();
    running = false;
    scheduleNext();
  }
}

function scheduleNext() {
  if (timer) clearTimeout(timer);
  // Re-read settings each cycle so UI changes to workerIntervalSeconds take effect.
  const intervalMs = Math.max(getSystemSettings().workerIntervalSeconds, 30) * 1000;
  timer = setTimeout(() => {
    void tick();
  }, intervalMs);
}

await tick();
