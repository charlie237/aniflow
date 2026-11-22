import { getSystemSettings } from "@/lib/db/repositories";

export type NotificationEventType =
  | "episode_completed"
  | "job_failed"
  | "needs_review"
  | "test";

export interface NotificationEvent {
  type: NotificationEventType;
  title: string;
  body: string;
  details?: Record<string, string | number | null | undefined>;
}

export interface NotificationDispatchResult {
  sent: string[];
  failed: Array<{ channel: string; error: string }>;
}

const NOTIFY_TIMEOUT_MS = 10_000;

export async function sendNotification(
  event: NotificationEvent
): Promise<NotificationDispatchResult> {
  const settings = getSystemSettings();
  if (!shouldDispatchEvent(event.type, settings)) {
    return { sent: [], failed: [] };
  }

  const jobs: Array<{ channel: string; run: () => Promise<void> }> = [];

  if (settings.webhookEnabled && settings.webhookUrl) {
    jobs.push({
      channel: "webhook",
      run: () => sendWebhook(settings.webhookUrl, event)
    });
  }

  if (
    settings.telegramEnabled &&
    settings.telegramBotToken &&
    settings.telegramChatId
  ) {
    jobs.push({
      channel: "telegram",
      run: () =>
        sendTelegram(
          settings.telegramBotToken,
          settings.telegramChatId,
          event
        )
    });
  }

  if (settings.barkEnabled && settings.barkServerUrl && settings.barkDeviceKey) {
    jobs.push({
      channel: "bark",
      run: () =>
        sendBark(settings.barkServerUrl, settings.barkDeviceKey, event)
    });
  }

  if (jobs.length === 0) {
    return { sent: [], failed: [] };
  }

  const sent: string[] = [];
  const failed: Array<{ channel: string; error: string }> = [];

  await Promise.all(
    jobs.map(async ({ channel, run }) => {
      try {
        await run();
        sent.push(channel);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failed.push({ channel, error: message });
        console.warn(`[notify] ${channel} failed: ${message}`);
      }
    })
  );

  return { sent, failed };
}

function shouldDispatchEvent(
  type: NotificationEventType,
  settings: ReturnType<typeof getSystemSettings>
) {
  if (type === "test") return true;
  if (type === "episode_completed") return settings.notifyOnCompleted;
  if (type === "job_failed") return settings.notifyOnFailed;
  if (type === "needs_review") return settings.notifyOnNeedsReview;
  return false;
}

async function sendWebhook(url: string, event: NotificationEvent) {
  assertHttpUrl(url, "Webhook URL");
  const response = await fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      app: "aniflow",
      event: event.type,
      title: event.title,
      body: event.body,
      timestamp: new Date().toISOString(),
      details: event.details ?? {}
    })
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
}

async function sendTelegram(
  botToken: string,
  chatId: string,
  event: NotificationEvent
) {
  const endpoint = `https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendMessage`;
  const response = await fetch(endpoint, {
    method: "POST",
    signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: `${event.title}\n${event.body}`
    })
  });
  if (!response.ok) {
    throw new Error(`Telegram API HTTP ${response.status}`);
  }
}

async function sendBark(
  serverUrl: string,
  deviceKey: string,
  event: NotificationEvent
) {
  const base = assertHttpUrl(serverUrl, "Bark server URL").replace(/\/+$/, "");
  const response = await fetch(`${base}/push`, {
    method: "POST",
    signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      device_key: deviceKey,
      title: event.title,
      body: event.body,
      group: "Aniflow"
    })
  });
  if (!response.ok) {
    throw new Error(`Bark API HTTP ${response.status}`);
  }
}

function assertHttpUrl(value: string, label: string) {
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${label} must use http:// or https://`);
  }
  return value;
}
