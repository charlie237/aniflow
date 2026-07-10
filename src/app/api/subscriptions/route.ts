import { NextResponse } from "next/server";
import {
  createSubscription,
  getSystemSettings,
  listSubscriptions
} from "@/lib/db/repositories";
import { resolveSubscriptionIncomingPath } from "@/lib/utils/path";

export async function GET() {
  return NextResponse.json({ data: listSubscriptions() });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    name?: string;
    rssUrl?: string;
    seasonNumber?: number;
    destinationRoot?: string;
    incomingPath?: string | null;
    tmdbSeriesId?: number | null;
  };

  if (!body.name || !body.rssUrl) {
    return NextResponse.json(
      { error: "name and rssUrl are required" },
      { status: 400 }
    );
  }

  let incomingPath: string;
  try {
    incomingPath = resolveSubscriptionIncomingPath({
      incomingRoot: getSystemSettings().openlistIncomingPath,
      subscriptionName: body.name,
      incomingPath: body.incomingPath
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid incoming path" },
      { status: 400 }
    );
  }

  const subscription = createSubscription({
    name: body.name,
    rssUrl: body.rssUrl,
    seasonNumber: body.seasonNumber ?? 1,
    destinationRoot: body.destinationRoot ?? "/115/Anime",
    incomingPath,
    tmdbSeriesId: body.tmdbSeriesId ?? null
  });

  return NextResponse.json({ data: subscription }, { status: 201 });
}
