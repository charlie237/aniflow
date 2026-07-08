import { NextResponse } from "next/server";
import { pollSubscription } from "@/lib/worker/pipeline";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const result = await pollSubscription(Number(id));
  return NextResponse.json({ data: result });
}
