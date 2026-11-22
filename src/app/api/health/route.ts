import { NextResponse } from "next/server";
import { getSqlite } from "@/lib/db/client";
import { getWorkerHealth } from "@/lib/db/repositories";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    getSqlite().prepare("SELECT 1").get();
    const worker = getWorkerHealth();
    return NextResponse.json({
      ok: true,
      db: "ok",
      worker: {
        ok: worker.ok,
        secondsSinceLastSeen: worker.secondsSinceLastSeen
      }
    });
  } catch {
    return NextResponse.json(
      { ok: false, db: "error" },
      { status: 503 }
    );
  }
}
