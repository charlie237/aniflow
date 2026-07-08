import { Badge } from "@/components/ui/badge";
import type { ReleaseMetadata } from "@/lib/db/types";

export function TagRow({ metadata }: { metadata: ReleaseMetadata | null }) {
  if (!metadata) return <span className="text-sm text-[var(--muted)]">无标签</span>;

  const primary = [
    metadata.releaseGroup,
    metadata.resolution,
    metadata.subtitleLanguage,
    metadata.source,
    metadata.codec,
    metadata.audio
  ].filter((value): value is string => Boolean(value));

  const extra = metadata.tags.filter((tag) => !primary.includes(tag)).slice(0, 5);

  return (
    <div className="flex flex-wrap gap-1.5">
      {primary.map((tag) => (
        <Badge key={tag} variant="signal">
          {tag}
        </Badge>
      ))}
      {extra.map((tag) => (
        <Badge key={tag} variant="muted">
          {tag}
        </Badge>
      ))}
      {metadata.needsReview ? <Badge variant="amber">需确认</Badge> : null}
    </div>
  );
}
