import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { mapEpisodeFile } from "@/lib/db/mappers";
import { episodeFiles } from "@/lib/db/schema";
import type { EpisodeFile } from "@/lib/db/types";

export function upsertEpisodeFile(input: {
  subscriptionId: number;
  feedItemId?: number | null;
  episodeNumber?: number | null;
  originalPath: string;
  finalPath?: string | null;
  sizeBytes?: number | null;
  status?: EpisodeFile["status"];
  errorMessage?: string | null;
}) {
  getDb()
    .insert(episodeFiles)
    .values({
      subscriptionId: input.subscriptionId,
      feedItemId: input.feedItemId ?? null,
      episodeNumber: input.episodeNumber ?? null,
      originalPath: input.originalPath,
      finalPath: input.finalPath ?? null,
      sizeBytes: input.sizeBytes ?? null,
      status: input.status ?? "detected",
      errorMessage: input.errorMessage ?? null
    })
    .onConflictDoUpdate({
      target: [episodeFiles.subscriptionId, episodeFiles.originalPath],
      set: {
        feedItemId: input.feedItemId
          ? input.feedItemId
          : sql`${episodeFiles.feedItemId}`,
        episodeNumber:
          input.episodeNumber != null
            ? input.episodeNumber
            : sql`${episodeFiles.episodeNumber}`,
        finalPath: input.finalPath
          ? input.finalPath
          : sql`${episodeFiles.finalPath}`,
        sizeBytes:
          input.sizeBytes != null
            ? input.sizeBytes
            : sql`${episodeFiles.sizeBytes}`,
        status: input.status ?? "detected",
        errorMessage: input.errorMessage ?? null,
        updatedAt: sql`CURRENT_TIMESTAMP`
      }
    })
    .run();
}

export function getEpisodeFileForFeedItem(feedItemId: number) {
  const row = getDb()
    .select()
    .from(episodeFiles)
    .where(eq(episodeFiles.feedItemId, feedItemId))
    .orderBy(desc(episodeFiles.updatedAt), desc(episodeFiles.id))
    .limit(1)
    .get();
  return row ? mapEpisodeFile(row as unknown as Record<string, unknown>) : null;
}

export function listEpisodeFiles(limit = 200) {
  return getDb()
    .select()
    .from(episodeFiles)
    .orderBy(desc(episodeFiles.updatedAt))
    .limit(limit)
    .all()
    .map((row) => mapEpisodeFile(row as unknown as Record<string, unknown>));
}
