import type { WorkerTask, WorkerTaskCategory } from "@/lib/db/types";

export type { WorkerTaskCategory } from "@/lib/db/types";

export interface PollResultSummary {
  fetched: number;
  discovered: number;
  queued: number;
  skipped: number;
  failed: number;
}

export type WorkerTaskListItem =
  | {
      kind: "task";
      id: string;
      category: WorkerTaskCategory;
      task: WorkerTask;
    }
  | {
      kind: "routine-group";
      id: string;
      category: "routine";
      tasks: WorkerTask[];
      result: PollResultSummary;
    };

const POLL_TYPES = new Set<WorkerTask["type"]>([
  "poll_all",
  "poll_subscription"
]);

export function parsePollResult(task: WorkerTask): PollResultSummary | null {
  if (!POLL_TYPES.has(task.type)) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(task.payloadJson);
  } catch {
    return null;
  }

  if (!isRecord(payload) || !isRecord(payload.result)) return null;

  const result = payload.result;
  const values = [
    result.fetched,
    result.discovered,
    result.queued,
    result.skipped,
    result.failed
  ];
  if (!values.every(isFiniteNumber)) return null;

  return {
    fetched: result.fetched as number,
    discovered: result.discovered as number,
    queued: result.queued as number,
    skipped: result.skipped as number,
    failed: result.failed as number
  };
}

export function classifyWorkerTask(task: WorkerTask): WorkerTaskCategory {
  if (task.status === "failed") return "attention";
  if (task.status === "queued" || task.status === "running") return "active";

  const result = parsePollResult(task);
  if (result?.failed && result.failed > 0) return "attention";
  if (result && result.queued === 0 && result.failed === 0) return "routine";
  if (result && result.queued > 0) return "action";
  if (!POLL_TYPES.has(task.type)) return "action";
  return "other";
}

export function groupWorkerTasks(tasks: WorkerTask[]): WorkerTaskListItem[] {
  const items: WorkerTaskListItem[] = [];

  for (let index = 0; index < tasks.length; ) {
    const task = tasks[index];
    const result = parsePollResult(task);

    if (classifyWorkerTask(task) !== "routine" || !result) {
      items.push({
        kind: "task",
        id: `task-${task.id}`,
        category: classifyWorkerTask(task),
        task
      });
      index += 1;
      continue;
    }

    const routineTasks = [task];
    let nextIndex = index + 1;
    while (nextIndex < tasks.length) {
      const nextTask = tasks[nextIndex];
      const nextResult = parsePollResult(nextTask);
      const previousTask = routineTasks[routineTasks.length - 1];
      if (
        classifyWorkerTask(nextTask) !== "routine" ||
        !nextResult ||
        !sameRoutineRun(previousTask, result, nextTask, nextResult)
      ) {
        break;
      }
      routineTasks.push(nextTask);
      nextIndex += 1;
    }

    if (routineTasks.length === 1) {
      items.push({
        kind: "task",
        id: `task-${task.id}`,
        category: "routine",
        task
      });
    } else {
      items.push({
        kind: "routine-group",
        id: `routine-${routineTasks[0].id}-${routineTasks.at(-1)?.id}`,
        category: "routine",
        tasks: routineTasks,
        result
      });
    }

    index = nextIndex;
  }

  return items;
}

function sameRoutineRun(
  task: WorkerTask,
  result: PollResultSummary,
  nextTask: WorkerTask,
  nextResult: PollResultSummary
) {
  return (
    sameDisplayGroup(task, nextTask) &&
    task.type === nextTask.type &&
    task.subscriptionId === nextTask.subscriptionId &&
    result.fetched === nextResult.fetched &&
    result.discovered === nextResult.discovered &&
    result.queued === nextResult.queued &&
    result.skipped === nextResult.skipped &&
    result.failed === nextResult.failed
  );
}

function sameDisplayGroup(task: WorkerTask, nextTask: WorkerTask) {
  if (task.displayGroupId == null && nextTask.displayGroupId == null) return true;
  return task.displayGroupId === nextTask.displayGroupId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
