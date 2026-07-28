import type { Locale } from "@/lib/i18n/config";
import en from "@/lib/i18n/messages/en";
import zhCN from "@/lib/i18n/messages/zh-CN";

export type Messages = typeof zhCN;

export const dictionaries: Record<Locale, Messages> = {
  "zh-CN": zhCN,
  en: en as unknown as Messages
};

export function getMessages(locale: Locale): Messages {
  return dictionaries[locale] ?? dictionaries["zh-CN"];
}
