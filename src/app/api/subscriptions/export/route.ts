import { NextResponse } from "next/server";
import { exportSubscriptionsPayload } from "@/lib/subscriptions-io";

export const dynamic = "force-dynamic";

export async function GET() {
  const payload = exportSubscriptionsPayload();
  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="aniflow-subscriptions.json"'
    }
  });
}
