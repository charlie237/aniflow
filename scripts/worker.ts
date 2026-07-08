import {
  enqueueWorkerTask,
  getSystemSettings,
  touchWorkerHeartbeat
} from "../src/lib/db/repositories";
import { processWorkerTaskQueue } from "../src/lib/worker/tasks";

async function tick() {
  touchWorkerHeartbeat();
  const startedAt = new Date();
  console.log(`[worker] tick ${startedAt.toISOString()}`);
  try {
    enqueueWorkerTask({ type: "poll_all" });
    const result = await processWorkerTaskQueue();
    console.log(`[worker] processed=${result.processed}`);
  } catch (error) {
    console.error("[worker] tick failed", error);
  } finally {
    touchWorkerHeartbeat();
  }
}

await tick();
setInterval(
  tick,
  Math.max(getSystemSettings().workerIntervalSeconds, 30) * 1000
);
