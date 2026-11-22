"use client";

import { Bell, Loader2, RefreshCw, Save } from "lucide-react";
import { useState, useTransition, type InputHTMLAttributes } from "react";
import { toast } from "sonner";
import {
  check115ConnectivityAction,
  saveSettingsAction,
  testMediaServerAction,
  testNotificationAction
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
import type { PublicSystemSettings, SystemSettings } from "@/lib/db/types";
import type { OpenList115CheckResult } from "@/lib/openlist/client";
import { RUNTIME_RESET_CONFIRM_PHRASE } from "@/lib/runtime-reset";

export function SettingsForm({
  settings,
  resetStatus
}: {
  settings: PublicSystemSettings;
  resetStatus?: "runtime" | "confirm" | null;
}) {
  const { t } = useI18n();
  const [checkResult, setCheckResult] = useState<OpenList115CheckResult | null>(
    null
  );
  const [saving, startSave] = useTransition();
  const [checking, startCheck] = useTransition();
  const [testingMedia, startMediaTest] = useTransition();
  const [testingNotify, startNotifyTest] = useTransition();
  const busy = saving || checking || testingMedia || testingNotify;

  function handleTestMediaServer(formData: FormData) {
    startMediaTest(async () => {
      const result = await testMediaServerAction(formData);
      if (result.ok) {
        toast.success(result.message ?? t("toast.mediaServerTestOk"));
      } else {
        toast.error(
          t("toast.actionFailed", { error: result.error ?? t("common.unknown") })
        );
      }
    });
  }

  function handleTestNotification(formData: FormData) {
    startNotifyTest(async () => {
      const result = await testNotificationAction(formData);
      if (result.ok) {
        toast.success(result.message ?? t("toast.notificationTestOk", { channels: "" }));
      } else {
        toast.error(
          t("toast.actionFailed", { error: result.error ?? t("common.unknown") })
        );
      }
    });
  }

  function handleSave(formData: FormData) {
    startSave(async () => {
      const result = await saveSettingsAction(formData);
      if (result.ok) {
        toast.success(result.message ?? t("toast.settingsSaved"));
      } else {
        toast.error(
          t("toast.actionFailed", { error: result.error ?? t("common.unknown") })
        );
      }
    });
  }

  function handleCheck(formData: FormData) {
    startCheck(async () => {
      const result = await check115ConnectivityAction(formData);
      if (result.data) {
        setCheckResult(result.data);
      }
      if (result.ok) {
        toast.success(result.message ?? t("toast.checkPassed"));
      } else {
        toast.error(
          result.error
            ? t("toast.actionFailed", { error: result.error })
            : (result.message ?? t("toast.checkFailed"))
        );
      }
    });
  }

  return (
    <div className="grid gap-5">
      <form action={handleSave} className="grid gap-5">
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
            <div className="grid gap-1.5">
              <Field
                label={t("settings.token")}
                name="openlistToken"
                defaultValue=""
                placeholder={
                  settings.hasOpenlistToken
                    ? t("settings.tokenConfiguredPlaceholder")
                    : "Authorization token"
                }
                type="password"
                autoComplete="new-password"
              />
              {settings.hasOpenlistToken ? (
                <label className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
                  <input type="checkbox" name="clearOpenlistToken" value="1" />
                  {t("settings.clearToken")}
                </label>
              ) : null}
            </div>
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
                disabled={busy}
                formAction={handleCheck}
              >
                {checking ? <Loader2 className="size-4 animate-spin" /> : null}
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("settings.mediaServerTitle")}</CardTitle>
            <CardDescription>{t("settings.mediaServerDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="mediaServerType">{t("settings.mediaServerType")}</Label>
              <select
                id="mediaServerType"
                name="mediaServerType"
                defaultValue={settings.mediaServerType}
                className="flex h-9 w-full rounded-[var(--radius)] border border-[var(--line)] bg-[var(--input)] px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--signal)]"
              >
                <option value="none">{t("settings.mediaServerNone")}</option>
                <option value="jellyfin">Jellyfin</option>
                <option value="emby">Emby</option>
                <option value="plex">Plex</option>
              </select>
            </div>
            <Field
              label={t("settings.mediaServerUrl")}
              name="mediaServerUrl"
              defaultValue={settings.mediaServerUrl}
              placeholder="http://127.0.0.1:8096"
            />
            <div className="grid gap-1.5">
              <Field
                label={t("settings.mediaServerToken")}
                name="mediaServerToken"
                defaultValue=""
                placeholder={
                  settings.hasMediaServerToken
                    ? t("settings.tokenConfiguredPlaceholder")
                    : "API Key / X-Plex-Token"
                }
                type="password"
                autoComplete="new-password"
              />
              {settings.hasMediaServerToken ? (
                <label className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
                  <input type="checkbox" name="clearMediaServerToken" value="1" />
                  {t("settings.clearToken")}
                </label>
              ) : null}
            </div>
            <Field
              label={t("settings.mediaServerLibraryId")}
              name="mediaServerLibraryId"
              defaultValue={settings.mediaServerLibraryId}
              placeholder={t("settings.mediaServerLibraryIdPlaceholder")}
              help={t("settings.mediaServerLibraryIdHelp")}
            />
            <div className="md:col-span-2">
              <Button
                type="submit"
                variant="outline"
                disabled={busy}
                formAction={handleTestMediaServer}
              >
                {testingMedia ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                {t("settings.testMediaServer")}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("settings.notifyTitle")}</CardTitle>
            <CardDescription>{t("settings.notifyDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="notifyOnCompleted"
                  value="1"
                  defaultChecked={settings.notifyOnCompleted}
                />
                {t("settings.notifyOnCompleted")}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="notifyOnFailed"
                  value="1"
                  defaultChecked={settings.notifyOnFailed}
                />
                {t("settings.notifyOnFailed")}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="notifyOnNeedsReview"
                  value="1"
                  defaultChecked={settings.notifyOnNeedsReview}
                />
                {t("settings.notifyOnNeedsReview")}
              </label>
            </div>

            <div className="grid gap-3 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel-strong)] p-3 md:grid-cols-2">
              <label className="flex items-center gap-2 text-sm font-medium md:col-span-2">
                <input
                  type="checkbox"
                  name="webhookEnabled"
                  value="1"
                  defaultChecked={settings.webhookEnabled}
                />
                Webhook (JSON POST)
              </label>
              <div className="md:col-span-2">
                <Field
                  label="Webhook URL"
                  name="webhookUrl"
                  defaultValue={settings.webhookUrl}
                  placeholder="https://example.com/webhook"
                />
              </div>
            </div>

            <div className="grid gap-3 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel-strong)] p-3 md:grid-cols-2">
              <label className="flex items-center gap-2 text-sm font-medium md:col-span-2">
                <input
                  type="checkbox"
                  name="telegramEnabled"
                  value="1"
                  defaultChecked={settings.telegramEnabled}
                />
                Telegram Bot
              </label>
              <div className="grid gap-1.5">
                <Field
                  label="Bot Token"
                  name="telegramBotToken"
                  defaultValue=""
                  placeholder={
                    settings.hasTelegramBotToken
                      ? t("settings.tokenConfiguredPlaceholder")
                      : "123456:ABC-DEF..."
                  }
                  type="password"
                  autoComplete="new-password"
                />
                {settings.hasTelegramBotToken ? (
                  <label className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
                    <input type="checkbox" name="clearTelegramBotToken" value="1" />
                    {t("settings.clearToken")}
                  </label>
                ) : null}
              </div>
              <Field
                label="Chat ID"
                name="telegramChatId"
                defaultValue={settings.telegramChatId}
                placeholder="-1001234567890"
              />
            </div>

            <div className="grid gap-3 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel-strong)] p-3 md:grid-cols-2">
              <label className="flex items-center gap-2 text-sm font-medium md:col-span-2">
                <input
                  type="checkbox"
                  name="barkEnabled"
                  value="1"
                  defaultChecked={settings.barkEnabled}
                />
                Bark
              </label>
              <Field
                label={t("settings.barkServerUrl")}
                name="barkServerUrl"
                defaultValue={settings.barkServerUrl}
                placeholder="https://api.day.app"
              />
              <div className="grid gap-1.5">
                <Field
                  label="Device Key"
                  name="barkDeviceKey"
                  defaultValue=""
                  placeholder={
                    settings.hasBarkDeviceKey
                      ? t("settings.tokenConfiguredPlaceholder")
                      : "Your Bark device key"
                  }
                  type="password"
                  autoComplete="new-password"
                />
                {settings.hasBarkDeviceKey ? (
                  <label className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
                    <input type="checkbox" name="clearBarkDeviceKey" value="1" />
                    {t("settings.clearToken")}
                  </label>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="submit"
                variant="outline"
                disabled={busy}
                formAction={handleTestNotification}
              >
                {testingNotify ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Bell className="size-4" />
                )}
                {t("settings.testNotification")}
              </Button>
              <Button variant="signal" type="submit" disabled={busy}>
                {saving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
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
