import { NextResponse } from "next/server";
import { getJob } from "@/lib/db/repositories";
import { retryJob } from "@/lib/worker/pipeline";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const jobId = Number(id);
  if (!Number.isInteger(jobId) || jobId <= 0) {
    return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
  }
  if (!getJob(jobId)) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  await retryJob(jobId);
  return NextResponse.json({ ok: true });
}
