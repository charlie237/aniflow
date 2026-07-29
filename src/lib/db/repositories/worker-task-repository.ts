import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { mapWorkerTask } from "@/lib/db/mappers";
import { workerTasks } from "@/lib/db/schema";
import type {
  WorkerTaskStatus,
  WorkerTaskType
} from "@/lib/db/types";

export function enqueueWorkerTask(input: {
  type: WorkerTaskType;
  subscriptionId?: number | null;
  payload?: Record<string, unknown>;
}) {
  const subscriptionId = input.subscriptionId ?? null;
  const payloadJson = JSON.stringify(input.payload ?? {});
  const dedupeKey =
    typeof input.payload?.dedupeKey === "string" ? input.payload.dedupeKey : null;
  const targetCondition = dedupeKey
    ? eq(workerTasks.payloadJson, payloadJson)
    : subscriptionId == null
      ? isNull(workerTasks.subscriptionId)
      : eq(workerTasks.subscriptionId, subscriptionId);

  const active = getDb()
    .select()
    .from(workerTasks)
    .where(
      and(
        eq(workerTasks.type, input.type),
        targetCondition,
        inArray(workerTasks.status, ["queued", "running"])
      )
    )
    .orderBy(desc(workerTasks.id))
    .limit(1)
    .get();

  if (active) {
    return mapWorkerTask(active as unknown as Record<string, unknown>);
  }

  const result = getDb()
    .insert(workerTasks)
    .values({ type: input.type, subscriptionId, payloadJson })
    .run();
  return getWorkerTask(Number(result.lastInsertRowid));
}

export function getWorkerTask(id: number) {
  const row = getDb().select().from(workerTasks).where(eq(workerTasks.id, id)).get();
  return row ? mapWorkerTask(row as unknown as Record<string, unknown>) : null;
}

export function listWorkerTasksByStatus(statuses: WorkerTaskStatus[]) {
  if (statuses.length === 0) return [];
  return getDb()
    .select()
    .from(workerTasks)
    .where(inArray(workerTasks.status, statuses))
    .orderBy(asc(workerTasks.createdAt), asc(workerTasks.id))
    .all()
    .map((row) => mapWorkerTask(row as unknown as Record<string, unknown>));
}

export function listWorkerTasks(limit = 200) {
  return getDb()
    .select()
    .from(workerTasks)
    .orderBy(desc(workerTasks.updatedAt), desc(workerTasks.id))
    .limit(limit)
    .all()
    .map((row) => mapWorkerTask(row as unknown as Record<string, unknown>));
}

export function claimNextWorkerTask() {
  return getDb().transaction((tx) => {
    const row = tx
      .select()
      .from(workerTasks)
      .where(eq(workerTasks.status, "queued"))
      .orderBy(asc(workerTasks.createdAt), asc(workerTasks.id))
      .limit(1)
      .get();
    if (!row) return null;

    const result = tx
      .update(workerTasks)
      .set({
        status: "running",
        attempts: sql`${workerTasks.attempts} + 1`,
        startedAt: sql`CURRENT_TIMESTAMP`,
        updatedAt: sql`CURRENT_TIMESTAMP`
      })
      .where(and(eq(workerTasks.id, row.id), eq(workerTasks.status, "queued")))
      .run();
    if (result.changes === 0) return null;

    const claimed = tx
      .select()
      .from(workerTasks)
      .where(eq(workerTasks.id, row.id))
      .get();
    return claimed
      ? mapWorkerTask(claimed as unknown as Record<string, unknown>)
      : null;
  });
}

export function completeWorkerTask(
  id: number,
  result?: Record<string, unknown>
) {
  const existing = getWorkerTask(id);
  const payload = mergeTaskPayload(existing?.payloadJson, {
    result: result ?? { ok: true },
    finishedAt: new Date().toISOString()
  });

  getDb()
    .update(workerTasks)
    .set({
      status: "completed",
      errorMessage: null,
      payloadJson: payload,
      finishedAt: sql`CURRENT_TIMESTAMP`,
      updatedAt: sql`CURRENT_TIMESTAMP`
    })
    .where(eq(workerTasks.id, id))
    .run();
}

export function failWorkerTask(
  id: number,
  errorMessage: string,
  result?: Record<string, unknown>
) {
  const existing = getWorkerTask(id);
  const payload = mergeTaskPayload(existing?.payloadJson, {
    result: result ?? { ok: false },
    error: errorMessage,
    finishedAt: new Date().toISOString()
  });

  getDb()
    .update(workerTasks)
    .set({
      status: "failed",
      errorMessage,
      payloadJson: payload,
      finishedAt: sql`CURRENT_TIMESTAMP`,
      updatedAt: sql`CURRENT_TIMESTAMP`
    })
    .where(eq(workerTasks.id, id))
    .run();
}

export function failStaleWorkerTasks(maxRunningSeconds = 1800) {
  const staleOffset = `-${Math.max(1, maxRunningSeconds)} seconds`;
  return getDb()
    .update(workerTasks)
    .set({
      status: "failed",
      errorMessage: "Worker task timed out; trigger it again manually",
      finishedAt: sql`CURRENT_TIMESTAMP`,
      updatedAt: sql`CURRENT_TIMESTAMP`
    })
    .where(
      and(
        eq(workerTasks.status, "running"),
        sql`datetime(${workerTasks.updatedAt}) < datetime('now', ${staleOffset})`
      )
    )
    .run().changes;
}

function mergeTaskPayload(
  existingJson: string | undefined,
  patch: Record<string, unknown>
) {
  let base: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(existingJson || "{}") as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      base = parsed as Record<string, unknown>;
    }
  } catch {
    base = {};
  }
  return JSON.stringify({ ...base, ...patch });
}
