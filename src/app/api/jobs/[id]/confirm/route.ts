import { NextResponse } from "next/server";
import { confirmJob } from "@/lib/worker/pipeline";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await confirmJob(Number(id));
  return NextResponse.json({ ok: true });
}
