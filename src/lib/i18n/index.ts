/** Client-safe i18n exports. Server-only helpers live in `@/lib/i18n/server`. */
export {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_LABELS,
  LOCALES,
  isLocale,
  parseLocale,
  type Locale
} from "@/lib/i18n/config";
export { createT, type TranslateFn } from "@/lib/i18n/create-t";
export { getMessages, type Messages } from "@/lib/i18n/messages";
