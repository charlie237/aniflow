import { NextResponse } from "next/server";
import { enqueueWorkerTask, getSubscription } from "@/lib/db/repositories";
import { kickWorkerTaskRunner } from "@/lib/worker/tasks";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const subscriptionId = Number(id);
  if (!Number.isInteger(subscriptionId) || subscriptionId <= 0) {
    return NextResponse.json({ error: "Invalid subscription id" }, { status: 400 });
  }
  if (!getSubscription(subscriptionId)) {
    return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
  }
  const task = enqueueWorkerTask({
    type: "poll_subscription",
    subscriptionId
  });
  kickWorkerTaskRunner();
  return NextResponse.json({ data: task });
}
