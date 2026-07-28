"use client";

import { Save } from "lucide-react";
import type { InputHTMLAttributes } from "react";
import {
  check115ConnectivityAction,
  saveSettingsAction
} from "@/app/actions";
import { useI18n } from "@/components/locale-provider";
import { ResetRuntimeDialog } from "@/components/reset-runtime-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SystemSettings } from "@/lib/db/types";
import type { OpenList115CheckResult } from "@/lib/openlist/client";
import { RUNTIME_RESET_CONFIRM_PHRASE } from "@/lib/runtime-reset";

export function SettingsForm({
  settings,
  checkResult,
  resetStatus
}: {
  settings: SystemSettings;
  checkResult?: OpenList115CheckResult | null;
  resetStatus?: "runtime" | "confirm" | null;
}) {
  const { t } = useI18n();

  return (
    <div className="grid gap-5">
      <form action={saveSettingsAction} className="grid gap-5">
        <Card>
          <CardHeader>
            <CardTitle>{t("settings.openlistTitle")}</CardTitle>
            <CardDescription>{t("settings.openlistDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <Field
              label={t("settings.baseUrl")}
              name="openlistBaseUrl"
              defaultValue={settings.openlistBaseUrl}
              placeholder="http://127.0.0.1:5244"
            />
            <Field
              label={t("settings.token")}
              name="openlistToken"
              defaultValue={settings.openlistToken}
              placeholder="Authorization token"
              type="password"
            />
            <ModeSelect defaultValue={settings.openlist115Mode} />
            <Field
              label={t("settings.incomingPath")}
              name="openlistIncomingPath"
              defaultValue={settings.openlistIncomingPath}
              placeholder="/115/Anime/_incoming"
              help={t("settings.incomingHelp")}
            />
            <div className="flex flex-wrap items-center gap-2 md:col-span-2">
              <Button
                type="submit"
                variant="outline"
                formAction={check115ConnectivityAction}
              >
                {t("settings.check115")}
              </Button>
              {checkResult ? <CheckResult result={checkResult} /> : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("settings.proxyTitle")}</CardTitle>
            <CardDescription>{t("settings.proxyDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <label className="flex items-center gap-2 text-sm md:col-span-2">
              <input
                type="checkbox"
                name="proxyEnabled"
                value="1"
                defaultChecked={settings.proxyEnabled}
              />
              {t("settings.proxyEnabled")}
            </label>
            <Field
              label={t("settings.proxyUrl")}
              name="proxyUrl"
              defaultValue={settings.proxyUrl}
              placeholder="http://127.0.0.1:7890"
              help={t("settings.proxyHelp")}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("settings.namingTitle")}</CardTitle>
            <CardDescription>{t("settings.namingDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <Field
              label={t("settings.mediaRoot")}
              name="mediaLibraryRoot"
              defaultValue={settings.mediaLibraryRoot}
              placeholder="/115/Anime"
              help={t("settings.mediaRootHelp")}
            />
            <Field
              label={t("settings.seasonTemplate")}
              name="seasonPathTemplate"
              defaultValue={settings.seasonPathTemplate}
              placeholder="{title}/Season {season_pad}"
              help={t("settings.seasonTemplateHelp")}
            />
            <div className="md:col-span-2">
              <Field
                label={t("settings.episodeTemplate")}
                name="episodeFileTemplate"
                defaultValue={settings.episodeFileTemplate}
                placeholder="{title} - S{season_pad}E{episode_pad}.{ext}"
                help={t("settings.episodeTemplateHelp")}
              />
            </div>
            <label className="flex items-start gap-2 text-sm md:col-span-2">
              <input
                className="mt-1"
                type="checkbox"
                name="replaceExistingOnRevision"
                value="1"
                defaultChecked={settings.replaceExistingOnRevision}
              />
              <span>
                <span className="block font-medium">
                  {t("settings.revisionTitle")}
                </span>
                <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">
                  {t("settings.revisionHelp")}
                </span>
              </span>
            </label>
            <div className="md:col-span-2 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel-strong)] p-3 text-sm">
              <div className="text-xs font-medium text-[var(--muted)]">
                {t("settings.variables")}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5 data-digits text-xs">
                {[
                  "{title}",
                  "{season}",
                  "{season_pad}",
                  "{episode}",
                  "{episode_pad}",
                  "{ext}"
                ].map((token) => (
                  <span
                    key={token}
                    className="rounded-[6px] border border-[var(--line)] bg-[var(--input)] px-2 py-1"
                  >
                    {token}
                  </span>
                ))}
              </div>
              <div className="mt-3 text-xs text-[var(--muted)]">
                {t("settings.example")}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("settings.miscTitle")}</CardTitle>
            <CardDescription>{t("settings.miscDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <Field
              label={t("settings.tmdbToken")}
              name="tmdbBearerToken"
              defaultValue={settings.tmdbBearerToken}
              type="password"
            />
            <Field
              label={t("settings.workerInterval")}
              name="workerIntervalSeconds"
              defaultValue={String(settings.workerIntervalSeconds)}
              type="number"
              min={30}
              help={t("settings.workerIntervalHelp")}
            />
            <Field
              label={t("settings.downloadTimeout")}
              name="downloadTimeoutMinutes"
              defaultValue={String(settings.downloadTimeoutMinutes)}
              type="number"
              min={1}
              max={1440}
              help={t("settings.downloadTimeoutHelp")}
            />
            <label className="flex items-start gap-2 text-sm md:col-span-2">
              <input
                className="mt-1"
                type="checkbox"
                name="downloadAutoRetryEnabled"
                value="1"
                defaultChecked={settings.downloadAutoRetryEnabled}
              />
              <span>
                <span className="block font-medium">
                  {t("settings.autoRetryTitle")}
                </span>
                <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">
                  {t("settings.autoRetryHelp")}
                </span>
              </span>
            </label>
            <Field
              label={t("settings.maxAttempts")}
              name="downloadAutoRetryMaxAttempts"
              defaultValue={String(settings.downloadAutoRetryMaxAttempts)}
              type="number"
              min={1}
              max={20}
              help={t("settings.maxAttemptsHelp")}
            />
            <Field
              label={t("settings.retryCooldown")}
              name="downloadAutoRetryCooldownMinutes"
              defaultValue={String(settings.downloadAutoRetryCooldownMinutes)}
              type="number"
              min={1}
              max={1440}
              help={t("settings.retryCooldownHelp")}
            />
            <div className="md:col-span-2">
              <Button variant="signal" type="submit">
                <Save className="size-4" />
                {t("settings.save")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.maintenanceTitle")}</CardTitle>
          <CardDescription>
            {t("settings.maintenanceDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {resetStatus ? <ResetStatus status={resetStatus} /> : null}
          <div>
            <ResetRuntimeDialog />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ResetStatus({ status }: { status: "runtime" | "confirm" }) {
  const { t } = useI18n();
  if (status === "confirm") {
    return (
      <div className="rounded-[var(--radius)] border border-[var(--danger-soft-border)] bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger-text)]">
        {t("settings.resetConfirmError", {
          phrase: RUNTIME_RESET_CONFIRM_PHRASE
        })}
      </div>
    );
  }

  return (
    <div className="rounded-[var(--radius)] border border-[var(--signal-soft-border)] bg-[var(--signal-soft)] p-3 text-sm text-[var(--signal-text)]">
      {t("settings.resetSuccess")}
    </div>
  );
}

function CheckResult({ result }: { result: OpenList115CheckResult }) {
  const { t } = useI18n();
  return (
    <div
      className={
        result.ok
          ? "rounded-[var(--radius)] border border-[var(--signal-soft-border)] bg-[var(--signal-soft)] p-3 text-sm text-[var(--signal-text)]"
          : "rounded-[var(--radius)] border border-[var(--danger-soft-border)] bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger-text)]"
      }
    >
      <div className="font-medium">
        {result.ok ? t("settings.checkOk") : t("settings.checkFail")}
      </div>
      <div className="mt-2 grid gap-1">
        {result.checks.map((check) => (
          <div key={check.label}>
            {check.ok ? "OK" : "FAIL"} / {check.label}: {check.message}
          </div>
        ))}
      </div>
    </div>
  );
}

function ModeSelect({
  defaultValue
}: {
  defaultValue: SystemSettings["openlist115Mode"];
}) {
  const { t } = useI18n();
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="openlist115Mode">{t("settings.modeLabel")}</Label>
      <select
        id="openlist115Mode"
        name="openlist115Mode"
        defaultValue={defaultValue}
        className="flex h-9 w-full rounded-[var(--radius)] border border-[var(--line)] bg-[var(--input)] px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--signal)]"
      >
        <option value="115 Cloud">115 Cloud</option>
        <option value="115 Open">115 Open</option>
      </select>
      <p className="text-xs text-[var(--muted)]">{t("settings.modeHelp")}</p>
    </div>
  );
}

function Field({
  label,
  name,
  help,
  ...props
}: {
  label: string;
  name: string;
  help?: string;
} & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} {...props} />
      {help ? <p className="text-xs text-[var(--muted)]">{help}</p> : null}
    </div>
  );
}
