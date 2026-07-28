"use client";

import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  Pencil,
  Plus,
  Save,
  Trash2,
  X
} from "lucide-react";
import type { ChangeEvent, InputHTMLAttributes } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  archiveSubscriptionAction,
  createParsedSubscriptionAction,
  deleteSubscriptionAction,
  restoreSubscriptionAction,
  updateParsedSubscriptionAction
} from "@/app/actions";
import { useI18n } from "@/components/locale-provider";
import { StaggerChildren } from "@/components/motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FilterRule, Subscription } from "@/lib/db/types";
import type { RssPreview } from "@/lib/rss/preview";
import { dateMs } from "@/lib/time";
import type { TranslateFn } from "@/lib/i18n";

export function SubscriptionForm({
  subscriptions,
  rules,
  preview
}: {
  subscriptions: Subscription[];
  rules: FilterRule[];
  preview?: RssPreview | null;
}) {
  const { t } = useI18n();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("subscription.cardTitle")}</CardTitle>
        <CardDescription>
          {t("subscription.cardDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        {preview ? (
          <CreateFromPreview preview={preview} />
        ) : (
          <div className="rounded-[var(--radius)] border border-dashed border-[var(--line)] bg-[var(--panel-strong)] p-4 text-sm text-[var(--muted)]">
            {t("subscription.needParse")}
          </div>
        )}

        <ExistingSubscriptions
          subscriptions={subscriptions}
          rules={rules}
        />
      </CardContent>
    </Card>
  );
}

