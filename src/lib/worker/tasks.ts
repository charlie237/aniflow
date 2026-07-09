import {
  claimNextWorkerTask,
  completeWorkerTask,
  failWorkerTask,
  requeueFailedWorkerTasks,
  requeueStaleWorkerTasks
} from "@/lib/db/repositories";
import type { WorkerTask } from "@/lib/db/types";
import {
  cleanupDeletedSubscriptionIncoming,
  type DeletedSubscriptionIncomingCleanup,
  pollAllSubscriptions,
  pollSubscription,
  reconcileDownloadingJobs,
  scanAndRenameIncoming,
  submitQueuedJobs
} from "@/lib/worker/pipeline";

let activeRunner: Promise<unknown> | null = null;
let runnerTimer: NodeJS.Timeout | null = null;

export function kickWorkerTaskRunner() {
  if (activeRunner || runnerTimer) return;
  runnerTimer = setTimeout(() => {
    runnerTimer = null;
    activeRunner = processWorkerTaskQueue()
      .catch((error) => {
        console.error("[worker] task runner failed", error);
      })
      .finally(() => {
        activeRunner = null;
      });
  }, 0);
  runnerTimer.unref?.();
}

export async function processWorkerTaskQueue(maxTasks = 20) {
  const stale = requeueStaleWorkerTasks();
  const retried = requeueFailedWorkerTasks();
  if (stale > 0 || retried > 0) {
    console.log(
      `[worker] requeue stale=${stale} failed_tasks=${retried}`
    );
  }

  let processed = 0;

  while (processed < maxTasks) {
    const task = claimNextWorkerTask();
    if (!task) break;

    const label = `task#${task.id} ${task.type}`;
    console.log(`[worker] ${label} start attempts=${task.attempts}`);
    try {
      const result = await runWorkerTask(task);
      completeWorkerTask(task.id, result ?? { ok: true });
      console.log(
        `[worker] ${label} ok ${summarizeResult(result)}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failWorkerTask(task.id, message, { ok: false, error: message });
      console.error(`[worker] ${label} fail: ${message}`);
    }
    processed += 1;
  }

  return { processed };
}

async function runWorkerTask(
  task: WorkerTask
): Promise<Record<string, unknown> | void> {
  switch (task.type) {
    case "poll_all":
      return (await pollAllSubscriptions()) as unknown as Record<string, unknown>;
    case "poll_subscription":
      if (!task.subscriptionId) {
        throw new Error("Missing subscription id for poll task");
      }
      return (await pollSubscription(
        task.subscriptionId
      )) as unknown as Record<string, unknown>;
    case "cleanup_subscription_incoming":
      return (await cleanupDeletedSubscriptionIncoming(
        parseCleanupPayload(task.payloadJson)
      )) as unknown as Record<string, unknown>;
    case "scan_incoming":
      await reconcileDownloadingJobs();
      await scanAndRenameIncoming();
      return { ok: true, action: "scan_incoming" };
    case "submit_queued":
      await submitQueuedJobs();
      await reconcileDownloadingJobs();
      await scanAndRenameIncoming();
      return { ok: true, action: "submit_queued" };
  }
}

function summarizeResult(result: Record<string, unknown> | void) {
  if (!result) return "";
  try {
    return JSON.stringify(result);
  } catch {
    return "";
  }
}

function parseCleanupPayload(payloadJson: string): DeletedSubscriptionIncomingCleanup {
  const payload = JSON.parse(payloadJson) as {
    subscriptionName?: unknown;
    incomingPath?: unknown;
    rules?: Array<{
      type?: unknown;
      value?: unknown;
      enabled?: unknown;
    }>;
  };
  if (
    typeof payload.subscriptionName !== "string" ||
    typeof payload.incomingPath !== "string"
  ) {
    throw new Error("Invalid cleanup subscription payload");
  }

  return {
    subscriptionName: payload.subscriptionName,
    incomingPath: payload.incomingPath,
    rules: (payload.rules ?? [])
      .filter((rule) => typeof rule.type === "string" && typeof rule.value === "string")
      .map((rule) => ({
        type: rule.type as DeletedSubscriptionIncomingCleanup["rules"][number]["type"],
        value: String(rule.value),
        enabled: rule.enabled !== false
      }))
  };
}
