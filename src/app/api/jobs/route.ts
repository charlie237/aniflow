import { NextResponse } from "next/server";
import { listJobs } from "@/lib/db/repositories";

export async function GET() {
  return NextResponse.json({ data: listJobs() });
}