function CreateFromPreview({ preview }: { preview: RssPreview }) {
  const { t } = useI18n();
  const defaultName = preview.title ?? "";
  const defaultSeason = String(preview.seasons[0] ?? 1);
  const storageKey = `aniflow:rss-preview-filters:${preview.url}`;
  const [name, setName] = useState(defaultName);
  const [seasonNumber, setSeasonNumber] = useState(defaultSeason);
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [restoredUrl, setRestoredUrl] = useState<string | null>(null);
  const previewItems = useMemo(
    () => dedupePreviewRevisions(preview.items),
    [preview.items]
  );

  useEffect(() => {
    const stored = readStoredDraft(storageKey);
    const storedFilters = normalizeStoredFilters(
      previewItems,
      stored.filters ?? emptyFilters
    );
    setName(stored.name ?? defaultName);
    setSeasonNumber(stored.seasonNumber ?? defaultSeason);
    setFilters(
      stored.filters
        ? storedFilters
        : applySingleOptionDefaults(previewItems, storedFilters)
    );
    setRestoredUrl(preview.url);
  }, [defaultName, defaultSeason, preview.url, previewItems, storageKey]);

  useEffect(() => {
    if (restoredUrl !== preview.url) return;
    writeStoredDraft(storageKey, {
      name,
      seasonNumber,
      filters
    });
  }, [filters, name, preview.url, restoredUrl, seasonNumber, storageKey]);

  const groupOptions = useMemo(
    () =>
      facetOptions(previewItems, "releaseGroup", {
        resolution: filters.resolution,
        subtitleLanguage: filters.subtitleLanguage
      }),
    [previewItems, filters.resolution, filters.subtitleLanguage]
  );
  const resolutionOptions = useMemo(
    () =>
      facetOptions(previewItems, "resolution", {
        releaseGroup: filters.releaseGroup,
        subtitleLanguage: filters.subtitleLanguage
      }),
    [previewItems, filters.releaseGroup, filters.subtitleLanguage]
  );
  const languageOptions = useMemo(
    () =>
      facetOptions(previewItems, "subtitleLanguage", {
        releaseGroup: filters.releaseGroup,
        resolution: filters.resolution
      }),
    [previewItems, filters.releaseGroup, filters.resolution]
  );

  useEffect(() => {
    if (restoredUrl !== preview.url) return;
    setFilters((current) => normalizeStoredFilters(previewItems, current));
  }, [previewItems, preview.url, restoredUrl]);

  const updateFilter = (key: FacetKey, value: string) => {
    setFilters((current) => {
      const next = normalizeFiltersAfterChange(
        previewItems,
        {
          ...current,
          [key]: value
        },
        key
      );
      return applySingleOptionDefaults(
        previewItems,
        next,
        value ? undefined : new Set([key])
      );
    });
  };

  const previewRows = useMemo(
    () =>
      previewItems.map((item) => previewDecision(item, filters, t)),
    [previewItems, filters, t]
  );
  const matchedRows = previewRows.filter((row) => row.downloadable);
  const hasFilters = facetKeys.some((key) => Boolean(filters[key]));
  const canCreate =
    Boolean(name.trim()) &&
    Boolean(seasonNumber.trim()) &&
    Boolean(filters.releaseGroup) &&
    Boolean(filters.resolution) &&
    Boolean(filters.subtitleLanguage) &&
    matchedRows.length > 0;

  return (
    <form
      action={createParsedSubscriptionAction}
      className="grid gap-3 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel-strong)] p-3"
    >
      <input type="hidden" name="rssUrl" value={preview.url} />
      <div className="grid gap-2 md:grid-cols-2">
        <EditableField
          label={t("subscription.name")}
          name="name"
          value={name}
          onChange={(value) => setName(value)}
          required
        />
        <EditableField
          label={t("subscription.season")}
          name="seasonNumber"
          value={seasonNumber}
          onChange={(value) => setSeasonNumber(value)}
          type="number"
          min={0}
          max={99}
          required
        />
      </div>
      <div className="grid gap-2 lg:grid-cols-[1fr_auto] lg:items-end">
        <div className="grid gap-2 md:grid-cols-3">
          <SelectField
            label={t("subscription.group")}
            name="releaseGroup"
            values={groupOptions}
            value={filters.releaseGroup}
            onChange={(value) => updateFilter("releaseGroup", value)}
            placeholder={t("subscription.pickGroup")}
          />
          <SelectField
            label={t("subscription.resolution")}
            name="resolution"
            values={resolutionOptions}
            value={filters.resolution}
            onChange={(value) => updateFilter("resolution", value)}
            placeholder={t("subscription.pickResolution")}
          />
          <SelectField
            label={t("subscription.language")}
            name="subtitleLanguage"
            values={languageOptions}
            value={filters.subtitleLanguage}
            onChange={(value) => updateFilter("subtitleLanguage", value)}
            placeholder={t("subscription.pickLanguage")}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!hasFilters}
          onClick={() => setFilters(emptyFilters)}
        >
          <X className="size-4" />
          {t("subscription.clearFilters")}
        </Button>
      </div>
      <FilterPreview
        rows={previewRows}
        matchedCount={matchedRows.length}
        filters={filters}
        onFilterPick={(key, value) =>
          updateFilter(key, equalsLoose(filters[key], value) ? "" : value)
        }
      />
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="autoDownload" value="1" defaultChecked />
          {t("subscription.autoDownload")}
        </label>
        <Button type="submit" variant="signal" disabled={!canCreate}>
          <Plus className="size-4" />
          {t("subscription.create")}
        </Button>
      </div>
    </form>
  );
}

