import { and, desc, eq, max, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { mapFeedItem, mapMetadata } from "@/lib/db/mappers";
import { episodeFiles, feedItems, releaseMetadata } from "@/lib/db/schema";
import type { ReleaseMetadata, Subscription } from "@/lib/db/types";
import { isRemotePathWithin, joinRemotePath } from "@/lib/utils/path";

export interface ParsedFeedInput {
  guid: string;
  rssGuid?: string | null;
  title: string;
  link?: string | null;
  downloadUrl?: string | null;
  publishedAt?: string | null;
  rawXmlJson?: string | null;
  metadata: Omit<ReleaseMetadata, "id" | "feedItemId">;
}

export interface LibraryInventoryFile {
  path: string;
  episodeNumber: number | null;
  sizeBytes: number | null;
}

type ReleaseVariant = Pick<
  ReleaseMetadata,
  "episodeNumber" | "releaseGroup" | "resolution" | "subtitleLanguage"
>;

export function upsertFeedItem(subscription: Subscription, item: ParsedFeedInput) {
  return getDb().transaction((tx) => {
    tx.insert(feedItems)
      .values({
        subscriptionId: subscription.id,
        guid: item.guid,
        rssGuid: item.rssGuid ?? null,
        title: item.title,
        link: item.link ?? null,
        downloadUrl: item.downloadUrl ?? null,
        publishedAt: item.publishedAt ?? null,
        rawXmlJson: item.rawXmlJson ?? null
      })
      .onConflictDoNothing()
      .run();

    const byGuid = tx
      .select()
      .from(feedItems)
      .where(
        and(
          eq(feedItems.subscriptionId, subscription.id),
          eq(feedItems.guid, item.guid)
        )
      )
      .get();
    // Guid match wins. A URL-only match means a duplicate of the same release
    // with a different guid: reuse the existing row but keep its identity —
    // do not overwrite title/guid with the new item's data.
    const feedRow =
      byGuid ??
      (item.downloadUrl
        ? tx
            .select()
            .from(feedItems)
            .where(
              and(
                eq(feedItems.subscriptionId, subscription.id),
                eq(feedItems.downloadUrl, item.downloadUrl)
              )
            )
            .orderBy(desc(feedItems.id))
            .limit(1)
            .get()
        : undefined);
    if (!feedRow) throw new Error("Failed to read feed item after insert");

    if (byGuid) {
      tx.update(feedItems)
        .set({
          rssGuid: item.rssGuid ?? null,
          title: item.title,
          link: item.link ?? null,
          downloadUrl: item.downloadUrl
            ? item.downloadUrl
            : sql`${feedItems.downloadUrl}`,
          publishedAt: item.publishedAt
            ? item.publishedAt
            : sql`${feedItems.publishedAt}`,
          rawXmlJson: item.rawXmlJson ?? null
        })
        .where(eq(feedItems.id, feedRow.id))
        .run();
    }

    const updated = tx
      .select()
      .from(feedItems)
      .where(eq(feedItems.id, feedRow.id))
      .get();
    if (!updated) throw new Error("Failed to read feed item after update");
    const feedItem = mapFeedItem(updated as unknown as Record<string, unknown>);

    tx.insert(releaseMetadata)
      .values(metadataValues(feedItem.id, item.metadata))
      .onConflictDoUpdate({
        target: releaseMetadata.feedItemId,
        set: metadataUpdateValues(item.metadata)
      })
      .run();

    return feedItem;
  });
}

export function getFeedItem(id: number) {
  const row = getDb().select().from(feedItems).where(eq(feedItems.id, id)).get();
  return row ? mapFeedItem(row as unknown as Record<string, unknown>) : null;
}

export function getMetadataForFeedItem(feedItemId: number) {
  const row = getDb()
    .select()
    .from(releaseMetadata)
    .where(eq(releaseMetadata.feedItemId, feedItemId))
    .get();
  return mapMetadata(row as unknown as Record<string, unknown> | undefined);
}

export function findFeedItemsForSubscription(subscriptionId: number) {
  return getDb()
    .select()
    .from(feedItems)
    .where(eq(feedItems.subscriptionId, subscriptionId))
    .orderBy(desc(feedItems.firstSeenAt), desc(feedItems.id))
    .all()
    .map((row) => mapFeedItem(row as unknown as Record<string, unknown>));
}

export function findMetadataBySubscription(subscriptionId: number) {
  return getDb()
    .select({
      id: releaseMetadata.id,
      feedItemId: releaseMetadata.feedItemId,
      releaseGroup: releaseMetadata.releaseGroup,
      parsedTitle: releaseMetadata.parsedTitle,
      episodeNumber: releaseMetadata.episodeNumber,
      episodeText: releaseMetadata.episodeText,
      releaseRevision: releaseMetadata.releaseRevision,
      resolution: releaseMetadata.resolution,
      subtitleLanguage: releaseMetadata.subtitleLanguage,
      container: releaseMetadata.container,
      tagsJson: releaseMetadata.tagsJson,
      parseConfidence: releaseMetadata.parseConfidence,
      needsReview: releaseMetadata.needsReview
    })
    .from(releaseMetadata)
    .innerJoin(feedItems, eq(feedItems.id, releaseMetadata.feedItemId))
    .where(eq(feedItems.subscriptionId, subscriptionId))
    .orderBy(desc(feedItems.firstSeenAt), desc(feedItems.id))
    .all()
    .map((row) => mapMetadata(row as unknown as Record<string, unknown>))
    .filter((item): item is ReleaseMetadata => Boolean(item));
}

export function getPreferredFeedItemIdForRelease(
  subscriptionId: number,
  metadata: ReleaseVariant
) {
  if (metadata.episodeNumber == null) return null;
  const row = getDb()
    .select({ id: feedItems.id })
    .from(feedItems)
    .innerJoin(releaseMetadata, eq(releaseMetadata.feedItemId, feedItems.id))
    .where(variantMatchCondition(subscriptionId, metadata))
    .orderBy(...variantOrder())
    .limit(1)
    .get();
  return row?.id ?? null;
}

export function listVariantFeedItemIds(
  subscriptionId: number,
  metadata: ReleaseVariant
) {
  if (metadata.episodeNumber == null) return [] as number[];
  return getDb()
    .select({ id: feedItems.id })
    .from(feedItems)
    .innerJoin(releaseMetadata, eq(releaseMetadata.feedItemId, feedItems.id))
    .where(variantMatchCondition(subscriptionId, metadata))
    .orderBy(...variantOrder())
    .all()
    .map((row) => row.id);
}

export function getHighestReleaseRevisionForVariant(
  subscriptionId: number,
  metadata: ReleaseVariant
) {
  if (metadata.episodeNumber == null) return 1;
  const row = getDb()
    .select({ highest: max(releaseMetadata.releaseRevision) })
    .from(feedItems)
    .innerJoin(releaseMetadata, eq(releaseMetadata.feedItemId, feedItems.id))
    .where(variantMatchCondition(subscriptionId, metadata))
    .get();
  const highest = Number(row?.highest ?? 1);
  return Number.isFinite(highest) && highest > 1 ? highest : 1;
}

export function getLibraryFileRevisionAtPath(
  subscriptionId: number,
  finalPath: string
) {
  const row = getDb()
    .select({ releaseRevision: releaseMetadata.releaseRevision })
    .from(episodeFiles)
    .leftJoin(releaseMetadata, eq(releaseMetadata.feedItemId, episodeFiles.feedItemId))
    .where(
      and(
        eq(episodeFiles.subscriptionId, subscriptionId),
        eq(episodeFiles.finalPath, finalPath),
        eq(episodeFiles.status, "renamed")
      )
    )
    .orderBy(desc(sql`datetime(${episodeFiles.updatedAt})`), desc(episodeFiles.id))
    .limit(1)
    .get();
  const revision = Number(row?.releaseRevision);
  return Number.isFinite(revision) && revision > 0 ? revision : null;
}

export function libraryFileExistsAtPath(subscriptionId: number, finalPath: string) {
  return Boolean(
    getDb()
      .select({ id: episodeFiles.id })
      .from(episodeFiles)
      .where(
        and(
          eq(episodeFiles.subscriptionId, subscriptionId),
          eq(episodeFiles.finalPath, finalPath),
          eq(episodeFiles.status, "renamed")
        )
      )
      .limit(1)
      .get()
  );
}

export function getLibraryEpisodeState(
  subscriptionId: number,
  episodeNumber: number
) {
  const rows = getDb()
    .select({
      finalPath: episodeFiles.finalPath,
      releaseRevision: releaseMetadata.releaseRevision
    })
    .from(episodeFiles)
    .leftJoin(releaseMetadata, eq(releaseMetadata.feedItemId, episodeFiles.feedItemId))
    .where(
      and(
        eq(episodeFiles.subscriptionId, subscriptionId),
        eq(episodeFiles.episodeNumber, episodeNumber),
        eq(episodeFiles.status, "renamed")
      )
    )
    .orderBy(desc(sql`datetime(${episodeFiles.updatedAt})`), desc(episodeFiles.id))
    .all();
  if (rows.length === 0) return null;

  const revisions = rows
    .map((row) => Number(row.releaseRevision))
    .filter((revision) => Number.isFinite(revision) && revision > 0);
  return {
    path: rows.find((row) => row.finalPath)?.finalPath ?? null,
    knownRevision: revisions.length > 0 ? Math.max(...revisions) : null,
    fileCount: rows.length
  };
}

export function syncLibraryEpisodeInventory(
  subscriptionId: number,
  seasonRoot: string,
  files: LibraryInventoryFile[]
) {
  const normalizedRoot = joinRemotePath(seasonRoot);
  const normalizedFiles = files.map((file) => ({
    ...file,
    path: joinRemotePath(file.path)
  }));
  const seenPaths = new Set(normalizedFiles.map((file) => file.path));

  return getDb().transaction((tx) => {
    const existing = tx
      .select({
        id: episodeFiles.id,
        finalPath: episodeFiles.finalPath,
        episodeNumber: episodeFiles.episodeNumber,
        sizeBytes: episodeFiles.sizeBytes
      })
      .from(episodeFiles)
      .where(
        and(
          eq(episodeFiles.subscriptionId, subscriptionId),
          eq(episodeFiles.status, "renamed")
        )
      )
      .orderBy(desc(episodeFiles.id))
      .all();
    const existingByFinalPath = new Map(
      existing
        .filter((row) => row.finalPath)
        .map((row) => [joinRemotePath(row.finalPath), row])
    );
    let imported = 0;
    let updated = 0;

    for (const file of normalizedFiles) {
      if (file.episodeNumber == null) continue;
      const current = existingByFinalPath.get(file.path);
      if (current) {
        if (
          current.episodeNumber !== file.episodeNumber ||
          current.sizeBytes !== file.sizeBytes
        ) {
          tx.update(episodeFiles)
            .set({
              episodeNumber: file.episodeNumber,
              sizeBytes: file.sizeBytes,
              status: "renamed",
              errorMessage: null,
              updatedAt: sql`CURRENT_TIMESTAMP`
            })
            .where(eq(episodeFiles.id, current.id))
            .run();
          updated += 1;
        }
        continue;
      }

      tx.insert(episodeFiles)
        .values({
          subscriptionId,
          feedItemId: null,
          episodeNumber: file.episodeNumber,
          originalPath: file.path,
          finalPath: file.path,
          sizeBytes: file.sizeBytes,
          status: "renamed",
          errorMessage: null
        })
        .onConflictDoUpdate({
          target: [episodeFiles.subscriptionId, episodeFiles.originalPath],
          set: {
            episodeNumber: file.episodeNumber,
            finalPath: file.path,
            sizeBytes: file.sizeBytes,
            status: "renamed",
            errorMessage: null,
            updatedAt: sql`CURRENT_TIMESTAMP`
          }
        })
        .run();
      imported += 1;
    }

    let removed = 0;
    for (const row of existing) {
      if (!row.finalPath) continue;
      const finalPath = joinRemotePath(row.finalPath);
      if (
        isRemotePathWithin(finalPath, normalizedRoot) &&
        !seenPaths.has(finalPath)
      ) {
        tx.delete(episodeFiles).where(eq(episodeFiles.id, row.id)).run();
        removed += 1;
      }
    }

    return { imported, updated, removed };
  });
}

function metadataValues(
  feedItemId: number,
  metadata: ParsedFeedInput["metadata"]
) {
  return {
    feedItemId,
    ...metadataUpdateValues(metadata)
  };
}

function metadataUpdateValues(metadata: ParsedFeedInput["metadata"]) {
  return {
    releaseGroup: metadata.releaseGroup,
    parsedTitle: metadata.parsedTitle,
    episodeNumber: metadata.episodeNumber,
    episodeText: metadata.episodeText,
    releaseRevision: metadata.releaseRevision,
    resolution: metadata.resolution,
    subtitleLanguage: metadata.subtitleLanguage,
    container: metadata.container,
    tagsJson: JSON.stringify(metadata.tags),
    parseConfidence: metadata.parseConfidence,
    needsReview: metadata.needsReview ? 1 : 0
  };
}

function variantMatchCondition(
  subscriptionId: number,
  metadata: ReleaseVariant
) {
  if (metadata.episodeNumber == null) {
    throw new Error("Release variant requires an episode number");
  }
  return and(
    eq(feedItems.subscriptionId, subscriptionId),
    eq(releaseMetadata.episodeNumber, metadata.episodeNumber),
    normalizedFacetEquals(releaseMetadata.releaseGroup, metadata.releaseGroup),
    normalizedFacetEquals(releaseMetadata.resolution, metadata.resolution),
    normalizedFacetEquals(
      releaseMetadata.subtitleLanguage,
      metadata.subtitleLanguage
    )
  );
}

function normalizedFacetEquals(
  column:
    | typeof releaseMetadata.releaseGroup
    | typeof releaseMetadata.resolution
    | typeof releaseMetadata.subtitleLanguage,
  value: string | null
) {
  return sql`lower(trim(coalesce(${column}, ''))) = lower(trim(coalesce(${value}, '')))`;
}

function variantOrder() {
  return [
    desc(releaseMetadata.releaseRevision),
    desc(sql`datetime(coalesce(${feedItems.publishedAt}, ${feedItems.firstSeenAt}))`),
    desc(feedItems.id)
  ] as const;
}
