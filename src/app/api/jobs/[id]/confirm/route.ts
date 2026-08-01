import { NextResponse } from "next/server";
import { getJob } from "@/lib/db/repositories";
import { confirmJob } from "@/lib/worker/pipeline";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const jobId = Number(id);
  if (!Number.isInteger(jobId) || jobId <= 0) {
    return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
  }
  const job = getJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  const json = await request.json().catch(() => null);
  const force = Boolean((json as { force?: unknown } | null)?.force);
  if (
    !["discovered", "needs_review"].includes(job.status) &&
    !(force && job.status === "skipped")
  ) {
    return NextResponse.json(
      {
        error: `Only discovered, needs_review, or skipped (with force) jobs can be confirmed (current: ${job.status})`
      },
      { status: 409 }
    );
  }

  try {
    await confirmJob(jobId, { force });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 409 }
    );
  }

  const updated = getJob(jobId);
  if (!updated) {
    return NextResponse.json(
      { error: "Job not found after confirmation" },
      { status: 404 }
    );
  }
  if (updated.status !== "downloading") {
    return NextResponse.json(
      {
        error: updated.errorMessage || `Confirmation ended in status ${updated.status}`,
        data: updated
      },
      { status: 409 }
    );
  }
  return NextResponse.json({ ok: true, data: updated });
}