function ExistingSubscriptions({
  subscriptions,
  rules
}: {
  subscriptions: Subscription[];
  rules: FilterRule[];
}) {
  const { t } = useI18n();
  const [editingId, setEditingId] = useState<number | null>(null);
  const activeSubscriptions = subscriptions.filter(
    (subscription) => subscription.enabled
  );
  const archivedSubscriptions = subscriptions.filter(
    (subscription) => !subscription.enabled
  );

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium">{t("subscription.tracking")}</div>
        <Badge variant="muted">{activeSubscriptions.length}</Badge>
      </div>
      {activeSubscriptions.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-dashed border-[var(--line)] p-4 text-sm text-[var(--muted)]">
          {t("subscription.noTracking")}
        </div>
      ) : (
        <SubscriptionGroup
          subscriptions={activeSubscriptions}
          rules={rules}
          editingId={editingId}
          onToggleEdit={(id) =>
            setEditingId((current) => (current === id ? null : id))
          }
        />
      )}

      {archivedSubscriptions.length > 0 ? (
        <details className="group border-t border-[var(--line)] pt-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
            <span className="flex items-center gap-2">
              {t("subscription.archived")}
              <Badge variant="muted">{archivedSubscriptions.length}</Badge>
            </span>
            <ChevronDown className="size-4 text-[var(--muted)] transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-3">
            <SubscriptionGroup
              subscriptions={archivedSubscriptions}
              rules={rules}
              editingId={editingId}
              onToggleEdit={(id) =>
                setEditingId((current) => (current === id ? null : id))
              }
            />
          </div>
        </details>
      ) : null}
    </div>
  );
}

function SubscriptionGroup({
  subscriptions,
  rules,
  editingId,
  onToggleEdit
}: {
  subscriptions: Subscription[];
  rules: FilterRule[];
  editingId: number | null;
  onToggleEdit: (id: number) => void;
}) {
  return (
    <StaggerChildren className="grid gap-3" y={8} duration={0.32} stagger={0.04}>
      {subscriptions.map((subscription) => (
        <SubscriptionItem
          key={subscription.id}
          subscription={subscription}
          rules={rules.filter((rule) => rule.subscriptionId === subscription.id)}
          isEditing={editingId === subscription.id}
          onToggleEdit={() => onToggleEdit(subscription.id)}
        />
      ))}
    </StaggerChildren>
  );
}

function SubscriptionItem({
  subscription,
  rules,
  isEditing,
  onToggleEdit
}: {
  subscription: Subscription;
  rules: FilterRule[];
  isEditing: boolean;
  onToggleEdit: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="grid gap-3 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel-muted)] p-3 text-sm shadow-[var(--shadow)] transition-colors hover:border-[var(--line-strong)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium">{subscription.name}</div>
          <div className="mt-1 truncate text-xs text-[var(--muted)]">
            {subscription.rssUrl}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="rounded-[6px] border border-[var(--line)] px-2 py-1 data-digits text-xs">
            Season {String(subscription.seasonNumber).padStart(2, "0")}
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onToggleEdit}>
            {isEditing ? <X /> : <Pencil />}
            {isEditing ? t("common.collapse") : t("common.edit")}
          </Button>
          <form
            action={
              subscription.enabled
                ? archiveSubscriptionAction
                : restoreSubscriptionAction
            }
          >
            <input type="hidden" name="id" value={subscription.id} />
            <Button
              type="submit"
              variant={subscription.enabled ? "outline" : "signal"}
              size="sm"
            >
              {subscription.enabled ? <Archive /> : <ArchiveRestore />}
              {subscription.enabled ? t("subscription.archive") : t("subscription.restore")}
            </Button>
          </form>
          <DeleteSubscriptionDialog subscription={subscription} />
        </div>
      </div>
      <SubscriptionSummary subscription={subscription} rules={rules} />
      {isEditing ? (
        <EditSubscriptionForm subscription={subscription} rules={rules} />
      ) : null}
    </div>
  );
}

