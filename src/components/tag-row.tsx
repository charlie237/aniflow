import { Badge } from "@/components/ui/badge";
import type { ReleaseMetadata } from "@/lib/db/types";

export function TagRow({ metadata }: { metadata: ReleaseMetadata | null }) {
  if (!metadata) return <span className="text-sm text-[var(--muted)]">无标签</span>;

  const tags = [
    metadata.releaseGroup,
    metadata.resolution,
    metadata.subtitleLanguage
  ].filter((value): value is string => Boolean(value));

  if (tags.length === 0) {
    return <span className="text-sm text-[var(--muted)]">无标签</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag, index) => (
        <Badge key={`${index}:${tag}`} variant="signal">
          {tag}
        </Badge>
      ))}
    </div>
  );
}
