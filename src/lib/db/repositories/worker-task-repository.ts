import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb, getSqlite } from "@/lib/db/client";
import { mapWorkerTask } from "@/lib/db/mappers";
import { workerTasks } from "@/lib/db/schema";
import type {
  DashboardWorkerTaskPage,
  WorkerTaskCategory,
  WorkerTaskPhase,
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

export function getWorkerTaskPage(input: {
  category: "all" | WorkerTaskCategory;
  page: number;
  pageSize: number;
}): DashboardWorkerTaskPage {
  const sqlite = getSqlite();
  const countRow = sqlite
    .prepare(
      `${WORKER_TASK_GROUP_CTE}
       SELECT
         COUNT(*) AS all_count,
         COALESCE(SUM(category = 'active'), 0) AS active_count,
         COALESCE(SUM(category = 'attention'), 0) AS attention_count,
         COALESCE(SUM(category = 'action'), 0) AS action_count,
         COALESCE(SUM(category = 'routine'), 0) AS routine_count,
         COALESCE(SUM(category = 'other'), 0) AS other_count
       FROM classified`
    )
    .get() as Record<string, number> | undefined;
  const counts: DashboardWorkerTaskPage["counts"] = {
    all: Number(countRow?.all_count ?? 0),
    active: Number(countRow?.active_count ?? 0),
    attention: Number(countRow?.attention_count ?? 0),
    action: Number(countRow?.action_count ?? 0),
    routine: Number(countRow?.routine_count ?? 0),
    other: Number(countRow?.other_count ?? 0)
  };
  const categoryWhere = input.category === "all" ? "1 = 1" : "category = ?";
  const categoryParams = input.category === "all" ? [] : [input.category];
  const groupCountRow = sqlite
    .prepare(
      `${WORKER_TASK_GROUP_CTE}
       SELECT COUNT(*) AS group_count, COALESCE(SUM(task_count), 0) AS task_count
       FROM (
         SELECT group_no, COUNT(*) AS task_count
         FROM grouped
         WHERE ${categoryWhere}
         GROUP BY group_no
       )`
    )
    .get(...categoryParams) as Record<string, number> | undefined;
  const total = Number(groupCountRow?.group_count ?? 0);
  const taskTotal = Number(groupCountRow?.task_count ?? 0);
  const pageSize = Math.max(1, Math.min(100, input.pageSize));
  const pageCount = Math.ceil(total / pageSize);
  const page = Math.min(Math.max(1, input.page), Math.max(1, pageCount));
  const rows = sqlite
    .prepare(
      `${WORKER_TASK_GROUP_CTE},
       selected_groups AS (
         SELECT group_no
         FROM grouped
         WHERE ${categoryWhere}
         GROUP BY group_no
         ORDER BY group_no
         LIMIT ? OFFSET ?
       )
       SELECT grouped.*
       FROM grouped
       INNER JOIN selected_groups USING (group_no)
       ORDER BY grouped.group_no, grouped.updated_at DESC, grouped.id DESC`
    )
    .all(...categoryParams, pageSize, (page - 1) * pageSize)
    .map((row) => {
      const record = row as unknown as Record<string, unknown>;
      return {
        ...mapWorkerTask(record),
        displayGroupId: Number(record.group_no)
      };
    });

  return {
    rows,
    total,
    taskTotal,
    page,
    pageSize,
    pageCount,
    filters: { category: input.category },
    counts
  };
}

const WORKER_TASK_CATEGORY_SQL = `CASE
  WHEN status = 'failed' THEN 'attention'
  WHEN status IN ('queued', 'running') THEN 'active'
  WHEN type IN ('poll_all', 'poll_subscription')
    AND json_valid(payload_json) = 1
    AND json_type(payload_json, '$.result.fetched') IN ('integer', 'real')
    AND json_type(payload_json, '$.result.discovered') IN ('integer', 'real')
    AND json_type(payload_json, '$.result.queued') IN ('integer', 'real')
    AND json_type(payload_json, '$.result.skipped') IN ('integer', 'real')
    AND json_type(payload_json, '$.result.failed') IN ('integer', 'real')
    AND CAST(json_extract(payload_json, '$.result.failed') AS REAL) > 0
    THEN 'attention'
  WHEN type IN ('poll_all', 'poll_subscription')
    AND json_valid(payload_json) = 1
    AND json_type(payload_json, '$.result.fetched') IN ('integer', 'real')
    AND json_type(payload_json, '$.result.discovered') IN ('integer', 'real')
    AND json_type(payload_json, '$.result.queued') IN ('integer', 'real')
    AND json_type(payload_json, '$.result.skipped') IN ('integer', 'real')
    AND json_type(payload_json, '$.result.failed') IN ('integer', 'real')
    AND CAST(json_extract(payload_json, '$.result.queued') AS REAL) = 0
    AND CAST(json_extract(payload_json, '$.result.failed') AS REAL) = 0
    THEN 'routine'
  WHEN type IN ('poll_all', 'poll_subscription')
    AND json_valid(payload_json) = 1
    AND json_type(payload_json, '$.result.fetched') IN ('integer', 'real')
    AND json_type(payload_json, '$.result.discovered') IN ('integer', 'real')
    AND json_type(payload_json, '$.result.queued') IN ('integer', 'real')
    AND json_type(payload_json, '$.result.skipped') IN ('integer', 'real')
    AND json_type(payload_json, '$.result.failed') IN ('integer', 'real')
    AND CAST(json_extract(payload_json, '$.result.queued') AS REAL) > 0
    THEN 'action'
  WHEN type NOT IN ('poll_all', 'poll_subscription') THEN 'action'
  ELSE 'other'
END`;

const WORKER_TASK_GROUP_CTE = `WITH classified AS (
  SELECT
    worker_tasks.*,
    ${WORKER_TASK_CATEGORY_SQL} AS category,
    json_extract(payload_json, '$.result.fetched') AS result_fetched,
    json_extract(payload_json, '$.result.discovered') AS result_discovered,
    json_extract(payload_json, '$.result.queued') AS result_queued,
    json_extract(payload_json, '$.result.skipped') AS result_skipped,
    json_extract(payload_json, '$.result.failed') AS result_failed
  FROM worker_tasks
), sequenced AS (
  SELECT
    classified.*,
    LAG(type) OVER task_order AS previous_type,
    LAG(subscription_id) OVER task_order AS previous_subscription_id,
    LAG(category) OVER task_order AS previous_category,
    LAG(result_fetched) OVER task_order AS previous_fetched,
    LAG(result_discovered) OVER task_order AS previous_discovered,
    LAG(result_queued) OVER task_order AS previous_queued,
    LAG(result_skipped) OVER task_order AS previous_skipped,
    LAG(result_failed) OVER task_order AS previous_failed
  FROM classified
  WINDOW task_order AS (ORDER BY updated_at DESC, id DESC)
), boundaries AS (
  SELECT
    sequenced.*,
    CASE WHEN
      category = 'routine'
      AND previous_category = 'routine'
      AND previous_type = type
      AND previous_subscription_id IS subscription_id
      AND previous_fetched = result_fetched
      AND previous_discovered = result_discovered
      AND previous_queued = result_queued
      AND previous_skipped = result_skipped
      AND previous_failed = result_failed
    THEN 0 ELSE 1 END AS starts_group
  FROM sequenced
), grouped AS (
  SELECT
    boundaries.*,
    SUM(starts_group) OVER (
      ORDER BY updated_at DESC, id DESC
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS group_no
  FROM boundaries
)`;

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
        phase: "starting",
        phaseDetail: null,
        progressCurrent: null,
        progressTotal: null,
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

export function updateWorkerTaskProgress(
  id: number,
  progress: {
    phase: WorkerTaskPhase;
    detail?: string | null;
    current?: number | null;
    total?: number | null;
  }
) {
  getDb()
    .update(workerTasks)
    .set({
      phase: progress.phase,
      phaseDetail: progress.detail ?? null,
      progressCurrent: progress.current ?? null,
      progressTotal: progress.total ?? null,
      updatedAt: sql`CURRENT_TIMESTAMP`
    })
    .where(and(eq(workerTasks.id, id), eq(workerTasks.status, "running")))
    .run();
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
      phase: null,
      phaseDetail: null,
      progressCurrent: null,
      progressTotal: null,
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