function DeleteSubscriptionDialog({
  subscription
}: {
  subscription: Subscription;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="danger" size="sm">
          <Trash2 />
          {t("common.delete")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("subscription.deleteTitle")}</DialogTitle>
          <DialogDescription>
            {t("subscription.deleteConfirm", { name: subscription.name })}
          </DialogDescription>
        </DialogHeader>
        <form
          action={deleteSubscriptionAction}
          className="grid gap-4"
          onSubmit={() => setOpen(false)}
        >
          <input type="hidden" name="id" value={subscription.id} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="danger">
              <Trash2 />
              {t("subscription.confirmDelete")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SubscriptionSummary({
  subscription,
  rules
}: {
  subscription: Subscription;
  rules: FilterRule[];
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap gap-2 text-xs text-[var(--muted)]">
      <span>{subscription.enabled ? t("subscription.tracking") : t("subscription.archived")}</span>
      <span>{subscription.autoDownload ? t("subscription.autoDownload") : t("subscription.discoverOnly")}</span>
      <RuleBadge label={t("subscription.group")} value={coreRuleValue(rules, "group_allow")} />
      <RuleBadge label={t("subscription.resolution")} value={coreRuleValue(rules, "resolution_allow")} />
      <RuleBadge label={t("subscription.language")} value={coreRuleValue(rules, "language_allow")} />
    </div>
  );
}

function RuleBadge({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <Badge variant="default">
      {label}: {value}
    </Badge>
  );
}

function EditSubscriptionForm({
  subscription,
  rules
}: {
  subscription: Subscription;
  rules: FilterRule[];
}) {
  const { t } = useI18n();
  return (
    <form
      action={updateParsedSubscriptionAction}
      className="grid gap-3 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel-strong)] p-3"
    >
      <input type="hidden" name="id" value={subscription.id} />
      <div className="grid gap-2 md:grid-cols-2">
        <FormField
          label={t("subscription.name")}
          name="name"
          defaultValue={subscription.name}
          required
        />
        <FormField
          label="RSS URL"
          name="rssUrl"
          defaultValue={subscription.rssUrl}
          required
        />
        <FormField
          label={t("subscription.season")}
          name="seasonNumber"
          type="number"
          min={0}
          max={99}
          defaultValue={String(subscription.seasonNumber)}
          required
        />
      </div>
      <div className="grid gap-2 md:grid-cols-3">
        <FormField
          label={t("subscription.group")}
          name="releaseGroup"
          defaultValue={coreRuleValue(rules, "group_allow")}
          required
        />
        <FormField
          label={t("subscription.resolution")}
          name="resolution"
          defaultValue={coreRuleValue(rules, "resolution_allow")}
          required
        />
        <FormField
          label={t("subscription.language")}
          name="subtitleLanguage"
          defaultValue={coreRuleValue(rules, "language_allow")}
          required
        />
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="autoDownload"
            value="1"
            defaultChecked={subscription.autoDownload}
          />
          {t("subscription.autoDownload")}
        </label>
        <Button type="submit" variant="signal">
          <Save className="size-4" />
          {t("subscription.save")}
        </Button>
      </div>
    </form>
  );
}

function FormField({
  label,
  name,
  type = "text",
  ...props
}: {
  label: string;
  name: string;
  type?: "text" | "number";
} & Omit<InputHTMLAttributes<HTMLInputElement>, "name" | "type">) {
  const id = `edit-${name}`;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={name} type={type} {...props} />
    </div>
  );
}

function coreRuleValue(rules: FilterRule[], type: FilterRule["type"]) {
  return rules.find((rule) => rule.type === type && rule.enabled)?.value ?? "";
}

function SelectField({
  label,
  name,
  values,
  value,
  onChange,
  placeholder
}: {
  label: string;
  name: string;
  values: string[];
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
}) {
  const { t } = useI18n();
  if (values.length === 0) {
    return (
      <div className="grid gap-1.5">
        <Label>{label}</Label>
        <div className="flex h-9 items-center rounded-[var(--radius)] border border-dashed border-[var(--line)] bg-[var(--input)] px-3 text-sm text-[var(--muted)]">
          {t("subscription.noCandidates")}
        </div>
      </div>
    );
  }
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <select
        id={name}
        name={name}
        value={value}
        onChange={(event: ChangeEvent<HTMLSelectElement>) =>
          onChange?.(event.target.value)
        }
        className="flex h-9 w-full rounded-[var(--radius)] border border-[var(--line)] bg-[var(--input)] px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--signal)]"
      >
        <option value="">{placeholder ?? t("subscription.notSelected")}</option>
        {values.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}

function EditableField({
  label,
  name,
  value,
  onChange,
  type = "text",
  min,
  max,
  required
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "number";
  min?: number;
  max?: number;
  required?: boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        type={type}
        min={min}
        max={max}
        value={value}
        required={required}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function FilterPreview({
  rows,
  matchedCount,
  filters,
  onFilterPick
}: {
  rows: PreviewDecision[];
  matchedCount: number;
  filters: FilterState;
  onFilterPick: (key: FacetKey, value: string) => void;
}) {
  const { t } = useI18n();
  const visibleRows = [...rows].sort(
    (left, right) => Number(right.downloadable) - Number(left.downloadable)
  );

  return (
    <div className="grid gap-2 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--input)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="font-medium">{t("subscription.previewTitle")}</div>
        <Badge variant={matchedCount > 0 ? "signal" : "amber"}>
          {t("subscription.previewMatch", { matched: matchedCount, total: rows.length })}
        </Badge>
      </div>
      <div className="grid gap-1.5">
        {visibleRows.slice(0, 12).map((row, index) => (
          <div
            key={`${index}:${row.item.guid}:${row.item.downloadUrl ?? row.item.link ?? ""}`}
            className="grid gap-1 rounded-[6px] border border-[var(--line)] px-2 py-1.5 text-xs"
          >
            <div className="truncate font-medium">{row.item.title}</div>
            <div className="flex flex-wrap gap-1.5 text-[var(--muted)]">
              <Badge variant={row.downloadable ? "signal" : "muted"}>
                {row.downloadable ? t("subscription.hit") : row.reasons.join(" / ")}
              </Badge>
              {row.item.metadata.episodeNumber != null ? (
                <span>
                  EP {String(row.item.metadata.episodeNumber).padStart(2, "0")}
                  {row.item.metadata.releaseRevision > 1
                    ? ` v${row.item.metadata.releaseRevision}`
                    : ""}
                </span>
              ) : null}
              <FilterTag
                label={row.item.metadata.releaseGroup}
                active={equalsLoose(row.item.metadata.releaseGroup, filters.releaseGroup)}
                onClick={(value) => onFilterPick("releaseGroup", value)}
              />
              <FilterTag
                label={row.item.metadata.resolution}
                active={equalsLoose(row.item.metadata.resolution, filters.resolution)}
                onClick={(value) => onFilterPick("resolution", value)}
              />
              <FilterTag
                label={row.item.metadata.subtitleLanguage}
                active={equalsLoose(
                  row.item.metadata.subtitleLanguage,
                  filters.subtitleLanguage
                )}
                onClick={(value) => onFilterPick("subtitleLanguage", value)}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FilterTag({
  label,
  active,
  onClick
}: {
  label: string | null | undefined;
  active: boolean;
  onClick: (value: string) => void;
}) {
  const value = label?.trim();
  if (!value) return null;
  return (
    <button
      type="button"
      onClick={() => onClick(value)}
      className={
        active
          ? "rounded-[var(--radius-sm)] border border-[var(--signal-soft-border)] bg-[var(--signal-soft)] px-2 py-0.5 text-xs font-medium text-[var(--signal-text)] transition-colors hover:opacity-90"
          : "rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--panel-strong)] px-2 py-0.5 text-xs font-medium text-[var(--muted)] transition-colors hover:border-[var(--signal-soft-border)] hover:bg-[var(--signal-soft)] hover:text-[var(--signal-text)]"
      }
    >
      {value}
    </button>
  );
}

interface PreviewDecision {
  item: RssPreview["items"][number];
  downloadable: boolean;
  reasons: string[];
}

function previewDecision(
  item: RssPreview["items"][number],
  filters: {
    releaseGroup: string;
    resolution: string;
    subtitleLanguage: string;
  },
  t: TranslateFn
): PreviewDecision {
  const reasons: string[] = [];
  if (
    !filters.releaseGroup ||
    !equalsLoose(item.metadata.releaseGroup, filters.releaseGroup)
  ) {
    reasons.push(
      filters.releaseGroup
        ? t("subscription.reasonGroupMismatch")
        : t("subscription.reasonGroupMissing")
    );
  }
  if (
    !filters.resolution ||
    !equalsLoose(item.metadata.resolution, filters.resolution)
  ) {
    reasons.push(
      filters.resolution
        ? t("subscription.reasonResolutionMismatch")
        : t("subscription.reasonResolutionMissing")
    );
  }
  if (
    !filters.subtitleLanguage ||
    !equalsLoose(item.metadata.subtitleLanguage, filters.subtitleLanguage)
  ) {
    reasons.push(
      filters.subtitleLanguage
        ? t("subscription.reasonLanguageMismatch")
        : t("subscription.reasonLanguageMissing")
    );
  }
  if (!item.downloadUrl) reasons.push(t("subscription.reasonNoUrl"));
  if (item.metadata.episodeNumber == null) {
    reasons.push(t("subscription.reasonNoEpisode"));
  }
  return {
    item,
    downloadable: reasons.length === 0,
    reasons: reasons.length > 0 ? reasons : [t("subscription.hit")]
  };
}

function dedupePreviewRevisions(items: RssPreview["items"]) {
  const keyed = new Map<
    string,
    {
      item: RssPreview["items"][number];
      index: number;
    }
  >();
  const unkeyed: Array<{
    item: RssPreview["items"][number];
    index: number;
  }> = [];

  items.forEach((item, index) => {
    const key = previewRevisionKey(item);
    if (!key) {
      unkeyed.push({ item, index });
      return;
    }

    const previous = keyed.get(key);
    if (!previous || comparePreviewRevision(item, index, previous.item, previous.index) > 0) {
      keyed.set(key, { item, index });
    }
  });

  return [...unkeyed, ...keyed.values()]
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.item);
}

function previewRevisionKey(item: RssPreview["items"][number]) {
  const metadata = item.metadata;
  if (metadata.episodeNumber == null) return null;
  return [
    metadata.seasonNumber ?? "",
    metadata.episodeNumber,
    normalizedFacetValue(metadata.releaseGroup),
    normalizedFacetValue(metadata.resolution),
    normalizedFacetValue(metadata.subtitleLanguage)
  ].join("|");
}

function comparePreviewRevision(
  left: RssPreview["items"][number],
  leftIndex: number,
  right: RssPreview["items"][number],
  rightIndex: number
) {
  const revisionDelta =
    left.metadata.releaseRevision - right.metadata.releaseRevision;
  if (revisionDelta !== 0) return revisionDelta;
  const dateDelta = dateMs(left.publishedAt) - dateMs(right.publishedAt);
  if (dateDelta !== 0) return dateDelta;
  return leftIndex - rightIndex;
}

function normalizedFacetValue(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function equalsLoose(left: string | null | undefined, right: string) {
  return (left ?? "").trim().toLowerCase() === right.trim().toLowerCase();
}

type FacetKey = "releaseGroup" | "resolution" | "subtitleLanguage";

type FilterState = Record<FacetKey, string>;

type FacetFilters = Partial<FilterState>;

const emptyFilters: FilterState = {
  releaseGroup: "",
  resolution: "",
  subtitleLanguage: ""
};

function facetOptions(
  items: RssPreview["items"],
  key: FacetKey,
  filters: FacetFilters
) {
  return uniqueValues(
    items
      .filter((item) => matchesFacetFilters(item, filters))
      .map((item) => item.metadata[key])
  );
}

function matchesFacetFilters(
  item: RssPreview["items"][number],
  filters: FacetFilters
) {
  return (Object.entries(filters) as Array<[FacetKey, string | undefined]>).every(
    ([key, value]) => !value || equalsLoose(item.metadata[key], value)
  );
}

function uniqueValues(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .filter((value): value is string => Boolean(value?.trim()))
        .map((value) => value.trim())
    )
  ).sort(compareStable);
}

function compareStable(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeFiltersAfterChange(
  items: RssPreview["items"],
  filters: FilterState,
  changedKey: FacetKey
): FilterState {
  let normalized = sanitizeFilters(filters);

  for (const key of facetKeys) {
    if (key === changedKey) continue;
    const value = normalized[key];
    if (!value) continue;
    const options = facetOptions(items, key, filtersWithoutKey(normalized, key));
    if (!options.includes(value)) {
      normalized = {
        ...normalized,
        [key]: ""
      };
    }
  }

  const changedValue = normalized[changedKey];
  if (
    changedValue &&
    !facetOptions(items, changedKey, {}).includes(changedValue)
  ) {
    normalized = {
      ...normalized,
      [changedKey]: ""
    };
  }

  return normalized;
}

function normalizeStoredFilters(
  items: RssPreview["items"],
  filters: FilterState
): FilterState {
  let normalized = sanitizeFilters(filters);

  const dependencyKeysByFacet: Record<FacetKey, FacetKey[]> = {
    releaseGroup: [],
    resolution: ["releaseGroup"],
    subtitleLanguage: ["releaseGroup", "resolution"]
  };

  for (const key of facetKeys) {
    const value = normalized[key];
    if (!value) continue;
    const filtersForKey = Object.fromEntries(
      dependencyKeysByFacet[key].map((dependencyKey) => [
        dependencyKey,
        normalized[dependencyKey]
      ])
    ) as FacetFilters;
    const options = facetOptions(items, key, filtersForKey);
    if (!options.includes(value)) {
      normalized = {
        ...normalized,
        [key]: ""
      };
    }
  }

  return normalized;
}

function applySingleOptionDefaults(
  items: RssPreview["items"],
  filters: FilterState,
  skipKeys = new Set<FacetKey>()
): FilterState {
  let normalized = sanitizeFilters(filters);
  let changed = true;

  while (changed) {
    changed = false;
    for (const key of facetKeys) {
      if (normalized[key]) continue;
      if (skipKeys.has(key)) continue;
      const options = facetOptions(items, key, filtersWithoutKey(normalized, key));
      if (options.length === 1) {
        normalized = {
          ...normalized,
          [key]: options[0]
        };
        changed = true;
      }
    }
  }

  return normalized;
}

function filtersWithoutKey(filters: FilterState, keyToRemove: FacetKey) {
  const next: FacetFilters = {};
  for (const key of facetKeys) {
    if (key !== keyToRemove) next[key] = filters[key];
  }
  return next;
}

function filtersEqual(left: FilterState, right: FilterState) {
  return facetKeys.every((key) => left[key] === right[key]);
}

const facetKeys: FacetKey[] = [
  "releaseGroup",
  "resolution",
  "subtitleLanguage"
];

interface StoredPreviewDraft {
  name?: string;
  seasonNumber?: string;
  filters?: FilterState;
}

function sanitizeFilters(filters: Partial<FilterState>): FilterState {
  return {
    releaseGroup: typeof filters.releaseGroup === "string" ? filters.releaseGroup : "",
    resolution: typeof filters.resolution === "string" ? filters.resolution : "",
    subtitleLanguage:
      typeof filters.subtitleLanguage === "string" ? filters.subtitleLanguage : ""
  };
}

function readStoredDraft(storageKey: string): StoredPreviewDraft {
  if (typeof window === "undefined") return {};
  try {
    const rawValue =
      window.localStorage.getItem(storageKey) ??
      window.sessionStorage.getItem(storageKey);
    if (!rawValue) return {};
    const parsed = JSON.parse(rawValue) as {
      name?: unknown;
      seasonNumber?: unknown;
      filters?: Partial<FilterState>;
    };
    return {
      name: typeof parsed.name === "string" ? parsed.name : undefined,
      seasonNumber:
        typeof parsed.seasonNumber === "string" ? parsed.seasonNumber : undefined,
      filters: parsed.filters ? sanitizeFilters(parsed.filters) : undefined
    };
  } catch {
    return {};
  }
}

function writeStoredDraft(storageKey: string, draft: StoredPreviewDraft) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey, JSON.stringify(draft));
}
