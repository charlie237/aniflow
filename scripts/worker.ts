import { getSystemSettings } from "../src/lib/db/repositories";
import {
  pollAllSubscriptions,
  scanAndRenameIncoming,
  submitQueuedJobs
} from "../src/lib/worker/pipeline";

async function tick() {
  const startedAt = new Date();
  console.log(`[worker] tick ${startedAt.toISOString()}`);
  try {
    const result = await pollAllSubscriptions();
    await submitQueuedJobs();
    await scanAndRenameIncoming();
    console.log(
      `[worker] done discovered=${result.discovered} queued=${result.queued} skipped=${result.skipped} failed=${result.failed}`
    );
  } catch (error) {
    console.error("[worker] tick failed", error);
  }
}

await tick();
setInterval(
  tick,
  Math.max(getSystemSettings().workerIntervalSeconds, 30) * 1000
);
