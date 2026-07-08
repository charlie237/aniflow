import { NextResponse } from "next/server";
import { enqueueWorkerTask } from "@/lib/db/repositories";
import { kickWorkerTaskRunner } from "@/lib/worker/tasks";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const subscriptionId = Number(id);
  const task = enqueueWorkerTask({
    type: "poll_subscription",
    subscriptionId
  });
  kickWorkerTaskRunner();
  return NextResponse.json({ data: task });
}
