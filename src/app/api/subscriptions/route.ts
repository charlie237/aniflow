import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createSubscription,
  enqueueWorkerTask,
  getSystemSettings,
  listSubscriptions
} from "@/lib/db/repositories";
import { isMikanRssUrl } from "@/lib/net/url-policy";
import { kickWorkerTaskRunner } from "@/lib/worker/tasks";

const createSubscriptionSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    rssUrl: z.string().url().refine(isMikanRssUrl, {
      message: "Only mikanani.me/RSS/ URLs are supported"
    }),
    seasonNumber: z.coerce.number().int().min(0).max(99).optional(),
    destinationRoot: z.string().trim().min(1).optional(),
    // Accepted for compatibility with older clients, but job-owned paths are
    // now always derived from the download job id.
    incomingPath: z.string().trim().min(1).nullable().optional(),
    tmdbSeriesId: z.coerce.number().int().positive().nullable().optional()
  })
  .strict();

export async function GET() {
  return NextResponse.json({ data: listSubscriptions() });
}

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = createSubscriptionSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
      { status: 400 }
    );
  }
  const body = parsed.data;
  const settings = getSystemSettings();

  try {
    const subscription = createSubscription({
      name: body.name,
      rssUrl: body.rssUrl,
      seasonNumber: body.seasonNumber ?? 1,
      destinationRoot: body.destinationRoot ?? settings.mediaLibraryRoot,
      incomingPath: null,
      tmdbSeriesId: body.tmdbSeriesId ?? null
    });
    if (subscription) {
      enqueueWorkerTask({
        type: "poll_subscription",
        subscriptionId: subscription.id
      });
      kickWorkerTaskRunner();
    }

    return NextResponse.json({ data: subscription }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /unique|constraint/i.test(message) ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
