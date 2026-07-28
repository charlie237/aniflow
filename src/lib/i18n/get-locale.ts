import "server-only";
import { cookies } from "next/headers";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  parseLocale,
  type Locale
} from "@/lib/i18n/config";
import { createT, type TranslateFn } from "@/lib/i18n/create-t";
import { getMessages, type Messages } from "@/lib/i18n/messages";

export async function getLocale(): Promise<Locale> {
  try {
    const jar = await cookies();
    return parseLocale(jar.get(LOCALE_COOKIE)?.value);
  } catch {
    return DEFAULT_LOCALE;
  }
}

export async function getDictionary(): Promise<{
  locale: Locale;
  messages: Messages;
  t: TranslateFn;
}> {
  const locale = await getLocale();
  const messages = getMessages(locale);
  return { locale, messages, t: createT(messages) };
}
