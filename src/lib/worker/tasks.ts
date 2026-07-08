import {
  claimNextWorkerTask,
  completeWorkerTask,
  failWorkerTask,
  requeueStaleWorkerTasks
} from "@/lib/db/repositories";
import type { WorkerTask } from "@/lib/db/types";
import {
  cleanupDeletedSubscriptionIncoming,
  type DeletedSubscriptionIncomingCleanup,
  pollAllSubscriptions,
  pollSubscription,
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
  requeueStaleWorkerTasks();
  let processed = 0;

  while (processed < maxTasks) {
    const task = claimNextWorkerTask();
    if (!task) break;

    try {
      await runWorkerTask(task);
      completeWorkerTask(task.id);
    } catch (error) {
      failWorkerTask(
        task.id,
        error instanceof Error ? error.message : String(error)
      );
    }
    processed += 1;
  }

  return { processed };
}

async function runWorkerTask(task: WorkerTask) {
  switch (task.type) {
    case "poll_all":
      await pollAllSubscriptions();
      break;
    case "poll_subscription":
      if (!task.subscriptionId) {
        throw new Error("Missing subscription id for poll task");
      }
      await pollSubscription(task.subscriptionId);
      break;
    case "cleanup_subscription_incoming":
      await cleanupDeletedSubscriptionIncoming(parseCleanupPayload(task.payloadJson));
      break;
    case "scan_incoming":
      await scanAndRenameIncoming();
      break;
    case "submit_queued":
      await submitQueuedJobs();
      await scanAndRenameIncoming();
      break;
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
